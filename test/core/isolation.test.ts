import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { PI_SUPPLIED } from "../../scripts/build.mjs";

const box = fileURLToPath(new URL("../../src/", import.meta.url));
const CORE = ["core/protocol.ts", "core/routing.ts", "core/titling.ts"];
const bundled = (entry: string, external: readonly string[] = []) =>
  buildSync({ absWorkingDir: box, entryPoints: [entry], bundle: true, platform: "node", format: "esm", external: [...external], write: false, metafile: true }).metafile;

// The module graph by written import paths: a dependency check, not a sandbox. A load path computed at run time, and a global such as
// `fetch`, are outside it.
it.each(CORE)("%s imports nothing but the other core files", entry => {
  const { inputs } = bundled(entry);
  expect(Object.keys(inputs).filter(path => !CORE.includes(path))).toEqual([]);
  expect(Object.values(inputs).flatMap(input => input.imports).filter(record => record.external)).toEqual([]);
});

it("bundles the extension a box installs from the live files alone, as the image build does: nothing from test/", () => {
  const inputs = Object.keys(bundled("extensions/topics.ts", PI_SUPPLIED).inputs);
  expect(inputs.filter(path => !path.startsWith("core/") && !path.startsWith("extensions/"))).toEqual([]);
  expect(inputs.sort()).toEqual(["core/protocol.ts", "core/routing.ts", "core/titling.ts", "extensions/judge.ts", "extensions/pass.ts", "extensions/topics.ts"]);
});
