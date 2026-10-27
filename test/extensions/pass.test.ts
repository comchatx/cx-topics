import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { eventually } from "../support/eventually.js";
import { answered, base, context, continuing, conversation, LABELS, said, separate } from "../support/session-fixtures.js";
import { createPass, INSTALLS_FILE, installKey, PROGRESS, tokenIn, type Progress } from "../../src/extensions/pass.js";
import topics, { ownKey, title } from "../../src/extensions/topics.js";

/** A step the pass took, in order: a label written or cleared, or progress kept. */
type Step = readonly ["label", string, string | undefined] | readonly ["keep", Progress];

/**
 * pi as the pass reads and writes it: labels into `one.labels`, progress as custom entries appended to the session, as `appendEntry`
 * appends them, and the token the steward's file holds.
 */
function passOver(one: ReturnType<typeof context>, token: () => string | undefined = () => undefined) {
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
    token: () => token(),
  });
  return { pass, steps };
}
const progressIn = (entries: readonly SessionEntry[]): readonly unknown[] =>
  entries.flatMap(entry => (entry.type === "custom" && entry.customType === PROGRESS ? [entry.data] : []));
const latest = (one: ReturnType<typeof context>) => one.asked.map(asked => asked.state["latestUserMessage"]);
/** A session this version has judged through `id` already. */
const judgedThrough = (entries: SessionEntry[], id: string): SessionEntry[] =>
  [...entries, { ...base(`p-${id}`), type: "custom", customType: PROGRESS, data: { through: id } } as SessionEntry];

it("on an install clears every label on a seller message, on the branch or not, keeps the rest, and judges each seller message from the first, in order", async () => {
  const entries = [...conversation(), answered("a3", "Invented answer."), said("u4", "And the invented ad budget?")];
  // A seller message of another branch pi still holds, and a label on cx's answer: the first is cleared, the second stays.
  const offBranch = said("elsewhere", "An invented message of another branch.");
  const one = context(entries, separate, { ...LABELS, elsewhere: "Another branch", a1: "On cx's answer" }, ["BE greeting", "BE3600 analysis", "Walmart inventory", "Reorder point", "Ad budget"]);
  one.raw.sessionManager.getEntries = () => [...one.entries.slice(0, 3), offBranch, ...one.entries.slice(3)];
  const { pass, steps } = passOver(one, () => "token-1");
  pass.started(one.ctx);
  await pass.idle();
  expect(steps.slice(0, 4)).toEqual([["label", "u1", undefined], ["label", "elsewhere", undefined], ["label", "u2", undefined], ["keep", { install: "token-1" }]]);
  expect(one.labels["a1"]).toBe("On cx's answer");
  // Judged from the first under today's rules: the first message is titled without Jev, and each after it is asked about in turn.
  expect(one.titled).toHaveLength(5);
  expect(latest(one)).toEqual(["Analyse the invented BE3600 positioning.", "Now plan the invented Walmart inventory.", "Add a reorder point to the plan.", "And the invented ad budget?"]);
  expect(steps.slice(4).filter(step => step[0] === "keep")).toEqual(["u0", "u1", "x1-image", "u2", "u3", "u4"].map(id => ["keep", { through: id }]));
  expect(one.labels).toMatchObject({ u0: "BE greeting", u1: "BE3600 analysis", u2: "Walmart inventory", u3: "Reorder point", u4: "Ad budget" });
  // The same token again carries on: nothing is cleared, nothing asked twice.
  const again = passOver(one, () => "token-1");
  again.pass.started(one.ctx);
  await again.pass.idle();
  expect([again.steps, one.asked.length, one.titled.length]).toEqual([[], 4, 5]);
});

it("carries on at a wake, a switch-on, another plugin's click and every load without an unseen token: only seller messages not judged yet are asked", async () => {
  const one = context(judgedThrough([...conversation().slice(0, -1)], "u2"), separate);
  one.entries.push(said("u3", "Add a reorder point to the plan."));
  for (const token of [() => undefined, () => "seen"]) {
    if (token() === "seen") one.entries.push({ ...base("p-seen"), type: "custom", customType: PROGRESS, data: { install: "seen", through: "u3" } } as SessionEntry);
    const { pass, steps } = passOver(one, token);
    pass.started(one.ctx);
    await pass.idle();
    expect(steps.filter(step => step[0] === "label" && step[2] === undefined)).toEqual([]);
  }
  expect(latest(one)).toEqual(["Add a reorder point to the plan."]);
});

