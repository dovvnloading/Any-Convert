import { convertUniversalMp4 } from "./convert";
import { probeMedia } from "./probe";

async function main() {
  const [operation, input, output] = process.argv.slice(2);
  if (operation === "probe" && input && !output) {
    console.log(JSON.stringify(await probeMedia(input), null, 2));
    return;
  }
  if (operation === "convert" && input && output) {
    const result = await convertUniversalMp4(input, output);
    console.log(JSON.stringify({ output, verified: true, probe: result }, null, 2));
    return;
  }
  console.error("Usage: pnpm --filter @any-convert/media-worker dev probe <input>");
  console.error("       pnpm --filter @any-convert/media-worker dev convert <input> <output.mp4>");
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown media worker failure.");
  process.exitCode = 1;
});
