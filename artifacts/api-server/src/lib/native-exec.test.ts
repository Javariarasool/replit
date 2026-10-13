import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { nativeExec } from "./native-exec";

test("native cancellation waits for process exit before releasing its inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-cancel-test-"));
  const path = join(directory, "ready");
  const controller = new AbortController();
  const work = nativeExec(process.execPath, ["-e",
    `require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);`, path],
  { timeout: 5000 }, controller.signal);
  // Attach immediately so an unexpected early process failure is not unhandled.
  const rejected = assert.rejects(work, /abort/i);
  try {
    let pid = 0;
    for (let i = 0; i < 200 && !pid; i++) {
      try { pid = Number(await readFile(path, "utf8")); } catch { await delay(10); }
    }
    assert.ok(pid, "native process started");
    controller.abort();
    await rejected;
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { controller.abort(); await rejected; await rm(directory, { recursive: true, force: true }); }
});

test("pre-cancelled native calls do not spawn and normal failures remain failures", async () => {
  const controller = new AbortController(); controller.abort();
  assert.throws(() => nativeExec(process.execPath, ["-e", "process.exit(0)"], {}, controller.signal), /abort/i);
  assert.equal((await nativeExec(process.execPath, ["-e", "process.stdout.write('complete')"], {})).stdout, "complete");
  await assert.rejects(nativeExec(process.execPath, ["-e", "process.exit(1)"], {}));
});
