import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createControlPlane } from "../src/control-plane.mjs";

const tempPath = path.join(
  os.tmpdir(),
  `openclaw-control-plane-standalone-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
);

try {
  const controlPlane = createControlPlane({
    statePath: tempPath,
    heartbeatTimeoutSeconds: 60,
    defaultJobLeaseSeconds: 30
  });

  const worker = await controlPlane.registerWorker({
    workerId: "pc-main",
    label: "Main Desktop",
    capabilities: ["shell", "windows"]
  });
  assert.equal(worker.id, "pc-main");

  const job = await controlPlane.createJob({
    type: "shell",
    capability: "shell",
    command: "echo hello"
  });
  assert.equal(job.status, "queued");

  const claimed = await controlPlane.claimNextJob({
    workerId: "pc-main",
    capabilities: ["shell", "windows"]
  });
  assert.equal(claimed.id, job.id);

  await controlPlane.heartbeatJob({
    workerId: "pc-main",
    jobId: job.id
  });

  const completed = await controlPlane.completeJob({
    workerId: "pc-main",
    jobId: job.id,
    result: { stdout: "hello" }
  });
  assert.equal(completed.status, "completed");

  const summary = await controlPlane.getSummary();
  assert.equal(summary.workers.total, 1);
  assert.equal(summary.jobs.completed, 1);

  console.log("control-plane.test.mjs passed");
} finally {
  fs.rmSync(tempPath, { force: true });
}
