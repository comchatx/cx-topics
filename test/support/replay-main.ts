// The calibration replay, run by hand: `--live` against TypeSafe and OpenRouter on the development keys, read by name from
// `--keys <env file>`; otherwise against a stand-in whose answers mean nothing. Writes the records as JSON and the sheet as markdown
// to `--out <prefix>`. pi gets a HOME and an agent directory of its own, so no login of the machine's is read or written.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const live = args.includes("--live");
const out = flag("--out") ?? join(tmpdir(), "topics-replay");
const limit = Number(flag("--budget") ?? "2");
const only = flag("--cases")?.split(",");

const home = mkdtempSync(join(tmpdir(), "topics-replay-"));
process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = join(home, "agent");

const { CALIBRATION_CASES } = await import("./calibration-cases.js");
const { keysIn, LIVE, registryFor, replay, sheet } = await import("./replay.js");
const { standIn } = await import("./replay-stand-in.js");
const image = JSON.parse(readFileSync("test/fixtures/image-models.json", "utf8"));

let close = async () => {};
try {
  let upstreams = LIVE;
  if (live) {
    const keys = keysIn(readFileSync(flag("--keys") ?? "", "utf8"));
    if (keys.CMX_KEY_TYPESAFE === undefined || keys.CMX_KEY_OPENROUTER === undefined) throw new Error("the keys file holds CMX_KEY_TYPESAFE and CMX_KEY_OPENROUTER: not both found");
    process.env.CMX_KEY_TYPESAFE = keys.CMX_KEY_TYPESAFE;
    process.env.CMX_KEY_OPENROUTER = keys.CMX_KEY_OPENROUTER;
  } else {
    const listener = await standIn();
    upstreams = listener.upstreams;
    close = listener.close;
    process.env.CMX_KEY_TYPESAFE = "stand-in";
    process.env.CMX_KEY_OPENROUTER = "stand-in";
  }
  const registry = await registryFor(image, upstreams, home);
  const cases = only === undefined ? CALIBRATION_CASES : CALIBRATION_CASES.filter(item => only.includes(item.id));
  const result = await replay(registry, cases, limit, home);
  writeFileSync(`${out}.json`, `${JSON.stringify({ live, at: new Date().toISOString(), ...result }, null, 2)}\n`);
  writeFileSync(`${out}.md`, `${sheet(result)}\n`);
  console.log(`${out}.md`);
} finally {
  await close();
  rmSync(home, { recursive: true, force: true });
}
