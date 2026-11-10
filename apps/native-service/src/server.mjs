import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { FORMATS, encodeFile, inspectProbe, probeFile, validateRecipe, verifyOutput } from "./media.mjs";

const COOKIE = "ac_scope";
const STATES = new Set([
  "awaiting-upload", "uploading", "uploaded", "queued",
  "probing", "processing", "verifying", "ready", "failed", "cancelled",
]);
const defaultDir = resolve(process.env.MEDIA_DIR ?? "./.native-media");
const MB = 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...headers,
  });
  res.end(JSON.stringify(value));
}

function parseCookies(header = "") {
  const entries = String(header).split(";").map((part) => part.trim().split("="));
  return new Map(entries.filter((part) => part.length === 2));
}

function safeName(value) {
  const name = basename(String(value ?? "video")).replace(/[/\\<>:"|?*]/g, "-")
    .split("").map((c) => c.charCodeAt(0) < 32 ? "-" : c).join("")
    .trim().slice(0, 100);
  return name || "untitled";
}

function errorForUser(error) {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (message.includes("duration") || message.includes("resolution") || message.includes("too many tracks")) {
    return "The source exceeds this server's configured media limits.";
  }
  if (message.includes("cancel")) return "Processing was cancelled.";
  if (message.includes("no audio")) return "This media file has no audio track.";
  if (message.includes("no video")) return "This media file has no video track.";
  if (message.includes("unreadable") || message.includes("invalid") || message.includes("format") || message.includes("codec")) {
    return "The media format or codecs could not be processed.";
  }
  if (message.includes("timed out")) return "This conversion exceeded the processing time limit.";
  return "Unable to process this media. Try a different format or a smaller file.";
}

async function readJson(req, max = 16_384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, "Request body too large");
    chunks.push(chunk);
  }
  try {
    const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Invalid body");
    return json;
  } catch { throw new HttpError(400, "Expected a JSON object"); }
}

function positiveInt(value, fallback, minimum, maximum) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= minimum && result <= maximum ? result : fallback;
}

/**
 * Single-instance, private, self-hosted native conversion service.
 *
 * All job IDs are random. Ownership uses server-created opaque HttpOnly
 * SameSite=Strict session cookies; data lives only in an ephemeral directory.
 * This service is not multi-node or crash-durable. It must run behind a
 * same-origin HTTPS reverse proxy (e.g. the included Caddy configuration).
 */
