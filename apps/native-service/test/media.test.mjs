import test from "node:test";
import assert from "node:assert/strict";
import { buildArgs, inspectProbe, validateRecipe, verifyOutput } from "../src/media.mjs";

const sample = {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1.2" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 160, height: 90 },
    { codec_type: "audio", codec_name: "aac" },
  ],
};
test("strict recipe registry blocks arbitrary filters and invalid dimensions", () => {
  assert.deepEqual(validateRecipe({ format: "mp4" }), { format: "mp4", quality: "balanced", height: null });
  assert.throws(() => validateRecipe({ format: "mp4;rm -rf /" }), /Unsupported/);
  assert.throws(() => validateRecipe({ format: "mp4", height: 9000 }), /Unsupported/);
  assert.throws(() => validateRecipe({ format: "mp4", quality: "raw" }), /Unsupported/);
  assert.throws(() => validateRecipe(null), /Invalid/);
});
test("probe accepts only media with reasonable resource limits", () => {
  const p = inspectProbe(sample);
  assert.equal(p.duration, 1.2);
  assert.equal(p.hasAudio, true);
  assert.equal(p.videoCodec, "h264");
  assert.throws(() => inspectProbe({ ...sample, format: { ...sample.format, duration: "2000" } }), /duration/);
  assert.throws(() => inspectProbe({ ...sample, streams: [{ codec_type: "video", codec_name: "h264", width: 9000, height: 100 }] }), /resolution/);
  assert.throws(() => inspectProbe({ format: {}, streams: [] }), /No audio/);
});
test("FFmpeg command uses no user-controlled raw codec/filter flags", () => {
  const args = buildArgs("/media/input.bin", "/media/output.mp4", validateRecipe({ format: "mp4", height: 720 }), inspectProbe(sample));
  assert.ok(args.includes("-protocol_whitelist"));
  assert.ok(args.includes("file,pipe"));
  assert.ok(args.includes("libx264"));
  assert.ok(args.includes("-progress"));
  assert.ok(args.find((x) => x.startsWith("scale=-2:min(ih")));
  assert.equal(args.at(-1), "/media/output.mp4");
});
test("codec and audio conservation are verified before a download is allowed", () => {
  assert.equal(verifyOutput(sample, validateRecipe({ format: "mp4" }), inspectProbe(sample)), true);
  const lostAudio = { ...sample, streams: [sample.streams[0]] };
  assert.throws(() => verifyOutput(lostAudio, validateRecipe({ format: "mp4" }), inspectProbe(sample)), /audio/);
  assert.throws(() => verifyOutput(sample, validateRecipe({ format: "flac" }), inspectProbe(sample)), /audio/);
  assert.throws(() => verifyOutput({ ...sample, format: { format_name: "avi", duration: "1.2" } }, validateRecipe({ format: "mp4" }), inspectProbe(sample)), /container/);
});
