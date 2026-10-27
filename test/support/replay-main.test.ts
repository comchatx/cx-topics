import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterEach, expect, it } from "vitest";

const run = promisify(execFile);
const repository = resolve(import.meta.dirname, "../..");
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

/** A directory removed after the test; under the repository's `node_modules`, a bundle there finds the packages it leaves out. */
function owned(under: string, prefix: string): string {
  mkdirSync(under, { recursive: true });
  const dir = mkdtempSync(join(under, prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Above the 60 s its replay is given, so the replay's own timeout is what reports a hang.
it("runs by hand on the stand-in with no key: the cases named alone, the records and the sheet written where asked, and its own home removed", async () => {
  const bundled = owned(join(repository, "node_modules", ".cache"), "replay-main-");
  const temporary = owned(tmpdir(), "replay-main-tmp-");
  const out = join(owned(tmpdir(), "replay-main-out-"), "run");
  const entry = join(bundled, "replay-main.mjs");
  await build({ absWorkingDir: repository, entryPoints: ["test/support/replay-main.ts"], outfile: entry, bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  // Nothing of the machine's reaches it: no key, no home, a temporary directory of the test's own.
  const { stdout } = await run(process.execPath, [entry, "--cases", "witness", "--out", out], { cwd: repository, env: { PATH: process.env.PATH ?? "", TMPDIR: temporary }, timeout: 60_000 });
  expect(stdout.trim()).toBe(`${out}.md`);
  const records = JSON.parse(readFileSync(`${out}.json`, "utf8")) as { readonly live: boolean; readonly cases: readonly { readonly id: string }[] };
  expect([records.live, records.cases.map((item) => item.id)]).toEqual([false, ["witness"]]);
  expect(readFileSync(`${out}.md`, "utf8")).toMatch(/^### witness\n/);
  expect(readdirSync(temporary).filter((name) => name.startsWith("topics-replay-"))).toEqual([]);
}, 90_000);
