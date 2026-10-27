import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

/** Pi supplies these to every extension; a package declares them as peers and does not bundle them (pi's packages.md, *Dependencies*). */
export const PI_SUPPLIED = ["@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"];

/**
 * Bundles `src/extensions/topics.ts` into `dist/extensions/topics.js`, its own imports inlined and pi's left for pi to supply. Pi loads
 * every module in an extensions directory, so the one extension is the only module there; `judge.ts` and `pass.ts` are inlined into it.
 */
export function build(root) {
  const out = join(root, "dist", "extensions");
  rmSync(join(root, "dist"), { recursive: true, force: true });
  buildSync({ entryPoints: [join(root, "src", "extensions", "topics.ts")], outdir: out, bundle: true, platform: "node", format: "esm", external: PI_SUPPLIED, logLevel: "warning" });
  return [join(out, "topics.js")];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) build(resolve(fileURLToPath(new URL("..", import.meta.url))));
