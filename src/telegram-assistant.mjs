const DEFAULT_COPY =
  "Mình chưa hiểu lệnh đó. Thử `status`, `seller summary`, `store pending`, hoặc `run on vostro: Get-Date`.";

export function createTelegramAssistant(options = {}) {
  const token = String(options.token || "").trim();
  const assistant = options.assistant;
  const ownerUserIds = new Set(normalizeList(options.ownerUserIds || []));
  const allowedChatIds = new Set(normalizeList(options.allowedChatIds || []));
  const botName = String(options.botName || "OpenClaw").trim() || "OpenClaw";

  let botProfile = null;

  return {
    async initialize() {
      if (!token) {
        return false;
      }

      if (botProfile) {
        return true;
      }

      botProfile = await telegramApi(token, "getMe", {});

      try {
        await telegramApi(token, "setMyCommands", {
          commands: [
            { command: "status", description: "OpenClaw system status" },
            { command: "seller", description: "Seller bot commands" },
            { command: "store", description: "Store admin commands" },
            { command: "run", description: "Create a worker shell job" },
            { command: "help", description: "Show OpenClaw commands" }
          ]
        });
      } catch {
        // Commands are optional.
      }

      return true;
    },
    async handleUpdate(update = {}) {
      await this.initialize();

      if (update.message) {
        await handleMessage(update.message);
      }
    }
  };

  async function handleMessage(message) {
    const chatId = String(message?.chat?.id || "");
    const userId = String(message?.from?.id || "");
    const text = String(message?.text || "").trim();

    if (!text) {
      return;
    }

    if (!isAuthorized(chatId, userId)) {
      await safeSendMessage(chatId, "OpenClaw chỉ nhận lệnh từ owner hoặc group đã được cấp quyền.", {
        reply_to_message_id: message.message_id
      });
      return;
    }

    if (!shouldHandleMessage(message, text)) {
      return;
    }

    const commandText = normalizeAssistantText(text);

    try {
      const result = await assistant.handle({
        text: commandText,
        actor: `telegram:${userId}`,
        userId,
        chatId,
        language: "vi"
      });

      await safeSendMessage(chatId, result?.text || DEFAULT_COPY, {
        reply_to_message_id: message.message_id,
        parse_mode: "Markdown"
      });
    } catch (error) {
      await safeSendMessage(chatId, `OpenClaw lỗi: ${error.message || error}`, {
        reply_to_message_id: message.message_id
      });
    }
  }

  function shouldHandleMessage(message, text) {
    const chatType = String(message?.chat?.type || "");
    if (chatType === "private") {
      return true;
    }

    const lower = text.toLowerCase();
    const username = String(botProfile?.username || "").toLowerCase();
    return lower.startsWith("/")
      || lower.includes("openclaw")
      || lower.includes(botName.toLowerCase())
      || (username && lower.includes(`@${username}`));
  }

  function normalizeAssistantText(text) {
    let normalized = String(text || "").trim();
    normalized = normalized.replace(new RegExp(`@${escapeRegExp(botProfile?.username || "")}`, "ig"), "").trim();
    normalized = normalized.replace(/^\/openclaw\b/i, "").trim();
    normalized = normalized.replace(/^\/status\b/i, "status").trim();
    normalized = normalized.replace(/^\/help\b/i, "help").trim();
    normalized = normalized.replace(/^\/seller\b/i, "seller").trim();
    normalized = normalized.replace(/^\/store\b/i, "store").trim();
    normalized = normalized.replace(/^\/run\b/i, "run").trim();
    normalized = normalized.replace(/^openclaw[:,]?\s*/i, "").trim();
    return normalized || "help";
  }

  function isAuthorized(chatId, userId) {
    if (ownerUserIds.size > 0 && ownerUserIds.has(userId)) {
      return true;
    }

    if (allowedChatIds.size > 0 && allowedChatIds.has(chatId)) {
      return true;
    }

    return ownerUserIds.size === 0 && allowedChatIds.size === 0;
  }

  async function safeSendMessage(chatId, text, extra = {}) {
    const payload = {
      chat_id: chatId,
      text: String(text || "").slice(0, 3900),
      ...extra
    };

    if (payload.reply_to_message_id && payload.allow_sending_without_reply === undefined) {
      payload.allow_sending_without_reply = true;
    }

    try {
      return await telegramApi(token, "sendMessage", payload);
    } catch (error) {
      if (payload.parse_mode) {
        delete payload.parse_mode;
        return telegramApi(token, "sendMessage", payload);
      }

      throw error;
    }
  }
}

async function telegramApi(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });

  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.ok) {
    throw new Error(body?.description || `Telegram API ${method} failed.`);
  }

  return body.result;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
