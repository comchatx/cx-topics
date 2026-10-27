import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { TITLE_MODEL } from "../../src/extensions/judge.js";
import { CALIBRATION_CASES, type CalibrationCase } from "./calibration-cases.js";
import { keysIn, LIVE, modelsFor, registryFor, replay, sheet } from "./replay.js";
import { byWords, standIn, type Scripted } from "./replay-stand-in.js";

const IMAGE = JSON.parse(readFileSync("test/fixtures/image-models.json", "utf8"));
const cleanups: (() => unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** pi's own registry on a stand-in, in a directory of the test's own, with the keys pi reads by name set to nothing real. */
async function rig(options: Parameters<typeof standIn>[0] = {}) {
  const dir = mkdtempSync(join(tmpdir(), "topics-replay-test-"));
  const listener = await standIn(options);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }), listener.close);
  process.env.CMX_KEY_TYPESAFE = "stand-in";
  process.env.CMX_KEY_OPENROUTER = "stand-in";
  cleanups.push(() => { delete process.env.CMX_KEY_TYPESAFE; delete process.env.CMX_KEY_OPENROUTER; });
  return { dir, listener, registry: await registryFor(IMAGE, listener.upstreams, dir) };
}

const CASE: CalibrationCase = {
  id: "invented", source: "invented",
  messages: [
    { text: "Plan the invented yoga mat stock.", expect: "new" },
    { text: "Make it 45 days.", expect: "continue", stale: false },
    { text: "New topic: the invented ad budget.", expect: "new" },
    { text: "And for Canada?", expect: "new" },
    { text: "Anything else?", expect: "either" },
  ],
};

it("replays a case through the package's judging on pi's registry, keeping each answer, bar, verdict, title and call", async () => {
  const { dir, registry, listener } = await rig();
  const { cases } = await replay(registry, [CASE], 2, dir);
  const [record] = cases;
  expect(record!.messages.map(m => [m.verdict, m.pass, m.titled?.title, m.titled?.on])).toEqual([
    ["first", undefined, "Plan the inv", 0],
    ["continue", true, undefined, undefined],
    ["new", true, "New topic: t", 2],
    ["continue", false, undefined, undefined],
    ["continue", undefined, undefined, undefined],
  ]);
  expect(record!.messages[1]).toMatchObject({ topic: { title: "Plan the inv", length: 1 }, answers: { significantChange: 0.1, continueCurrent: 0.9, titleAdequate: 0.6 }, bars: { continuing: 0.5, change: 0.5, staleTitle: 0.2 }, stopped: false });
  expect(record!.messages[4]!.topic).toEqual({ title: "New topic: t", length: 2 });
  expect(record!.failures).toBe(1);
  expect(record!.otherLanguage).toBe(0);
  // One title call for each of the two titles, one Jev call for each of the four judged messages, each priced as the ledger books it.
  expect(record!.messages.flatMap(m => m.calls.map(call => call.kind))).toEqual(["title", "jev", "jev", "title", "jev", "jev"]);
  expect(record!.messages[1]!.calls[0]).toMatchObject({ kind: "jev", inputTokens: 300 });
  expect(record!.messages[1]!.calls[0]!.units).toBeCloseTo(300 * 0.042 * 1.3);
  expect(record!.messages[0]!.calls[0]!.units).toBeCloseTo((100 * 0.3 + 10 * 1.2) * 1.3);
  expect(record!.usd).toBeCloseTo(record!.messages.flatMap(m => m.calls).reduce((sum, call) => sum + call.usd, 0));
  // Jev is shown the seller's words alone: cx's reply after each message reaches no request.
  expect(JSON.stringify(listener.seen)).not.toContain("cx's reply");
  expect(sheet({ cases })).toMatch(/\| 3 \| And for Canada\? \| new \| New topic: t \(1\) \| 0\.10 \/ 0\.90 \/ 0\.60 \| 0\.50 \/ 0\.50 \| continue \| — \| FAIL \|[\s\S]*All cases: 1 failures; 0 titles in another language/);
});

