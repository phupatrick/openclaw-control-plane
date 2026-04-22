export function createAssistantRouter(options = {}) {
  const orchestrator = options.orchestrator;

  if (!orchestrator) {
    throw new Error("orchestrator is required.");
  }

  return {
    async handle(input = {}) {
      const text = normalizeText(input.text);

      if (!text) {
        return buildResponse(
          "Mình đang chờ lệnh. Thử kiểu như `status`, `seller summary`, `store pending`, hoặc `run on vostro: Get-Date`."
        );
      }

      const parsed = parseIntent(text);

      if (parsed.intent === "help") {
        return buildResponse(buildHelpText(), { intent: parsed.intent });
      }

      if (parsed.intent === "status") {
        const summary = await orchestrator.getSystemSummary();
        return buildResponse(formatSystemSummary(summary), {
          intent: parsed.intent,
          data: summary
        });
      }

      if (parsed.intent === "seller-summary") {
        const data = await orchestrator.runSellerCommand({
          text: "/summary",
          language: input.language || "vi",
          userId: input.userId,
          actor: input.actor || "openclaw:assistant",
          chatType: "private"
        });

        return buildResponse(data.text || "Seller bot đã trả lời xong.", {
          intent: parsed.intent,
          data
        });
      }

      if (parsed.intent === "seller-find") {
        const data = await orchestrator.runSellerCommand({
          text: `/find ${parsed.query}`,
          language: input.language || "vi",
          userId: input.userId,
          actor: input.actor || "openclaw:assistant",
          chatType: "private"
        });

        return buildResponse(data.text || `Đã tìm seller với từ khóa: ${parsed.query}`, {
          intent: parsed.intent,
          data
        });
      }

      if (parsed.intent === "seller-allow-chat") {
        const data = await orchestrator.allowSellerChat({
          chatId: parsed.chatId,
          actor: input.actor || "openclaw:assistant"
        });

        return buildResponse(`Đã mở quyền Seller Bot cho chat ${parsed.chatId}.`, {
          intent: parsed.intent,
          data
        });
      }

      if (parsed.intent === "store-dashboard") {
        const data = await orchestrator.runStoreAdmin({ action: "dashboard" });
        return buildResponse(formatStoreDashboard(data), {
          intent: parsed.intent,
          data
        });
      }

      if (parsed.intent === "store-pending") {
        const data = await orchestrator.runStoreAdmin({ action: "pending" });
        return buildResponse(formatStorePending(data), {
          intent: parsed.intent,
          data
        });
      }

      if (parsed.intent === "store-orders") {
        const data = await orchestrator.runStoreAdmin({ action: "orders" });
        return buildResponse(formatStoreOrders(data), {
          intent: parsed.intent,
          data
        });
      }

      if (parsed.intent === "store-report") {
        const query = parsed.date ? { date: parsed.date } : {};
        const data = await orchestrator.runStoreAdmin({ action: "report", query });
        return buildResponse(formatStoreReport(data), {
          intent: parsed.intent,
          data
        });
      }

      if (parsed.intent === "worker-shell") {
        const data = await orchestrator.createWorkerShellJob({
          targetWorkerLabel: parsed.targetWorkerLabel,
          command: parsed.command
        });

        return buildResponse(
          `Đã giao job cho ${data.worker.label}: \`${parsed.command}\`\nJob id: ${data.job.id}`,
          {
            intent: parsed.intent,
            data
          }
        );
      }

      return buildResponse(
        "Mình chưa hiểu lệnh đó. Thử `help`, `status`, `seller summary`, `store pending`, hoặc `run on vostro: Get-Date`.",
        { intent: "unknown", originalText: text }
      );
    }
  };
}