it("on the first load of this version, with no progress and no unseen token, takes the newest seller message as judged and asks nothing", async () => {
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
  const one = context([...conversation(), answered("a3", "Invented answer."), said("u4", "And the invented ad budget?")], separate, {}, ["Greeting", "BE3600 analysis", "Walmart inventory", "Reorder point", "Ad budget"]);
  let cut!: () => void;
  let calls = 0;
  const classify = one.raw.modelRegistry.classify.getMockImplementation()!;
  one.raw.modelRegistry.classify.mockImplementation(async (...args: Parameters<typeof classify>) => {
    calls += 1;
    if (calls === 2) await new Promise<void>(done => { cut = done; });
    return classify(...args);
  });
  const first = passOver(one, () => "token-1");
  first.pass.started(one.ctx);
  await eventually(() => expect(calls).toBe(2));
  first.pass.stopped();
  const second = passOver(one, () => "token-1");
  second.pass.started(one.ctx);
  await second.pass.idle();
  cut();
  await first.pass.idle();
  // The first pass judged u0, u1 and the image, and was cut asking about u2: the second asks u2 again and goes on, none other twice,
  // and the answer that lands for the first buys no title and writes nothing.
  expect(latest(one)).toEqual(["Analyse the invented BE3600 positioning.", "Now plan the invented Walmart inventory.", "Add a reorder point to the plan.", "And the invented ad budget?", "Now plan the invented Walmart inventory."]);
  expect(first.steps.filter(step => step[0] === "keep").map(step => step[1])).toEqual([{ install: "token-1" }, { through: "u0" }, { through: "u1" }, { through: "x1-image" }]);
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

it("on a free account clears the labels at an install and writes none, and a blank message or a request refused as it is never stops the pass", async () => {
  const free = context(conversation(), separate);
  free.titleWith(async () => ({ role: "assistant", stopReason: "error", errorMessage: "403 membership_required", content: [], usage: { input: 0, output: 0, totalTokens: 0 } }));
  const { pass, steps } = passOver(free, () => "token-1");
  pass.started(free.ctx);
  await pass.idle();
  expect(steps).toEqual([["label", "u1", undefined], ["label", "u2", undefined], ["keep", { install: "token-1" }]]);
  expect([free.labels, free.titled.length, free.asked.length]).toEqual([{}, 1, 0]);
  const moving = context(judgedThrough(conversation(), "u2"), separate);
  moving.entries.push(said("u4", "<quote entry=\"a2\" at=\"1\">Invented stock plan.</quote>"), said("u5", "And the invented ad budget?"));
  moving.answerWith(async () => ({ stopReason: "error", answers: {}, errorMessage: "System One API error (400): max_tokens_exceeded" }));
  const on = passOver(moving);
  on.pass.started(moving.ctx);
  await on.pass.idle();
  expect(on.steps).toEqual(["u3", "u4", "u5"].map(id => ["keep", { through: id }]));
  expect(latest(moving)).toEqual(["Add a reorder point to the plan.", "And the invented ad budget?"]);
});

it("writes the install's clears and its progress before any call, so the earlier titles leave History when the install is applied", async () => {
  const one = context(conversation(), separate, { ...LABELS }, []);
  one.titleWith(() => new Promise(() => {}));
  const { pass, steps } = passOver(one, () => "token-1");
  pass.started(one.ctx);
  // pi announces the custom entry as it is appended, and the steward pulls the clears with it at once.
  await eventually(() => expect(one.titled).toHaveLength(1));
  expect(steps).toEqual([["label", "u1", undefined], ["label", "u2", undefined], ["keep", { install: "token-1" }]]);
  expect(progressIn(one.entries)).toEqual([{ install: "token-1" }]);
});

it("reads the steward's token for its own key only, and none from no file, no key, no token or a file that does not read", () => {
  const file = JSON.stringify({ listed: ["/opt/comchatx/packages/cx-topics"], tokens: { "/opt/comchatx/packages/cx-topics": "t-1", "npm:other": 7 } });
  expect(tokenIn(file, "/opt/comchatx/packages/cx-topics")).toBe("t-1");
  expect([tokenIn(file, "npm:other"), tokenIn(file, "npm:absent"), tokenIn(file, undefined), tokenIn(undefined, "x"), tokenIn("{", "x"), tokenIn("[]", "x"), tokenIn("{\"tokens\":[]}", "0")]).toEqual(Array(7).fill(undefined));
  // A source is any key pi can store: the record keeps `__proto__` as its own key, and a key it lacks reads nothing the object inherits.
  expect(tokenIn("{\"tokens\":{\"__proto__\":\"t-2\"}}", "__proto__")).toBe("t-2");
  expect([tokenIn("{\"tokens\":{}}", "__proto__"), tokenIn("{\"tokens\":{}}", "constructor"), tokenIn("{\"tokens\":{}}", "toString")]).toEqual([undefined, undefined, undefined]);
  expect([installKey("npm:cx-topics@0.2.0"), installKey("npm:@acme/cx-topics@1"), installKey("npm:@acme/cx-topics"), installKey("./packages/x"), installKey("/opt/x")])
    .toEqual(["npm:cx-topics", "npm:@acme/cx-topics", "npm:@acme/cx-topics", "./packages/x", "/opt/x"]);
});

/** pi as the extension sees it: every member it touches is recorded, and the ones it is not given throw. */
function fakePi(tools: readonly { readonly name: string; readonly sourceInfo: { readonly path: string; readonly source: string } }[] = []) {
  const touched = new Set<string>();
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const registered = new Map<string, unknown>();
  const setLabel = vi.fn();
  const appendEntry = vi.fn();
  const given: Record<string, unknown> = {
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers.set(event, handler); },
    registerTool: (tool: { name: string }) => { registered.set(tool.name, tool); },
    setLabel, appendEntry, getAllTools: () => tools,
  };
  const pi = new Proxy({}, { get: (_target, key) => { touched.add(String(key)); if (!(String(key) in given)) throw new Error(`pi.${String(key)} is not this package's`); return given[String(key)]; } });
  return { pi: pi as ExtensionAPI, touched, handlers, tools: registered, setLabel, appendEntry };
}
const OWN = fileURLToPath(new URL("../../src/extensions/topics.ts", import.meta.url));

it("finds its own key by the source of the `quoted` pi holds from this file, never another package's", () => {
  const own = { name: "quoted", sourceInfo: { path: OWN, source: "/opt/comchatx/packages/cx-topics" } };
  const other = { name: "quoted", sourceInfo: { path: "/elsewhere/quoted.ts", source: "npm:quoting@1" } };
  expect(ownKey({ getAllTools: () => [own] } as never, OWN)).toBe("/opt/comchatx/packages/cx-topics");
  expect(ownKey({ getAllTools: () => [{ ...own, sourceInfo: { path: OWN, source: "npm:cx-topics@0.2.0" } }] } as never, OWN)).toBe("npm:cx-topics");
  expect(ownKey({ getAllTools: () => [other] } as never, OWN)).toBeUndefined();
  expect(ownKey({ getAllTools: () => [] } as never, OWN)).toBeUndefined();
});

it("registers no topic tool, starts its pass at session_start and stops it at session_shutdown, waiting on neither, and writes only labels and its progress", async () => {
  const tenant = mkdtempSync(join(tmpdir(), "cx-topics-"));
  try {
    mkdirSync(join(tenant, ".pi"));
    writeFileSync(join(tenant, INSTALLS_FILE), JSON.stringify({ listed: ["/opt/comchatx/packages/cx-topics"], tokens: { "/opt/comchatx/packages/cx-topics": "t-1" } }));
    const fake = fakePi([{ name: "quoted", sourceInfo: { path: OWN, source: "/opt/comchatx/packages/cx-topics" } }]);
    topics(fake.pi);
    expect([...fake.tools.keys()]).toEqual(["quoted"]);
    expect([...fake.handlers.keys()]).toEqual(["message_end", "context", "session_start", "session_shutdown"]);
    const one = context(conversation(), separate, { ...LABELS }, []);
    one.titleWith(() => new Promise(() => {}));
    expect(fake.handlers.get("session_start")!({ type: "session_start", reason: "startup" }, { ...one.raw, cwd: tenant })).toBeUndefined();
    await eventually(() => expect(fake.appendEntry).toHaveBeenCalledWith(PROGRESS, { install: "t-1" }));
    expect(fake.setLabel.mock.calls).toEqual([["u1", undefined], ["u2", undefined]]);
    expect(fake.handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "reload" }, one.raw)).toBeUndefined();
    const message = (one.entries.at(-1) as Extract<SessionEntry, { type: "message" }>).message;
    await fake.handlers.get("message_end")!({ type: "message_end", message }, one.raw);
    expect(fake.handlers.get("context")!({ type: "context", messages: [] }, { ...one.raw, cwd: tenant })).toBeUndefined();
    expect([...fake.touched].filter(key => !["on", "registerTool", "setLabel", "appendEntry", "getAllTools"].includes(key))).toEqual([]);
  } finally {
    rmSync(tenant, { recursive: true, force: true });
  }
});
