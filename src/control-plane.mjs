import crypto from "node:crypto";

import { createDocumentStore } from "./document-store.mjs";

const DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 120;
const DEFAULT_JOB_LEASE_SECONDS = 90;

export function createControlPlane(options = {}) {
  const store = createDocumentStore({
    documentKey: "openclaw_control_plane_state",
    fallbackPath: options.statePath || "data/openclaw-control-plane.json",
    databaseUrl: options.databaseUrl || "",
    initialValue: {
      workers: [],
      jobs: []
    }
  });
  const heartbeatTimeoutSeconds = toPositiveInteger(options.heartbeatTimeoutSeconds, DEFAULT_HEARTBEAT_TIMEOUT_SECONDS);
  const defaultJobLeaseSeconds = toPositiveInteger(options.defaultJobLeaseSeconds, DEFAULT_JOB_LEASE_SECONDS);

  return {
    statePath: store.statePath,
    storageMode: store.storageMode,
    async getSummary() {
      const state = await loadState();
      return {
        workers: {
          total: state.workers.length,
          online: state.workers.filter((worker) => worker.status === "online").length,
          busy: state.workers.filter((worker) => worker.status === "busy").length,
          offline: state.workers.filter((worker) => worker.status === "offline").length
        },
        jobs: {
          total: state.jobs.length,
          queued: state.jobs.filter((job) => job.status === "queued").length,
          leased: state.jobs.filter((job) => job.status === "leased").length,
          running: state.jobs.filter((job) => job.status === "running").length,
          completed: state.jobs.filter((job) => job.status === "completed").length,
          failed: state.jobs.filter((job) => job.status === "failed").length
        },
        recentWorkers: state.workers
          .slice()
          .sort((a, b) => Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0))
          .slice(0, 10),
        recentJobs: state.jobs
          .slice()
          .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
          .slice(0, 10)
      };
    },
    async getWorkers() {
      const state = await loadState();
      return state.workers;
    },
    async getJobs() {
      const state = await loadState();
      return state.jobs;
    },
    async registerWorker(input = {}) {
      const now = new Date().toISOString();
      const workerId = normalizeId(input.workerId || input.id);

      if (!workerId) {
        throw new Error("A workerId is required.");
      }

      return applyMutation((state) => {
        const existing = state.workers.find((worker) => worker.id === workerId);
        const next = {
          id: workerId,
          label: normalizeText(input.label) || workerId,
          hostname: normalizeText(input.hostname),
          platform: normalizeText(input.platform),
          version: normalizeText(input.version),
          capabilities: normalizeList(input.capabilities),
          metadata: normalizeObject(input.metadata),
          status: "online",
          currentJobId: existing?.currentJobId || "",
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          lastSeenAt: now
        };

        if (existing) {
          Object.assign(existing, next);
          return existing;
        }

        state.workers.push(next);
        return next;
      });
    },
    async heartbeatWorker(input = {}) {
      const now = new Date().toISOString();
      const workerId = normalizeId(input.workerId || input.id);

      if (!workerId) {
        throw new Error("A workerId is required.");
      }

      return applyMutation((state) => {
        const worker = state.workers.find((entry) => entry.id === workerId);

        if (!worker) {
          throw new Error(`Worker ${workerId} is not registered.`);
        }

        worker.status = worker.currentJobId ? "busy" : "online";
        worker.updatedAt = now;
        worker.lastSeenAt = now;
        if (input.currentJobId !== undefined) {
          worker.currentJobId = normalizeId(input.currentJobId);
          worker.status = worker.currentJobId ? "busy" : "online";
        }
        if (Array.isArray(input.capabilities)) {
          worker.capabilities = normalizeList(input.capabilities);
        }
        if (input.metadata && typeof input.metadata === "object") {
          worker.metadata = normalizeObject({
            ...worker.metadata,
            ...input.metadata
          });
        }

        return worker;
      });
    },
    async createJob(input = {}) {
      const now = new Date().toISOString();
      const type = normalizeId(input.type);

      if (!type) {
        throw new Error("A job type is required.");
      }

      return applyMutation((state) => {
        const job = {
          id: normalizeId(input.id) || `job_${crypto.randomUUID()}`,
          type,
          capability: normalizeId(input.capability),
          targetWorkerId: normalizeId(input.targetWorkerId),
          command: normalizeCommand(input.command),
          payload: normalizeObject(input.payload),
          priority: toBoundedInteger(input.priority, 100, 0, 1000),
          leaseSeconds: toPositiveInteger(input.leaseSeconds, defaultJobLeaseSeconds),
          status: "queued",
          createdAt: now,
          updatedAt: now,
          claimedAt: "",
          completedAt: "",
          leaseOwner: "",
          leaseExpiresAt: "",
          attempts: 0,
          result: null,
          lastError: ""
        };

        state.jobs.push(job);
        return job;
      });
    },
    async claimNextJob(input = {}) {
      const now = new Date().toISOString();
      const workerId = normalizeId(input.workerId || input.id);

      if (!workerId) {
        throw new Error("A workerId is required.");
      }

      return applyMutation((state) => {
        const worker = state.workers.find((entry) => entry.id === workerId);

        if (!worker) {
          throw new Error(`Worker ${workerId} is not registered.`);
        }

        const capabilities = normalizeList(input.capabilities?.length ? input.capabilities : worker.capabilities);
        const job = state.jobs
          .filter((entry) => entry.status === "queued")
          .filter((entry) => !entry.targetWorkerId || entry.targetWorkerId === workerId)
          .filter((entry) => !entry.capability || capabilities.includes(entry.capability))
          .sort((a, b) => {
            if ((a.priority || 0) !== (b.priority || 0)) {
              return (b.priority || 0) - (a.priority || 0);
            }
            return Date.parse(a.createdAt) - Date.parse(b.createdAt);
          })[0];

        if (!job) {
          worker.currentJobId = "";
          worker.status = "online";
          worker.updatedAt = now;
          worker.lastSeenAt = now;
          return null;
        }

        job.status = "leased";
        job.leaseOwner = workerId;
        job.claimedAt = job.claimedAt || now;
        job.leaseExpiresAt = new Date(Date.parse(now) + (job.leaseSeconds || defaultJobLeaseSeconds) * 1000).toISOString();
        job.updatedAt = now;
        job.attempts += 1;
        worker.currentJobId = job.id;
        worker.status = "busy";
        worker.updatedAt = now;
        worker.lastSeenAt = now;
        return job;
      });
    },
    async heartbeatJob(input = {}) {
      const now = new Date().toISOString();
      const workerId = normalizeId(input.workerId || input.id);
      const jobId = normalizeId(input.jobId);

      if (!workerId || !jobId) {
        throw new Error("A workerId and jobId are required.");
      }

      return applyMutation((state) => {
        const job = state.jobs.find((entry) => entry.id === jobId);
        const worker = state.workers.find((entry) => entry.id === workerId);

        if (!job || !worker) {
          throw new Error("Worker or job not found.");
        }

        if (!["leased", "running"].includes(job.status) || job.leaseOwner !== workerId) {
          throw new Error(`Job ${jobId} is not leased by ${workerId}.`);
        }

        job.status = "running";
        job.updatedAt = now;
        job.leaseExpiresAt = new Date(
          Date.parse(now) + toPositiveInteger(input.leaseSeconds, job.leaseSeconds || defaultJobLeaseSeconds) * 1000
        ).toISOString();
        worker.currentJobId = job.id;
        worker.status = "busy";
        worker.updatedAt = now;
        worker.lastSeenAt = now;
        return job;
      });
    },
    async completeJob(input = {}) {
      return finalizeJob(input, "completed");
    },
    async failJob(input = {}) {
      return finalizeJob(input, "failed");
    }
  };

  async function finalizeJob(input, status) {
    const now = new Date().toISOString();
    const workerId = normalizeId(input.workerId || input.id);
    const jobId = normalizeId(input.jobId);

    if (!workerId || !jobId) {
      throw new Error("A workerId and jobId are required.");
    }

    return applyMutation((state) => {
      const job = state.jobs.find((entry) => entry.id === jobId);
      const worker = state.workers.find((entry) => entry.id === workerId);

      if (!job || !worker) {
        throw new Error("Worker or job not found.");
      }

      if (job.leaseOwner !== workerId) {
        throw new Error(`Job ${jobId} is not leased by ${workerId}.`);
      }

      job.status = status;
      job.updatedAt = now;
      job.completedAt = now;
      job.leaseOwner = "";
      job.leaseExpiresAt = "";
      job.result = limitResult(input.result);
      job.lastError = status === "failed" ? truncateText(input.error || "Worker reported a failure.") : "";
      worker.currentJobId = "";
      worker.status = "online";
      worker.updatedAt = now;
      worker.lastSeenAt = now;
      return job;
    });
  }

  async function loadState() {
    const state = await store.read();
    hydrateState(state);
    expireState(state);
    return state;
  }

  async function applyMutation(mutator) {
    const state = await store.read();
    hydrateState(state);
    expireState(state);
    const result = mutator(state);
    await store.write(state);
    return result;
  }

  function expireState(state) {
    const now = Date.now();
    const cutoff = now - heartbeatTimeoutSeconds * 1000;

    for (const worker of state.workers) {
      const seen = Date.parse(worker.lastSeenAt || 0);
      worker.status = seen >= cutoff
        ? worker.currentJobId
          ? "busy"
          : "online"
        : "offline";
    }

    for (const job of state.jobs) {
      if (!job.leaseExpiresAt || !["leased", "running"].includes(job.status)) {
        continue;
      }

      if (Date.parse(job.leaseExpiresAt) > now) {
        continue;
      }

      job.status = "queued";
      job.leaseOwner = "";
      job.leaseExpiresAt = "";
      job.updatedAt = new Date(now).toISOString();
      job.lastError = truncateText([job.lastError, "Lease expired."].filter(Boolean).join(" "));
    }

    for (const worker of state.workers) {
      if (!worker.currentJobId) {
        continue;
      }

      const leasedJob = state.jobs.find((job) => job.id === worker.currentJobId);
      if (!leasedJob || leasedJob.leaseOwner !== worker.id || !["leased", "running"].includes(leasedJob.status)) {
        worker.currentJobId = "";
        if (worker.status === "busy") {
          worker.status = "online";
        }
      }
    }
  }
}

function hydrateState(state) {
  if (!Array.isArray(state.workers)) {
    state.workers = [];
  }
  if (!Array.isArray(state.jobs)) {
    state.jobs = [];
  }
}

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function normalizeText(value) {
  return String(value || "").trim().slice(0, 400);
}

function normalizeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => normalizeId(value)).filter(Boolean))].slice(0, 32);
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeCommand(value) {
  if (typeof value === "string") {
    return value.trim().slice(0, 4000);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).join(" ").slice(0, 4000);
  }
  return "";
}

function limitResult(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return truncateText(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function truncateText(value, maxLength = 16000) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBoundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
