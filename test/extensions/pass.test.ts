import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { eventually } from "../support/eventually.js";
import { answered, base, context, continuing, conversation, LABELS, said, separate } from "../support/session-fixtures.js";
import { createPass, PROGRESS, type Progress } from "../../src/extensions/pass.js";
import topics, { title } from "../../src/extensions/topics.js";

/** A step the pass took, in order: a label written or cleared, or progress kept. */
type Step = readonly ["label", string, string | undefined] | readonly ["keep", Progress];

/** pi as the pass reads and writes it: labels into `one.labels`, progress as custom entries appended to the session, as `appendEntry` appends them. */
function passOver(one: ReturnType<typeof context>) {
  const steps: Step[] = [];
  let kept = 0;
  const pass = createPass({
    title,
    setLabel: (id, label) => {
      steps.push(["label", id, label]);
      if (label === undefined) delete one.labels[id]; else one.labels[id] = label;
    },
    keep: progress => {
      steps.push(["keep", progress]);
      one.entries.push({ ...base(`p${kept += 1}`), type: "custom", customType: PROGRESS, data: progress } as SessionEntry);
    },
  });
  return { pass, steps };
}
const progressIn = (entries: readonly SessionEntry[]): readonly unknown[] =>
  entries.flatMap(entry => (entry.type === "custom" && entry.customType === PROGRESS ? [entry.data] : []));
const latest = (one: ReturnType<typeof context>) => one.asked.map(asked => asked.state["latestUserMessage"]);
/** A session this version has judged through `id` already. */
const judgedThrough = (entries: SessionEntry[], id: string): SessionEntry[] =>
  [...entries, { ...base(`p-${id}`), type: "custom", customType: PROGRESS, data: { through: id } } as SessionEntry];
/** A session whose progress says nothing is judged yet: the pass judges it from the first. */
const fromFirst = (entries: SessionEntry[]): SessionEntry[] => [...entries, { ...base("p-first"), type: "custom", customType: PROGRESS, data: {} } as SessionEntry];

it("judges each seller message from the first, in order, where the progress says nothing is judged yet", async () => {
  const one = context(fromFirst([...conversation(), answered("a3", "Invented answer."), said("u4", "And the invented ad budget?")]), separate, {}, ["BE greeting", "BE3600 analysis", "Walmart inventory", "Reorder point", "Ad budget"]);
  const { pass, steps } = passOver(one);
  pass.started(one.ctx);
  await pass.idle();
  // The first message is titled without Jev, and each after it is asked about in turn.
  expect(one.titled).toHaveLength(5);
  expect(latest(one)).toEqual(["Analyse the invented BE3600 positioning.", "Now plan the invented Walmart inventory.", "Add a reorder point to the plan.", "And the invented ad budget?"]);
  expect(steps.filter(step => step[0] === "keep")).toEqual(["u0", "u1", "x1-image", "u2", "u3", "u4"].map(id => ["keep", { through: id }]));
  expect(one.labels).toMatchObject({ u0: "BE greeting", u1: "BE3600 analysis", u2: "Walmart inventory", u3: "Reorder point", u4: "Ad budget" });
  // Loaded again it carries on: nothing asked twice.
  const again = passOver(one);
  again.pass.started(one.ctx);
  await again.pass.idle();
  expect([again.steps, one.asked.length, one.titled.length]).toEqual([[], 4, 5]);
});

it("carries on at a wake, a switch-on, a reinstall and every load: only seller messages not judged yet are asked, and no label is cleared", async () => {
  const one = context(judgedThrough([...conversation().slice(0, -1)], "u2"), separate);
  one.entries.push(said("u3", "Add a reorder point to the plan."));
  for (let load = 0; load < 2; load += 1) {
    const { pass, steps } = passOver(one);
    pass.started(one.ctx);
    await pass.idle();
    expect(steps.filter(step => step[0] === "label" && step[2] === undefined)).toEqual([]);
  }
  expect(latest(one)).toEqual(["Add a reorder point to the plan."]);
});

