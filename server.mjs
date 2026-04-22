import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createControlPlane } from "./src/control-plane.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFromFile = loadEnvFile(path.join(__dirname, ".env"));

const config = {
  port: Number(process.env.PORT || envFromFile.PORT || 3000),
  siteUrl: process.env.SITE_URL || envFromFile.SITE_URL || "https://your-openclaw-control-plane.vercel.app",
  databaseUrl: process.env.DATABASE_URL || envFromFile.DATABASE_URL || "",
  controlPath: process.env.OPENCLAW_CONTROL_PATH || envFromFile.OPENCLAW_CONTROL_PATH || "data/openclaw-control-plane.json",
  controlToken: process.env.OPENCLAW_CONTROL_TOKEN || envFromFile.OPENCLAW_CONTROL_TOKEN || "",
  workerHeartbeatSeconds: Number(process.env.OPENCLAW_WORKER_HEARTBEAT_SECONDS || envFromFile.OPENCLAW_WORKER_HEARTBEAT_SECONDS || 120),
  jobLeaseSeconds: Number(process.env.OPENCLAW_JOB_LEASE_SECONDS || envFromFile.OPENCLAW_JOB_LEASE_SECONDS || 90)
};

const controlPlane = createControlPlane({
  statePath: config.controlPath,
  databaseUrl: config.databaseUrl,
  heartbeatTimeoutSeconds: config.workerHeartbeatSeconds,
  defaultJobLeaseSeconds: config.jobLeaseSeconds
});

const server = createServer(handleRequest);

async function handleRequest(req, res) {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;
    const method = String(req.method || "GET").toUpperCase();

    if (method === "OPTIONS") {
      return sendEmpty(res, 204, {
        Allow: "GET, HEAD, POST, OPTIONS",
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-OpenClaw-Control-Token"
      });
    }

    if (method === "GET" && pathname === "/") {
      return sendJson(res, 200, {
        ok: true,
        service: "openclaw-control-plane",
        endpoint: "/api/openclaw/control",
        storageMode: controlPlane.storageMode
      });
    }

    if ((method === "GET" || method === "HEAD") && pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "openclaw-control-plane",
        storageMode: controlPlane.storageMode,
        statePath: controlPlane.statePath
      });
    }

    if ((method === "GET" || method === "HEAD" || method === "POST") && pathname === "/api/openclaw/control") {
      return handleControlRequest(req, res, requestUrl, method);
    }

    return sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
}

async function handleControlRequest(req, res, requestUrl, method) {
  if (!config.controlToken) {
    return sendJson(res, 503, { error: "OPENCLAW_CONTROL_TOKEN is not configured." });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized." });
  }

  if (method === "GET" || method === "HEAD") {
    const view = requestUrl.searchParams.get("view") || "summary";

    if (view === "workers") {
      return sendJson(res, 200, { ok: true, data: await controlPlane.getWorkers() });
    }

    if (view === "jobs") {
      return sendJson(res, 200, { ok: true, data: await controlPlane.getJobs() });
    }

    return sendJson(res, 200, { ok: true, data: await controlPlane.getSummary() });
  }

  const body = await readJsonBody(req);
  const action = String(body.action || "").trim().toLowerCase();

  try {
    if (action === "register-worker") {
      return sendJson(res, 200, { ok: true, data: await controlPlane.registerWorker(body) });
    }

    if (action === "heartbeat-worker") {
      return sendJson(res, 200, { ok: true, data: await controlPlane.heartbeatWorker(body) });
    }

    if (action === "create-job") {
      return sendJson(res, 200, { ok: true, data: await controlPlane.createJob(body) });
    }

    if (action === "claim-job") {
      return sendJson(res, 200, { ok: true, data: await controlPlane.claimNextJob(body) });
    }

    if (action === "heartbeat-job") {
      return sendJson(res, 200, { ok: true, data: await controlPlane.heartbeatJob(body) });
    }

    if (action === "complete-job") {
      return sendJson(res, 200, { ok: true, data: await controlPlane.completeJob(body) });
    }

    if (action === "fail-job") {
      return sendJson(res, 200, { ok: true, data: await controlPlane.failJob(body) });
    }

    return sendJson(res, 400, { error: "Unsupported action." });
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Control plane request failed." });
  }
}

function isAuthorized(req) {
  const authHeader = String(req.headers.authorization || "");
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  const explicitToken = String(req.headers["x-openclaw-control-token"] || "").trim();
  const suppliedToken = explicitToken || bearerToken;
  return Boolean(suppliedToken) && suppliedToken === config.controlToken;
}

async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > 512 * 1024) {
      throw new Error("Payload too large.");
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    "Cache-Control": "no-store"
  });
  res.end(res.__headRequest ? undefined : body);
}

function sendEmpty(res, statusCode, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end();
}

function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    const result = {};

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      result[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
    }

    return result;
  } catch {
    return {};
  }
}

if (path.resolve(process.argv[1] || "") === __filename) {
  server.listen(config.port, () => {
    console.log(`OpenClaw Control Plane is running at http://localhost:${config.port}`);
  });
}

export { handleRequest, server };
