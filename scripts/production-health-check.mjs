const healthUrl = String(
  process.env.OPENCLAW_HEALTH_URL || "https://openclaw-control-plane.vercel.app/api/health"
).trim();
const expectedModel = String(process.env.OPENCLAW_EXPECTED_MODEL || "openai-codex/gpt-5.4").trim();

if (!healthUrl) {
  throw new Error("OPENCLAW_HEALTH_URL is required.");
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15_000);

try {
  const response = await fetch(healthUrl, {
    headers: { Accept: "application/json" },
    signal: controller.signal
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.ok) {
    throw new Error(`Health endpoint failed with HTTP ${response.status}.`);
  }

  if (body.agent?.enabled !== true) {
    throw new Error("OpenClaw agent is not enabled in production.");
  }

  if (expectedModel && body.agent?.model !== expectedModel) {
    throw new Error(`Unexpected production model: ${body.agent?.model || "unset"}.`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        service: body.service,
        storageMode: body.storageMode,
        agentModel: body.agent.model,
        latestRun: body.agent?.runs?.latestRun || null
      },
      null,
      2
    )
  );
} finally {
  clearTimeout(timeout);
}