it("on the first load of this version, with no progress, takes the newest seller message as judged and asks nothing", async () => {
  const one = context(conversation(), separate);
  const { pass, steps } = passOver(one);
  pass.started(one.ctx);
  await pass.idle();
  expect([steps, one.asked.length, one.titled.length]).toEqual([[["keep", { through: "u3" }]], 0, 0]);
  // From there each seller message is judged as it arrives.
  one.entries.push(answered("a3", "Invented answer."), said("u4", "And the invented ad budget?"));
  pass.arrived();
  pass.context(one.ctx);
  await pass.idle();
  expect(latest(one)).toEqual(["And the invented ad budget?"]);
  // An empty session starts from its first message.
  const empty = context([], separate, {}, ["BE3600 analysis"]);
  const first = passOver(empty);
  first.pass.started(empty.ctx);
  await first.pass.idle();
  empty.entries.push(said("u1", "Analyse the invented BE3600 positioning."));
  first.pass.arrived();
  first.pass.context(empty.ctx);
  await first.pass.idle();
  expect([progressIn(empty.entries), empty.labels]).toEqual([[{}, { through: "u1" }], { u1: "BE3600 analysis" }]);
});

it("carries on from the branch's newest seller message, asking nothing, when its progress is off the branch", async () => {
  const one = context(judgedThrough(conversation(), "gone"), separate);
  const { pass, steps } = passOver(one);
  pass.started(one.ctx);
  await pass.idle();
  expect([steps, one.asked.length]).toEqual([[["keep", { through: "u3" }]], 0]);
});

it("never holds a reload, runs one pass at a time, and judges a message sent during a pass when it reaches it", async () => {
  const one = context(judgedThrough(conversation().slice(0, -1), "u2"), continuing);
  one.entries.push(said("u3", "Add a reorder point to the plan."));
  let open = 0, most = 0;
  const answers: (() => void)[] = [];
  const classify = one.raw.modelRegistry.classify.getMockImplementation()!;
  one.raw.modelRegistry.classify.mockImplementation(async (...args: Parameters<typeof classify>) => {
    open += 1; most = Math.max(most, open);
    await new Promise<void>(done => answers.push(done));
    open -= 1;
    return classify(...args);
  });
  const { pass } = passOver(one);
  // `started` returns at once while Jev is still asked: pi awaits it, and a reload never waits on a call.
  expect(pass.started(one.ctx)).toBeUndefined();
  await eventually(() => expect(answers).toHaveLength(1));
  one.entries.push(answered("a3", "Invented answer."), said("u4", "And the invented ad budget?"));
  pass.arrived();
  pass.context(one.ctx);
  pass.started(one.ctx);
  answers.shift()!();
  await eventually(() => expect(answers).toHaveLength(1));
  answers.shift()!();
  await pass.idle();
  expect([latest(one), most]).toEqual([["Add a reorder point to the plan.", "And the invented ad budget?"], 1]);
});

