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

// Jev's client is the vendor's package's, inlined with the core it is written on.
const JEV_CLIENT = ["../node_modules/@comchatx/providers/src/index.ts", "../node_modules/@comchatx/typesafe/src/index.ts"];
it("bundles the extension a box installs from the live files and Jev's client alone, as the image build does: nothing from test/", () => {
  const inputs = Object.keys(bundled("extensions/topics.ts", PI_SUPPLIED).inputs);
  expect(inputs.filter(path => !path.startsWith("core/") && !path.startsWith("extensions/") && !JEV_CLIENT.includes(path))).toEqual([]);
  expect(inputs.sort()).toEqual([...JEV_CLIENT, "core/protocol.ts", "core/routing.ts", "core/titling.ts", "extensions/judge.ts", "extensions/pass.ts", "extensions/topics.ts"]);
});
