import { spawn } from "node:child_process";

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type RunOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

// Bounded capture prevents an unexpected binary from exhausting API memory.
// Never pass a shell string or untrusted user-generated filter expression.
export function runCommand(
  binary: string,
  args: readonly string[],
  { timeoutMs = 120_000, signal }: RunOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Command aborted."));
      return;
    }

    const child = spawn(binary, [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let stdout = "";
    let stderr = "";
    let exceeded = false;
    let timedOut = false;
    let settled = false;

    const append = (old: string, chunk: Buffer) => {
      const combined = old + chunk.toString("utf8");
      if (combined.length > 512_000) {
        exceeded = true;
        child.kill("SIGKILL");
        return combined.slice(-512_000);
      }
      return combined;
    };

    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }

    child.on("error", (error) => fail(error));
    child.on("close", (code) => {
      if (settled) return;
      clearTimeout(timer);
      if (exceeded) return fail(new Error("Media command output exceeded safety limit."));
      if (timedOut) return fail(new Error("Media command timed out."));
      if (code !== 0) return fail(new Error(binary + " exited " + code + ": " + stderr.slice(-3_000)));
      settled = true;
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}