it("asks again after a reload only the message whose answer the reload cut off, and the stopped pass writes nothing more", async () => {
  const one = context(fromFirst([...conversation(), answered("a3", "Invented answer."), said("u4", "And the invented ad budget?")]), separate, {}, ["Greeting", "BE3600 analysis", "Walmart inventory", "Reorder point", "Ad budget"]);
  let cut!: () => void;
  let calls = 0;
  const classify = one.raw.modelRegistry.classify.getMockImplementation()!;
  one.raw.modelRegistry.classify.mockImplementation(async (...args: Parameters<typeof classify>) => {
    calls += 1;
    if (calls === 2) await new Promise<void>(done => { cut = done; });
    return classify(...args);
  });
  const first = passOver(one);
  first.pass.started(one.ctx);
  await eventually(() => expect(calls).toBe(2));
  first.pass.stopped();
  const second = passOver(one);
  second.pass.started(one.ctx);
  await second.pass.idle();
  cut();
  await first.pass.idle();
  // The first pass judged u0, u1 and the image, and was cut asking about u2: the second asks u2 again and goes on, none other twice,
  // and the answer that lands for the first buys no title and writes nothing.
  expect(latest(one)).toEqual(["Analyse the invented BE3600 positioning.", "Now plan the invented Walmart inventory.", "Add a reorder point to the plan.", "And the invented ad budget?", "Now plan the invented Walmart inventory."]);
  expect(first.steps.filter(step => step[0] === "keep").map(step => step[1])).toEqual([{ through: "u0" }, { through: "u1" }, { through: "x1-image" }]);
  expect(second.steps.map(step => (step[0] === "keep" ? step[1] : step[1]))).toEqual(["u2", { through: "u2" }, "u3", { through: "u3" }, "u4", { through: "u4" }]);
  expect(one.titled).toHaveLength(5);
});

it("writes nothing from a title that lands after the pass was stopped, its call already out", async () => {
  const one = context(judgedThrough(conversation(), "u2"), separate);
  let land = (): void => {};
  one.titleWith(async () => {
    await new Promise<void>(done => { land = done; });
    return { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "A late invented title" }] };
  });
  const { pass, steps } = passOver(one);
  pass.started(one.ctx);
  await eventually(() => expect(one.titled).toHaveLength(1));
  pass.stopped();
  land();
  await pass.idle();
  expect(steps).toEqual([]);
  expect(one.labels["u3"]).toBeUndefined();
});

it("stops at a message on a refusal, writing no label and no progress, and asks it again at the next seller message or load, never at each request", async () => {
  const one = context(judgedThrough(conversation(), "u2"), separate);
  let refuse = true;
  one.answerWith(async questions => (refuse ? { stopReason: "error", answers: {}, errorMessage: "System One API error (403): {\"error\":{\"code\":\"debt_owed\"}}" }
    : { stopReason: "stop", answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: "bool", probability: separate(key) }])) }));
  const { pass, steps } = passOver(one);
  pass.started(one.ctx);
  await pass.idle();
  expect([steps, one.asked.length]).toEqual([[], 1]);
  // A request with no seller message since is no reason to ask again: a timeout is billed.
  pass.context(one.ctx);
  pass.context(one.ctx);
  await pass.idle();
  expect(one.asked).toHaveLength(1);
  one.entries.push(answered("a3", "Invented answer."), said("u4", "And the invented ad budget?"));
  pass.arrived();
  pass.context(one.ctx);
  await pass.idle();
  expect([latest(one), steps]).toEqual([["Add a reorder point to the plan.", "Add a reorder point to the plan."], []]);
  refuse = false;
  pass.started(one.ctx);
  await pass.idle();
  expect(latest(one).slice(2)).toEqual(["Add a reorder point to the plan.", "And the invented ad budget?"]);
  expect(steps).toEqual([["label", "u3", "Reorder point"], ["keep", { through: "u3" }], ["label", "u4", "Untitled"], ["keep", { through: "u4" }]]);
});

it("on a free account writes no label, and a blank message or a request refused as it is never stops the pass", async () => {
  const free = context(fromFirst(conversation()), separate);
  free.titleWith(async () => ({ role: "assistant", stopReason: "error", errorMessage: "403 membership_required", content: [], usage: { input: 0, output: 0, totalTokens: 0 } }));
  const labels = { ...free.labels };
  const { pass, steps } = passOver(free);
  pass.started(free.ctx);
  await pass.idle();
  expect(steps).toEqual([]);
  expect([free.labels, free.titled.length, free.asked.length]).toEqual([labels, 1, 0]);
  const moving = context(judgedThrough(conversation(), "u2"), separate);
  moving.entries.push(said("u4", "<quote entry=\"a2\" at=\"1\">Invented stock plan.</quote>"), said("u5", "And the invented ad budget?"));
  moving.answerWith(async () => ({ stopReason: "error", answers: {}, errorMessage: "System One API error (400): max_tokens_exceeded" }));
  const on = passOver(moving);
  on.pass.started(moving.ctx);
  await on.pass.idle();
  expect(on.steps).toEqual(["u3", "u4", "u5"].map(id => ["keep", { through: id }]));
  expect(latest(moving)).toEqual(["Add a reorder point to the plan.", "And the invented ad budget?"]);
});