export async function createNativeServer(options = {}) {
  const config = {
    dataDir: resolve(options.dataDir ?? defaultDir),
    publicOrigin: options.publicOrigin ?? process.env.PUBLIC_ORIGIN ?? null,
    maxUploadBytes: positiveInt(options.maxUploadBytes ?? Number(process.env.MAX_UPLOAD_MB) * MB, 512 * MB, 1, 4 * 1024 * MB),
    maxDurationSeconds: positiveInt(options.maxDurationSeconds ?? process.env.MAX_DURATION_SECONDS, 600, 1, 7200),
    maxDimension: positiveInt(options.maxDimension ?? process.env.MAX_DIMENSION, 3840, 64, 8192),
    maxActiveJobs: positiveInt(options.maxActiveJobs ?? process.env.MAX_ACTIVE_JOBS, 1, 1, 4),
    maxJobs: positiveInt(options.maxJobs ?? process.env.MAX_TOTAL_JOBS, 12, 1, 64),
    ttlMs: positiveInt(options.ttlMs ?? process.env.JOB_TTL_MS, 60 * 60 * 1000, 1000, 24 * 60 * 60 * 1000),
    maxOutputBytes: positiveInt(options.maxOutputBytes ?? Number(process.env.MAX_OUTPUT_MB) * MB, 1024 * MB, 1, 4 * 1024 * MB),
    encodeTimeoutMs: positiveInt(options.encodeTimeoutMs ?? process.env.ENCODE_TIMEOUT_MS, 15 * 60 * 1000, 500, 60 * 60 * 1000),
  };
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  // Persistent orphan files must never silently survive an instance restart.
  for (const name of await readdir(config.dataDir)) {
    if (/^[0-9a-f-]{36}$/.test(name)) {
      await rm(join(config.dataDir, name), { recursive: true, force: true });
    }
  }
  const jobs = new Map();
  const sessions = new Map();
  const queue = [];
  let active = 0;
  let closing = false;

  function sessionFor(req) {
    const sid = parseCookies(req.headers.cookie).get(COOKIE);
    return sid && sessions.has(sid) ? sid : null;
  }
  function jobFor(req, id) {
    const job = jobs.get(id);
    if (!job || job.owner !== sessionFor(req)) throw new HttpError(404, "Job not found");
    return job;
  }
  function requireOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return;
    const expected = config.publicOrigin ? new URL(config.publicOrigin).origin
      : "http://" + req.headers.host;
    if (origin !== expected) throw new HttpError(403, "Invalid request origin");
  }
  function cookieHeader(id) {
    const secure = config.publicOrigin?.startsWith("https:") ? "; Secure" : "";
    return COOKIE + "=" + id + "; HttpOnly; SameSite=Strict; Path=/api/native" + secure;
  }
  function descriptor(job) {
    return {
      id: job.id,
      filename: job.filename,
      expectedBytes: job.expectedBytes,
      uploadedBytes: job.uploadedBytes,
      state: job.state,
      stage: job.stage,
      progress: job.progress,
      format: job.recipe?.format ?? null,
      outputBytes: job.outputBytes ?? null,
      error: job.error ?? null,
      createdAt: job.createdAt,
      expiresAt: job.createdAt + config.ttlMs,
    };
  }
  function mark(job, state, stage = state) {
    if (!STATES.has(state)) throw new Error("Internal invalid state");
    if (job.state === "cancelled") return;
    job.state = state;
    job.stage = stage;
    job.updatedAt = Date.now();
  }

  async function erase(job) {
    if (job.state !== "cancelled") mark(job, "cancelled");
    job.abort?.abort();
    job.uploadRequest?.destroy();
    jobs.delete(job.id);
    const session = sessions.get(job.owner);
    session?.jobs.delete(job.id);
    // A cancelled subprocess may still have an open output handle; retry
    // cleanup when its execution finalizer closes as well.
    await rm(job.dir, { recursive: true, force: true });
  }

  function drain() {
    while (!closing && active < config.maxActiveJobs && queue.length) {
      const id = queue.shift();
      const job = jobs.get(id);
      if (!job || job.state !== "queued") continue;
      active += 1;
      job.abort = new AbortController();
      void processJob(job).finally(() => {
        active -= 1;
        if (job.state === "cancelled") void rm(job.dir, { recursive: true, force: true });
        queueMicrotask(drain);
      });
    }
  }

  async function processJob(job) {
    try {
      if (job.state === "cancelled") return;
      mark(job, "probing", "Inspecting source streams");
      const raw = await probeFile(job.input, job.abort.signal);
      const source = inspectProbe(raw, config.maxDurationSeconds, config.maxDimension);
      const spec = FORMATS[job.recipe.format];
      if (spec.kind === "audio" && !source.hasAudio) throw new Error("Source has no audio track");
      if (spec.kind !== "audio" && !source.hasVideo) throw new Error("Source has no video track");
      if (job.state === "cancelled") return;
      job.output = join(job.dir, "output." + spec.extension);
      mark(job, "processing", "Encoding media");
      await encodeFile(job.input, job.output, job.recipe, source, job.abort.signal,
        (percentage) => { if (job.state === "processing") job.progress = Math.max(job.progress ?? 0, percentage); },
        config.encodeTimeoutMs);
      if (job.state === "cancelled") return;
      mark(job, "verifying", "Verifying output codecs");
      const finalProbe = await probeFile(job.output, job.abort.signal);
      verifyOutput(finalProbe, job.recipe, source);
      const file = await stat(job.output);
      if (!file.isFile() || file.size < 64 || file.size > config.maxOutputBytes) throw new Error("Invalid output size");
      if (job.state === "cancelled") return;
      job.outputBytes = file.size;
      job.progress = 100;
      mark(job, "ready", "Ready to download");
      await rm(job.input, { force: true });
    } catch (error) {
      if (job.state !== "cancelled") {
        mark(job, "failed", "Conversion failed");
        job.error = errorForUser(error);
        await rm(job.input, { force: true });
        if (job.output) await rm(job.output, { force: true });
      }
    }
  }

  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://internal").pathname;
    try {
      if (pathname === "/api/native/health" && req.method === "GET") {
        return json(res, 200, {
          status: "ok", engine: "native-ffmpeg", openSource: true, release: "single-node",
          formats: Object.keys(FORMATS), maxUploadBytes: config.maxUploadBytes,
          maxDurationSeconds: config.maxDurationSeconds, maxDimension: config.maxDimension,
          maxActiveJobs: config.maxActiveJobs, retentionSeconds: Math.floor(config.ttlMs / 1000),
          note: "Explicit upload consent required. Jobs are ephemeral and are lost on server restart.",
        });
      }
      if (!pathname.startsWith("/api/native/")) throw new HttpError(404, "Not found");
      if (["POST", "PUT", "DELETE"].includes(req.method)) requireOrigin(req);

      if (pathname === "/api/native/jobs" && req.method === "POST") {
        const body = await readJson(req);
        if (!Number.isSafeInteger(body.bytes) || body.bytes <= 0) throw new HttpError(400, "Invalid file size");
        if (body.bytes > config.maxUploadBytes) throw new HttpError(413, "File exceeds the upload limit");
        if (typeof body.filename !== "string" || body.filename.length > 255) throw new HttpError(400, "Invalid filename");
        if (jobs.size >= config.maxJobs) throw new HttpError(429, "This server is at capacity");

        let sid = sessionFor(req);
        if (!sid) {
          sid = randomBytes(32).toString("hex");
          sessions.set(sid, { jobs: new Set(), requests: [] });
        }
        const session = sessions.get(sid);
        const now = Date.now();
        session.requests = session.requests.filter((time) => now - time < 60_000);
        if (session.requests.length >= 5 || session.jobs.size >= 4) throw new HttpError(429, "Too many requests from this session");
        session.requests.push(now);
        const id = randomUUID();
        const dir = join(config.dataDir, id);
        await mkdir(dir, { mode: 0o700 });
        const job = {
          id, owner: sid, filename: safeName(body.filename), expectedBytes: body.bytes,
          uploadedBytes: 0, state: "awaiting-upload", stage: "Waiting for file",
          progress: null, createdAt: now, updatedAt: now, dir,
          input: join(dir, "input.bin"), output: null, recipe: null,
          abort: null, uploadRequest: null, error: null, outputBytes: null,
        };
        jobs.set(id, job);
        session.jobs.add(id);
        return json(res, 201, descriptor(job), { "Set-Cookie": cookieHeader(sid) });
      }
      const match = /^\/api\/native\/jobs\/([0-9a-f-]{36})(?:\/(input|start|download))?$/.exec(pathname);
      if (!match) throw new HttpError(404, "Not found");
      const job = jobFor(req, match[1]);
      const action = match[2] ?? "";

      if (req.method === "GET" && action === "") return json(res, 200, descriptor(job));

      if (req.method === "PUT" && action === "input") {
        if (job.state !== "awaiting-upload") throw new HttpError(409, "This job cannot accept an upload");
        const declared = Number(req.headers["content-length"]);
        if (!Number.isSafeInteger(declared) || declared !== job.expectedBytes) throw new HttpError(413, "Upload size mismatch");
        if (req.headers["content-type"]?.split(";")[0] !== "application/octet-stream") {
          throw new HttpError(415, "Expected binary file upload");
        }
        mark(job, "uploading", "Receiving file");
        job.uploadRequest = req;
        const part = join(job.dir, "input.part");
        let bytes = 0;
        const limit = new Transform({
          transform(chunk, _encoding, callback) {
            bytes += chunk.length;
            if (bytes > job.expectedBytes) callback(new Error("Upload overflow"));
            else {
              job.uploadedBytes = bytes;
              callback(null, chunk);
            }
          },
        });
        try {
          await pipeline(req, limit, createWriteStream(part, { flags: "wx", mode: 0o600 }));
          if (bytes !== job.expectedBytes) throw new Error("Truncated upload");
          const { rename } = await import("node:fs/promises");
          await rename(part, job.input);
          mark(job, "uploaded", "Upload complete");
          return json(res, 200, descriptor(job));
        } catch {
          if (job.state !== "cancelled") {
            job.uploadedBytes = 0;
            mark(job, "awaiting-upload", "Upload interrupted");
          }
          await rm(part, { force: true });
          if (!res.headersSent && !res.destroyed) return json(res, 400, { error: "Upload interrupted; retry with the original file" });
          return;
        } finally {
          job.uploadRequest = null;
        }
      }

      if (req.method === "POST" && action === "start") {
        if (job.state !== "uploaded") throw new HttpError(409, "Upload must complete before conversion");
        const raw = await readJson(req);
        let recipe;
        try { recipe = validateRecipe(raw); }
        catch { throw new HttpError(400, "Unsupported conversion settings"); }
        job.recipe = recipe;
        mark(job, "queued", "Waiting for an available CPU worker");
        queue.push(job.id);
        queueMicrotask(drain);
        return json(res, 202, descriptor(job));
      }

      if (req.method === "DELETE" && action === "") {
        await erase(job);
        res.writeHead(204, { "Cache-Control": "no-store" });
        return res.end();
      }

      if (req.method === "GET" && action === "download") {
        if (job.state !== "ready" || !job.output) throw new HttpError(409, "File not ready");
        const file = await stat(job.output);
        const spec = FORMATS[job.recipe.format];
        const name = safeName(job.filename.replace(/\.[^.]+$/, "")) + "-converted." + spec.extension;
        // An ASCII fallback prevents invalid HTTP headers for Unicode names.
        // filename* carries the full UTF-8 filename without a query token.
        const ascii = Array.from(name, (character) => {
          const point = character.codePointAt(0) ?? 0;
          return point < 32 || point > 126 ? "_" : character;
        }).join("");
        const disposition = "attachment; filename=" + JSON.stringify(ascii) + "; filename*=UTF-8\'\'" + encodeURIComponent(name);
        res.writeHead(200, {
          "Content-Type": spec.mime, "Content-Length": file.size,
          "Content-Disposition": disposition,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'",
          "Referrer-Policy": "no-referrer",
          "Accept-Ranges": "none",
        });
        return createReadStream(job.output).pipe(res);
      }
      throw new HttpError(405, "Method not allowed");
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        const status = error instanceof HttpError ? error.status : 500;
        json(res, status, { error: status === 500 ? "Service temporarily unavailable" : error.message });
      }
    }
  });

  // Size-limited jobs can be uploaded slowly; do not silently hang forever.
  server.requestTimeout = 15 * 60 * 1000;
  server.headersTimeout = 60 * 1000;

  const interval = setInterval(() => {
    const now = Date.now();
    for (const job of jobs.values()) {
      if (now - job.createdAt >= config.ttlMs) void erase(job);
    }
    for (const [id, session] of sessions) {
      if (session.jobs.size === 0 && session.requests.every((time) => now - time > 60_000)) sessions.delete(id);
    }
  }, Math.min(config.ttlMs, 60_000));
  interval.unref();

  return {
    server, config,
    listen(port = 4300, host = "127.0.0.1") {
      return new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(port, host, () => {
          server.removeListener("error", rejectListen);
          resolveListen(server.address());
        });
      });
    },
    async close() {
      closing = true;
      clearInterval(interval);
      for (const job of jobs.values()) job.abort?.abort();
      await new Promise((resolveClose) => server.close(resolveClose));
      await Promise.all([...jobs.values()].map((job) => rm(job.dir, { recursive: true, force: true })));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createNativeServer();
  const host = process.env.HOST ?? "127.0.0.1";
  const port = positiveInt(process.env.PORT, 4300, 1, 65535);
  await app.listen(port, host);
  process.stdout.write("Any-Convert native engine listening on " + host + ":" + port + "\n");
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