function parseIntent(text) {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();

  if (matches(lower, ["help", "menu", "tro giup", "trợ giúp"])) {
    return { intent: "help" };
  }

  if (matches(lower, ["status", "summary", "tinh hinh", "tình hình", "tong quan", "tổng quan"])) {
    return { intent: "status" };
  }

  if (lower === "seller summary" || lower === "seller tong quan" || lower === "seller tổng quan") {
    return { intent: "seller-summary" };
  }

  if (lower.startsWith("seller find ")) {
    return { intent: "seller-find", query: normalized.slice("seller find ".length).trim() };
  }

  if (lower.startsWith("seller search ")) {
    return { intent: "seller-find", query: normalized.slice("seller search ".length).trim() };
  }

  if (lower.startsWith("seller allow chat ")) {
    return { intent: "seller-allow-chat", chatId: normalized.slice("seller allow chat ".length).trim() };
  }

  if (matches(lower, ["store dashboard", "store summary", "store tong quan", "store tổng quan"])) {
    return { intent: "store-dashboard" };
  }

  if (matches(lower, ["store pending", "pending orders", "don cho", "đơn chờ"])) {
    return { intent: "store-pending" };
  }

  if (matches(lower, ["store orders", "recent orders", "don gan nhat", "đơn gần nhất"])) {
    return { intent: "store-orders" };
  }

  if (lower.startsWith("store report")) {
    const dateMatch = normalized.match(/\d{4}-\d{2}-\d{2}/);
    return { intent: "store-report", date: dateMatch?.[0] || "" };
  }

  if (lower.startsWith("run on ")) {
    const match = normalized.match(/^run on\s+([^:]+):\s*(.+)$/i);
    if (match) {
      return {
        intent: "worker-shell",
        targetWorkerLabel: match[1].trim(),
        command: match[2].trim()
      };
    }
  }

  if (lower.startsWith("run ")) {
    return {
      intent: "worker-shell",
      targetWorkerLabel: "",
      command: normalized.slice(4).trim()
    };
  }

  return { intent: "unknown", originalText: normalized };
}

function formatSystemSummary(summary) {
  const workers = Array.isArray(summary.workers) ? summary.workers : [];
  const jobs = Array.isArray(summary.jobs) ? summary.jobs : [];
  const onlineWorkers = workers.filter((worker) => worker.status === "online");

  return [
    "OpenClaw status",
    `Online workers: ${onlineWorkers.length}/${workers.length}`,
    `Queued jobs: ${jobs.filter((job) => job.status === "queued").length}`,
    `Running jobs: ${jobs.filter((job) => job.status === "running" || job.status === "leased").length}`,
    `Default worker: ${summary.defaultWorkerLabel || summary.defaultWorkerId || "not set"}`,
    "",
    ...onlineWorkers.slice(0, 5).map((worker) => `- ${worker.label} (${worker.id})`)
  ].join("\n");
}

function formatStoreDashboard(data = {}) {
  return [
    `Store dashboard ${data.date || ""}`.trim(),
    `Pending: ${data.pendingCount ?? 0}`,
    `Orders: ${data.totalOrders ?? 0}`,
    `Net revenue: ${formatMoney(data.netRevenue)}`,
    `Profit: ${formatMoney(data.totalProfit)}`
  ].join("\n");
}

function formatStorePending(data = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  return [
    `Pending orders: ${data.count ?? items.length}`,
    ...items.slice(0, 5).map((item) => `- ${item.orderCode || item.id}: ${item.productName} / ${item.customerLabel}`)
  ].join("\n");
}

function formatStoreOrders(data = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  return [
    `Recent orders: ${data.count ?? items.length}`,
    ...items.slice(0, 5).map((item) => `- ${item.id}: ${item.name} / ${formatMoney(item.finalPrice)}`)
  ].join("\n");
}

function formatStoreReport(data = {}) {
  return [
    `Store report ${data.date || ""}`.trim(),
    `Orders: ${data.totalOrders ?? 0}`,
    `Gross: ${formatMoney(data.grossRevenue)}`,
    `Net: ${formatMoney(data.netRevenue)}`,
    `Profit: ${formatMoney(data.totalProfit)}`
  ].join("\n");
}

function buildHelpText() {
  return [
    "OpenClaw commands",
    "- `status`",
    "- `seller summary`",
    "- `seller find gemini`",
    "- `seller allow chat -100123...`",
    "- `store pending`",
    "- `store orders`",
    "- `store report 2026-04-23`",
    "- `run on vostro: Get-Date`",
    "- `run ipconfig`"
  ].join("\n");
}

function buildResponse(text, extra = {}) {
  return {
    ok: true,
    text: String(text || "").trim(),
    ...extra
  };
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("vi-VN");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function matches(value, candidates) {
  return candidates.includes(String(value || "").trim().toLowerCase());
}
