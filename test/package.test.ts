import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { build } from "../scripts/build.mjs";
import { INSTALLS_FILE, installKey } from "../src/extensions/pass.js";
import { JEV, TITLE_MODEL } from "../src/extensions/judge.js";
import { loadPackage } from "./pi.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BUILT = join(ROOT, "dist", "extensions", "topics.js");

it("the pinned pi loads the one extension from the built dist/, with its tool and its four handlers", async () => {
  expect(build(ROOT)).toEqual([BUILT]);
  const { extensions, errors } = await loadPackage(ROOT);
  expect(errors).toEqual([]);
  expect(extensions.map((extension) => extension.path)).toEqual([BUILT]);
  expect(extensions.map((extension) => [...extension.tools.keys()])).toEqual([["quoted"]]);
  expect(extensions.map((extension) => [...extension.handlers.keys()].sort())).toEqual([["context", "message_end", "session_shutdown", "session_start"]]);
});

it("the built module carries what a box holds the package to: the installs file and key, and the two models it asks", async () => {
  build(ROOT);
  const built = (await import(pathToFileURL(BUILT).href)) as Record<string, unknown>;
  expect([built["INSTALLS_FILE"], built["JEV"], built["TITLE_MODEL"]]).toEqual([INSTALLS_FILE, JEV, TITLE_MODEL]);
  expect((built["installKey"] as typeof installKey)("npm:@comchatx/cx-topics@0.1.3")).toBe(installKey("npm:@comchatx/cx-topics@0.1.3"));
});

it("ships the built extension alone", () => {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8" })) as { files: { path: string }[] }[];
  expect(packed[0]!.files.map((file) => file.path).sort()).toEqual(["LICENSE", "README.md", "dist/extensions/topics.js", "package.json"]);
});

// Declared as a module, pi loads the bundle natively and `import.meta.url` is the file's real path, while pi lists the tool's source
// path as written: behind a symlink (`/var` on macOS) `ownKey` then finds no key and an install goes unseen. With no type, pi's jiti
// loads it at the path pi lists, as the product's own build was loaded.
it("declares no module type, so pi loads the module at the path it lists the tool's source by", () => {
  expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))).not.toHaveProperty("type");
});