it("marks a title written in another language than the message it was written on", async () => {
  const { dir, registry } = await rig();
  // The stand-in titles a message by its first twelve characters: here English words for a message holding Chinese.
  const mixed: CalibrationCase = { id: "mixed", source: "invented", messages: [{ text: "Plan the invented mats.", expect: "new" }, { text: "New topic: Invented 瑜伽垫 plan.", expect: "new" }] };
  const { cases } = await replay(registry, [mixed], 2, dir);
  expect(cases[0]!.messages.map(m => m.titled?.sameLanguage)).toEqual([true, false]);
  expect(cases[0]!.otherLanguage).toBe(1);
  expect(sheet({ cases })).toMatch(/on #1: New topic: I \(other language\)[\s\S]*Titles in another language than their message: 1\./);
});

it("records a rewrite on the row's first message, and holds a continuation to whether its title should stand", async () => {
  const stale: Scripted = (latest, question) => (question === "titleAdequate" ? 0.1 : byWords(latest, question));
  const { dir, registry } = await rig({ scripted: stale });
  const { cases } = await replay(registry, [CASE], 2, dir);
  const messages = cases[0]!.messages;
  expect(messages[1]).toMatchObject({ verdict: "continue, rewrite asked", titled: { title: "Make it 45 d", on: 0, rewrite: true }, pass: false });
  expect(sheet({ cases })).toContain("rewrite on #0: Make it 45 d");
});

it("tells a rewrite Jev asked for from a title rewritten: one that comes back as the same words writes nothing, and the sheet says none was written", async () => {
  const stale: Scripted = (latest, question) => (question === "titleAdequate" ? 0.1 : byWords(latest, question));
  const { dir, registry } = await rig({ scripted: stale });
  // The stand-in titles by a message's first twelve characters, so the rewrite on the second comes back as the first's title.
  const same: CalibrationCase = { id: "same", source: "invented", messages: [{ text: "Plan the invented yoga mat stock.", expect: "new" }, { text: "Plan the invented mats for May.", expect: "continue", stale: true }] };
  const { cases } = await replay(registry, [same], 2, dir);
  const second = cases[0]!.messages[1]!;
  expect([second.verdict, second.titled, second.pass]).toEqual(["continue, rewrite asked", undefined, true]);
  expect(sheet({ cases })).toMatch(/\| continue, rewrite asked \| — \(none written\) \| ok \|/);
});

it("records a failed call as no verdict, its reason kept and the judgment stopped, and counts it as no failure of the words", async () => {
  const { dir, registry } = await rig({ fail: { status: 503, body: "{\"error\":\"invented\"}" } });
  const { cases } = await replay(registry, [CASE], 2, dir);
  const [first, second] = cases[0]!.messages;
  expect(first).toMatchObject({ verdict: "first", stopped: true, calls: [{ kind: "title", failure: expect.stringMatching(/^error: 503/) }] });
  expect(first!.titled).toBeUndefined();
  // No title yet, so the second message opens the conversation's first row in turn.
  expect(second).toMatchObject({ verdict: "first", stopped: true });
  expect(cases[0]!.failures).toBe(0);
});

it("records a Jev call that failed as unavailable, with its reason, and marks it no verdict on the sheet", async () => {
  const { dir, registry } = await rig({ fail: { status: 429, body: "{\"error\":\"invented\"}", only: "jev" } });
  const { cases } = await replay(registry, [CASE], 2, dir);
  const second = cases[0]!.messages[1]!;
  expect(second).toMatchObject({ verdict: "unavailable", reason: "refused", stopped: true, topic: { title: "Plan the inv", length: 1 } });
  expect(second.answers).toBeUndefined();
  expect(second.pass).toBeUndefined();
  expect(second.calls).toMatchObject([{ kind: "jev", failure: expect.stringMatching(/429/) }]);
  expect(sheet({ cases })).toMatch(/\| 1 \| Make it 45 days\. \|[^\n]*\| unavailable \(refused\) \| — \| no verdict \|/);
});

it("stops before the message after its budget is spent, recording the cases done and naming where it stopped", async () => {
  const { dir, registry } = await rig();
  const result = await replay(registry, [CASE, { ...CASE, id: "second" }], 0.00014, dir);
  expect(result.cases.map(item => item.id)).toEqual(["invented"]);
  expect(result.stoppedBy).toMatch(/^second: spent US\$0\.0002 of US\$0\.00014$/);
  expect(sheet(result)).toMatch(/Stopped by the budget at second/);
});

it("sends the image's own entries to the upstreams on the keys pi reads by name, the title model's alone kept", () => {
  const models = modelsFor(IMAGE, LIVE, TITLE_MODEL);
  expect(Object.keys(models.providers)).toEqual(["typesafe", "balance"]);
  expect(models.providers.typesafe).toMatchObject({ baseUrl: "https://api.typesafe.ai/v1", apiKey: "${CMX_KEY_TYPESAFE}" });
  expect(models.providers.balance).toMatchObject({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "${CMX_KEY_OPENROUTER}", aggregator: IMAGE.providers.balance.aggregator, modelOverrides: IMAGE.providers.balance.modelOverrides });
  expect(models.providers.balance!.models).toEqual([{ ...IMAGE.providers.balance.models.find((model: { id: string }) => model.id === "minimax/minimax-m3"), baseUrl: "https://openrouter.ai/api/v1" }]);
});

it("reads the two keys by name from an env file, quoted, exported or after a Bearer, and no other line", () => {
  expect(keysIn("A=1\nexport CMX_KEY_TYPESAFE='ts-invented'\nCMX_KEY_OPENROUTER = \"or-invented\" \nCMX_KEY_OTHER=x\n")).toEqual({ CMX_KEY_TYPESAFE: "ts-invented", CMX_KEY_OPENROUTER: "or-invented" });
  expect(keysIn("CMX_KEY_TYPESAFE=Bearer ts-invented\nCMX_KEY_OPENROUTER='Bearer or-invented'\n")).toEqual({ CMX_KEY_TYPESAFE: "ts-invented", CMX_KEY_OPENROUTER: "or-invented" });
  expect(keysIn("CMX_KEY_TYPESAFE=\n# CMX_KEY_OPENROUTER=x\r\n")).toEqual({});
});

it("replays a given message as the session held it, its label kept and nothing asked, the next judged against that row", async () => {
  const { dir, registry, listener } = await rig();
  const filed: CalibrationCase = { id: "filed", source: "invented", messages: [
    { text: "Invented listing work.", expect: "either", given: { label: "Invented listing" } },
    { text: "Invented step.", expect: "either", given: {} },
    { text: "And its bullets?", expect: "continue" },
  ] };
  const { cases } = await replay(registry, [filed], 2, dir);
  expect(cases[0]!.messages.map(m => [m.verdict, m.calls.length])).toEqual([["given", 0], ["given", 0], ["continue", 1]]);
  expect(cases[0]!.messages[2]!.topic).toEqual({ title: "Invented listing", length: 2 });
  expect(listener.seen).toHaveLength(1);
  expect(sheet({ cases })).toMatch(/\| 0 \| Invented listing work\. \| either \| — \| — \| — \| given \| — \|  \|/);
});

it("holds a case set whose every case opens with a new row and names its source", () => {
  expect(CALIBRATION_CASES.length).toBeGreaterThan(0);
  for (const item of CALIBRATION_CASES) {
    expect(item.messages[0]!.given !== undefined || item.messages[0]!.expect === "new", item.id).toBe(true);
    expect(item.source, item.id).not.toBe("");
  }
  expect(new Set(CALIBRATION_CASES.map(item => item.id)).size).toBe(CALIBRATION_CASES.length);
});
