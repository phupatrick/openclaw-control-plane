import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const envFromFile = loadEnvFile(path.join(rootDir, ".env"));

const token = process.env.OPENCLAW_TELEGRAM_BOT_TOKEN || envFromFile.OPENCLAW_TELEGRAM_BOT_TOKEN || "";
const siteUrl = normalizeUrl(process.env.SITE_URL || envFromFile.SITE_URL || "https://openclaw-control-plane.vercel.app");
const webhookPath = normalizePath(
  process.env.OPENCLAW_TELEGRAM_WEBHOOK_PATH
    || envFromFile.OPENCLAW_TELEGRAM_WEBHOOK_PATH
    || "/api/telegram/openclaw/webhook"
);
const secret = process.env.OPENCLAW_TELEGRAM_WEBHOOK_SECRET || envFromFile.OPENCLAW_TELEGRAM_WEBHOOK_SECRET || "";
const shouldDelete = process.argv.includes("--delete");

if (!token) {
  console.error("Missing OPENCLAW_TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}

const method = shouldDelete ? "deleteWebhook" : "setWebhook";
const payload = shouldDelete
  ? { drop_pending_updates: false }
  : {
      url: `${siteUrl}${webhookPath}`,
      allowed_updates: ["message"],
      ...(secret ? { secret_token: secret } : {})
    };

const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});

const body = await response.json();
console.log(JSON.stringify(body, null, 2));

if (!response.ok || !body.ok) {
  process.exit(1);
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

function normalizeUrl(value) {
  const normalized = String(value || "").trim();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function normalizePath(value) {
  const normalized = String(value || "").trim();
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}