const OWN = fileURLToPath(new URL("../../src/extensions/topics.ts", import.meta.url));
/** pi as the extension sees it: every member it touches is recorded, and the ones it is not given throw. Its tool list holds this file's `quoted`. */
function fakePi() {
  const touched = new Set<string>();
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const registered = new Map<string, unknown>();
  const setLabel = vi.fn();
  const appendEntry = vi.fn();
  const given: Record<string, unknown> = {
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers.set(event, handler); },
    registerTool: (tool: { name: string }) => { registered.set(tool.name, tool); },
    setLabel, appendEntry, getAllTools: () => [{ name: "quoted", sourceInfo: { path: OWN, source: "/opt/comchatx/packages/cx-topics" } }],
  };
  const pi = new Proxy({}, { get: (_target, key) => { touched.add(String(key)); if (!(String(key) in given)) throw new Error(`pi.${String(key)} is not this package's`); return given[String(key)]; } });
  return { pi: pi as ExtensionAPI, touched, handlers, tools: registered, setLabel, appendEntry };
}

it("registers no topic tool, starts its pass at session_start and stops it at session_shutdown, waiting on neither, and writes only labels and its progress", async () => {
  const fake = fakePi();
  topics(fake.pi);
  expect([...fake.tools.keys()]).toEqual(["quoted"]);
  expect([...fake.handlers.keys()]).toEqual(["message_end", "context", "session_start", "session_shutdown"]);
  const one = context(judgedThrough(conversation(), "u2"), separate, { ...LABELS }, []);
  one.titleWith(() => new Promise(() => {}));
  expect(fake.handlers.get("session_start")!({ type: "session_start", reason: "startup" }, one.raw)).toBeUndefined();
  await eventually(() => expect(one.asked).toHaveLength(1));
  expect(fake.handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "reload" }, one.raw)).toBeUndefined();
  const message = (one.entries.filter(entry => entry.type === "message").at(-1) as Extract<SessionEntry, { type: "message" }>).message;
  await fake.handlers.get("message_end")!({ type: "message_end", message }, one.raw);
  expect(fake.handlers.get("context")!({ type: "context", messages: [] }, one.raw)).toBeUndefined();
  expect([...fake.touched].filter(key => !["on", "registerTool", "setLabel", "appendEntry"].includes(key))).toEqual([]);
});

it("clears no title after a reinstall, whatever install record the computer keeps beside the session", async () => {
  const tenant = mkdtempSync(join(tmpdir(), "cx-topics-"));
  try {
    mkdirSync(join(tenant, ".pi"));
    writeFileSync(join(tenant, ".pi", "cx-installs.json"), JSON.stringify({ listed: ["/opt/comchatx/packages/cx-topics"], tokens: { "/opt/comchatx/packages/cx-topics": "t-1" } }));
    const fake = fakePi();
    topics(fake.pi);
    const one = context(judgedThrough(conversation(), "u3"), separate, { ...LABELS }, []);
    fake.handlers.get("session_start")!({ type: "session_start", reason: "startup" }, { ...one.raw, cwd: tenant });
    await new Promise(done => setTimeout(done, 20));
    expect([fake.setLabel.mock.calls, fake.appendEntry.mock.calls, one.asked.length]).toEqual([[], [], 0]);
  } finally {
    rmSync(tenant, { recursive: true, force: true });
  }
});
