import { execFile, type ExecFileOptions } from "node:child_process";

// Do not use execFile's built-in AbortSignal: it rejects before the child closes.
// Wait for close so callers can safely remove OCR inputs and release worker slots.
export function nativeExec(file: string, args: string[], options: ExecFileOptions, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { ...options, encoding: "utf8", killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(signal.reason);
      else if (error) reject(error);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    const abort = () => { child.kill("SIGKILL"); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
