export function createOrchestrator(options = {}) {
  const controlPlane = options.controlPlane;
  const controlToken = String(options.controlToken || "").trim();
  const defaultWorkerId = normalizeId(options.defaultWorkerId);
  const defaultWorkerLabel = normalizeText(options.defaultWorkerLabel);
  const sellerUrl = normalizeUrl(options.sellerUrl);
  const sellerToken = String(options.sellerToken || controlToken).trim();
  const storeUrl = normalizeUrl(options.storeUrl);
  const storeToken = String(options.storeToken || controlToken).trim();

  if (!controlPlane) {
    throw new Error("controlPlane is required.");
  }

  return {
    async getSystemSummary() {
      const [workers, jobs] = await Promise.all([controlPlane.getWorkers(), controlPlane.getJobs()]);
      return {
        workers,
        jobs,
        defaultWorkerId,
        defaultWorkerLabel,
        sellerUrl,
        storeUrl
      };
    },
    async createWorkerShellJob(input = {}) {
      const worker = await resolveWorker(input);
      const command = String(input.command || "").trim();

      if (!command) {
        throw new Error("command is required.");
      }

      const job = await controlPlane.createJob({
        type: "shell",
        capability: String(input.capability || "shell").trim() || "shell",
        targetWorkerId: worker.id,
        command,
        payload: {
          cwd: normalizeText(input.cwd),
          shell: normalizeText(input.shell)
        },
        priority: input.priority
      });

      return { worker, job };
    },
    async runSellerCommand(input = {}) {
      if (!sellerUrl || !sellerToken) {
        throw new Error("Seller bot URL/token is not configured.");
      }

      const text = String(input.text || "").trim();
      if (!text) {
        throw new Error("Seller command text is required.");
      }

      return callJsonApi(`${sellerUrl}/api/openclaw/seller`, {
        method: "POST",
        token: sellerToken,
        body: {
          action: "command",
          text,
          actor: input.actor || "openclaw:assistant",
          userId: input.userId,
          chatType: input.chatType || "private",
          language: input.language || "vi",
          now: input.now
        }
      });
    },
    async allowSellerChat(input = {}) {
      if (!sellerUrl || !sellerToken) {
        throw new Error("Seller bot URL/token is not configured.");
      }

      const chatId = String(input.chatId || "").trim();
      if (!chatId) {
        throw new Error("chatId is required.");
      }

      return callJsonApi(`${sellerUrl}/api/openclaw/seller`, {
        method: "POST",
        token: sellerToken,
        body: {
          action: "allow-chat",
          chatId,
          actor: input.actor || "openclaw:assistant"
        }
      });
    },
    async runStoreAdmin(input = {}) {
      if (!storeUrl || !storeToken) {
        throw new Error("Store admin URL/token is not configured.");
      }

      const action = String(input.action || "").trim();
      if (!action) {
        throw new Error("Store admin action is required.");
      }

      const method = String(input.method || (input.body ? "POST" : "GET")).toUpperCase();
      const url = new URL(`${storeUrl}/api/openclaw/admin`);

      if (method === "GET") {
        url.searchParams.set("action", action);
        for (const [key, value] of Object.entries(input.query || {})) {
          if (value !== undefined && value !== null && String(value).trim()) {
            url.searchParams.set(key, String(value));
          }
        }
      }

      return callJsonApi(url.toString(), {
        method,
        token: storeToken,
        headerName: "x-openclaw-admin-token",
        body: method === "POST" ? { action, ...(input.body || {}) } : undefined
      });
    }
  };

  async function resolveWorker(input = {}) {
    const workers = await controlPlane.getWorkers();
    const targetWorkerId = normalizeId(input.targetWorkerId);
    const targetWorkerLabel = normalizeText(input.targetWorkerLabel);

    let worker =
      workers.find((entry) => entry.id === targetWorkerId)
      || workers.find((entry) => targetWorkerLabel && entry.label === targetWorkerLabel)
      || workers.find((entry) => defaultWorkerId && entry.id === defaultWorkerId)
      || workers.find((entry) => defaultWorkerLabel && entry.label === defaultWorkerLabel);

    if (!worker) {
      worker = workers.find((entry) => entry.status === "online") || workers[0];
    }

    if (!worker) {
      throw new Error("No worker is registered.");
    }

    return worker;
  }
}

async function callJsonApi(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const token = String(options.token || "").trim();
  const headerName = String(options.headerName || "x-openclaw-seller-token").trim() || "x-openclaw-seller-token";
  const headers = {
    Accept: "application/json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers[headerName] = token;
  }

  if (method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(options.body || {})
  });

  const raw = await response.text();
  const parsed = raw ? JSON.parse(raw) : {};

  if (!response.ok || parsed.ok === false) {
    throw new Error(parsed.error || `Request failed with HTTP ${response.status}.`);
  }

  return parsed.data ?? parsed;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeId(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeUrl(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
