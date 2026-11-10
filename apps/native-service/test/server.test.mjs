import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeServer } from "../src/server.mjs";

const fixtures = fileURLToPath(new URL("../../../tests/fixtures/generated/", import.meta.url));
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "any-convert-native-"));
  const app = await createNativeServer({
    dataDir: dir, maxUploadBytes: 20 * 1024 * 1024, ttlMs: 20_000,
    encodeTimeoutMs: 20_000,
  });
  const address = await app.listen(0, "127.0.0.1");
  const base = "http://127.0.0.1:" + address.port + "/api/native";
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const create = async (name, bytes) => {
    const res = await fetch(base + "/jobs", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:" + address.port },
      body: JSON.stringify({ filename: name, bytes }),
    });
    return { res, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  const request = (path, cookie, options = {}) => fetch(base + path, {
    ...options, headers: { ...(options.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  return { base, dir, create, request };
}

async function waitForTerminal(env, id, cookie, maxMs = 15_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const res = await env.request("/jobs/" + id, cookie);
    assert.equal(res.status, 200);
    const status = await res.json();
    if (["ready", "failed", "cancelled"].includes(status.state)) return status;
    await nap(150);
  }
  throw new Error("Native test job did not become terminal");
}

test("privacy: session ownership, origin check and strict upload limits", async (t) => {
  const env = await setup(t);
  const tooLarge = await env.create("huge.mkv", 21 * 1024 * 1024);
  assert.equal(tooLarge.res.status, 413);

  const created = await env.create("../../bad\\name\u0000.mp4", 100);
  assert.equal(created.res.status, 201);
  const job = await created.res.json();
  assert.ok(job.id);
  assert.ok(!job.filename.includes("/"));
  assert.ok(!job.filename.includes("\u0000"));

  assert.equal((await env.request("/jobs/" + job.id, null)).status, 404);
  assert.equal((await env.request("/jobs/" + job.id + "/download", null)).status, 404);
  assert.equal((await env.request("/jobs/" + job.id + "/input", created.cookie, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from("short"),
  })).status, 413);

  const host = new URL(env.base).origin;
  const wrongOrigin = await fetch(env.base + "/jobs", {
    method: "POST", headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ filename: "evil.mp4", bytes: 10 }),
  });
  assert.equal(wrongOrigin.status, 403);
  assert.ok(host.startsWith("http://127.0.0.1:"));
  assert.equal((await env.request("/jobs/" + job.id, created.cookie, { method: "DELETE" })).status, 204);
  assert.equal((await env.request("/jobs/" + job.id, created.cookie)).status, 404);
});

test("full workflow: upload, FFmpeg MP4, progress, scoped download, delete", async (t) => {
  const env = await setup(t);
  const bytes = await readFile(join(fixtures, "baseline-h264-aac.mp4"));
  const { res, cookie } = await env.create("café 雪.mov", bytes.length);
  assert.equal(res.status, 201);
  const job = await res.json();

  const upload = await env.request("/jobs/" + job.id + "/input", cookie, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes,
  });
  assert.equal(upload.status, 200);
  assert.equal((await upload.json()).state, "uploaded");
  assert.equal((await env.request("/jobs/" + job.id + "/start", cookie, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "mp4", quality: "balanced", height: 720 }),
  })).status, 202);

  const terminal = await waitForTerminal(env, job.id, cookie);
  assert.equal(terminal.state, "ready", terminal.error ?? "Should be ready");
  assert.equal(terminal.progress, 100);
  assert.ok(terminal.outputBytes > 100);
  assert.equal((await env.request("/jobs/" + job.id + "/download", null)).status, 404);

  const download = await env.request("/jobs/" + job.id + "/download", cookie);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-type"), /video\/mp4/);
  assert.match(download.headers.get("content-disposition"), /attachment/);
  assert.match(download.headers.get("content-disposition"), /filename\*=UTF-8/);
  const output = join(env.dir, "actual.mp4");
  await writeFile(output, Buffer.from(await download.arrayBuffer()));
  const probe = JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_name,codec_type", "-of", "json", output,
  ], { encoding: "utf8" }));
  assert.ok(probe.streams.some((stream) => stream.codec_name === "h264"));
  assert.ok(probe.streams.some((stream) => stream.codec_name === "aac"));

  assert.equal((await env.request("/jobs/" + job.id, cookie, { method: "DELETE" })).status, 204);
  assert.equal((await env.request("/jobs/" + job.id + "/download", cookie)).status, 404);
});

test("invalid source safely fails without publishing or leaking input", async (t) => {
  const env = await setup(t);
  const bytes = Buffer.from("not-real-video");
  const { res, cookie } = await env.create("broken.mp4", bytes.length);
  const job = await res.json();
  assert.equal((await env.request("/jobs/" + job.id + "/input", cookie, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes,
  })).status, 200);
  assert.equal((await env.request("/jobs/" + job.id + "/start", cookie, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "mp4" }),
  })).status, 202);
  const status = await waitForTerminal(env, job.id, cookie);
  assert.equal(status.state, "failed");
  assert.ok(typeof status.error === "string");
  assert.equal((await env.request("/jobs/" + job.id + "/download", cookie)).status, 409);
  const jobFolder = join(env.dir, job.id);
  assert.equal((await readdir(jobFolder)).filter((file) => file.startsWith("input")).length, 0);
});

test("audio extraction and GIF are genuine FFmpeg outputs", async (t) => {
  const env = await setup(t);
  for (const [fixture, format, codec] of [
    ["baseline-h264-aac.mp4", "gif", "gif"],
    ["pcm-audio.wav", "flac", "flac"],
  ]) {
    const bytes = await readFile(join(fixtures, fixture));
    const { res, cookie } = await env.create(fixture, bytes.length);
    const job = await res.json();
    assert.equal((await env.request("/jobs/" + job.id + "/input", cookie, {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes,
    })).status, 200);
    assert.equal((await env.request("/jobs/" + job.id + "/start", cookie, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format }),
    })).status, 202);
    const status = await waitForTerminal(env, job.id, cookie);
    assert.equal(status.state, "ready", format + ": " + (status.error ?? "error"));
    const dl = await env.request("/jobs/" + job.id + "/download", cookie);
    const output = join(env.dir, "validated-" + format + "." + format);
    await writeFile(output, Buffer.from(await dl.arrayBuffer()));
    const p = JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_name", "-of", "json", output,
    ], { encoding: "utf8" }));
    assert.ok(p.streams.some((stream) => stream.codec_name === codec));
    await env.request("/jobs/" + job.id, cookie, { method: "DELETE" });
  }
});
