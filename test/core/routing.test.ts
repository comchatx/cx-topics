import { afterEach, expect, it, vi } from "vitest";
import { cut, routeTopic, ROUTING_LIMITS, type RoutingInput, type RoutingState } from "../../src/core/routing.js";
import { ReviewFailure, type Questions } from "../../src/core/protocol.js";
import { routingFixtures, scriptedRoutingAnswers, topicProjection } from "../support/routing-fixtures.js";
import { compareRoutingFixtures } from "../support/routing-comparison.js";
import { holdsSymbol } from "../support/disclosure.js";

const input = (): RoutingInput => ({ ...routingFixtures[0]!.input });
const evaluate = (one = input(), continuing = 0.95, significant = 0.9) => routeTopic(one, { now: () => 0, ask: async (_state, questions) => scriptedRoutingAnswers(questions, continuing, significant) });
afterEach(() => vi.useRealTimers());

it.each(routingFixtures)("routes invented $name through the continuation and lasting-change questions", async fixture => {
  const result = await routeTopic(fixture.input, { now: () => 0, ask: async (_state, questions) => {
    if (fixture.failure === "refused") return { stopReason: "error", answers: {}, errorMessage: "invented refusal" };
    if (fixture.failure === "timeout") throw new ReviewFailure(fixture.failure);
    if (fixture.failure === "malformed") return "invented malformed";
    if (fixture.failure === "missing") return { stopReason: "stop", answers: {} };
    return scriptedRoutingAnswers(questions, fixture.continuing, fixture.significant);
  } });
  expect(result.decision).toBe(fixture.expected ?? "create-new");
  expect(result.status).toBe(fixture.failure === undefined ? "available" : "unavailable");
  expect(result.titleFlag).toBe(fixture.failure === undefined ? false : null);
  expect(Object.isFrozen(result)).toBe(true);
});

it("asks whether the current title still names the topic's work, and flags it at 0.2 or below, with no question for a topic with no title", async () => {
  const titled = (adequate: number) => routeTopic(input(), { now: () => 0, ask: async (_state, questions) => ({ stopReason: "stop", answers: { ...scriptedRoutingAnswers(questions, 0.95).answers, titleAdequate: { type: "bool", probability: adequate } } }) });
  expect([(await titled(ROUTING_LIMITS.staleTitle)).titleFlag, (await titled(0.21)).titleFlag]).toEqual([true, false]);
  expect(ROUTING_LIMITS.staleTitle).toBe(0.2);
  const questions: Questions[] = [];
  const untitled = await routeTopic({ ...input(), current: topicProjection(undefined, input().current.messages) }, { now: () => 0, ask: async (_state, asked) => { questions.push(asked); return scriptedRoutingAnswers(asked, 0.95); } });
  expect([Object.keys(questions[0]!), untitled.titleFlag]).toEqual([["significantChange", "continueCurrent"], null]);
});

it("shows Jev the current title and the seller's messages alone, never cx's words, an earlier topic, identifiers or writer handles", async () => {
  const one = input();
  const label = vi.fn(); const storage = vi.fn(); const history = vi.fn();
  const enriched = { ...one, tenant: "invented A", account: "invented account", credential: "invented credential", systemPrompt: "invented system", agents: "invented AGENTS", skills: "invented skill", files: "invented file", toolResult: "invented result", box: "invented box", storageId: "invented store", setLabel: label, storage, history,
    earlier: [topicProjection("Invented earlier work", ["invented earlier words"])], assistant: "invented cx reply",
    current: { ...one.current, tenant: "invented tenant", replies: ["invented cx reply"] } };
  let state: RoutingState | undefined;
  let questions: Questions | undefined;
  const result = await routeTopic(enriched, { now: () => 0, ask: async (received, asked) => {
    state = received; questions = asked;
    return scriptedRoutingAnswers(asked, 0.95);
  } });
  expect(result.status).toBe("available");
  expect(state).toEqual({ current: { title: one.current.title, messages: one.current.messages }, latestUserMessage: one.latestUserMessage });
  expect(JSON.stringify(state)).not.toMatch(/invented (cx reply|earlier|tenant|account|credential|system|result)/);
  expect(holdsSymbol(state)).toBe(false);
  expect(Object.keys(questions!)).toEqual(["significantChange", "continueCurrent", "titleAdequate"]);
  for (const q of Object.values(questions!)) expect(q.type).toBe("bool");
  for (const frozen of [state, state!.current, state!.current.messages]) expect(Object.isFrozen(frozen)).toBe(true);
  expect(result.disclosedFields).toEqual(["current", "current.title", "current.messages", "current.messages[0]", "current.messages[1]", "latestUserMessage"]);
  for (const writer of [label, storage, history]) expect(writer).not.toHaveBeenCalled();
});

it("asks about intent, not shared words, in these exact words", async () => {
  let questions: Questions | undefined;
  await routeTopic(input(), { now: () => 0, ask: async (_state, asked) => { questions = asked; return scriptedRoutingAnswers(asked, 0.95); } });
  expect(questions).toEqual({
    significantChange: { type: "bool", instructions: "Does state.latestUserMessage request lasting separate work rather than a brief tangent or correction to state.current?", criteria: { true: "Lasting separate work", false: "A brief tangent or a correction" } },
    continueCurrent: { type: "bool", instructions: "Does state.latestUserMessage intend to continue or correct the work in state.current, its title and the seller's messages so far, rather than start separate work? The same task on another product continues it less surely than the same product; another kind of task does not continue it. Judge intent, not shared product words.", criteria: { true: "Continues or corrects the work", false: "Starts another kind of work" } },
    titleAdequate: { type: "bool", instructions: "Does state.current.title still name the work in state.current, the seller's messages so far, together with state.latestUserMessage? A title that names where the work began but not where it has gone does not.", criteria: { true: "Still names the work", false: "No longer names the work" } },
  });
});

/** The product owner's examples: a topic on one product's listing, by the seller's messages in it, and the seller's next message. */
const listing = (sellerMessages: number, latestUserMessage: string, currentLength?: number): RoutingInput => {
  const words = Array.from({ length: sellerMessages }, (_, i) => (i === 1 ? "再把虚构的 XXX 瑜伽垫的五点描述也优化一下。" : `优化虚构的 XXX 瑜伽垫的 listing，第 ${i + 1} 步。`));
  return { current: topicProjection("XXX 瑜伽垫 listing 优化", words), latestUserMessage, baselineDecision: "continuation", ...(currentLength === undefined ? {} : { currentLength }) };
};
const unsure = (questions: Questions) => scriptedRoutingAnswers(questions, 0.65, 0.6);
const route = (one: RoutingInput, answer: (questions: Questions) => unknown) => routeTopic(one, { now: () => 0, ask: async (_state, questions) => answer(questions) });

it("continues a two-message topic on one product's listing when the third asks the same for another product", async () => {
  expect(await route(listing(2, "现在优化虚构的 YYY 水杯的 listing。", 2), unsure)).toMatchObject({ status: "available", decision: "continue-current" });
});

it("opens a new topic after a long topic on one product's listing when the next asks the same for another product, on the same answers", async () => {
  const long = listing(4, "现在优化虚构的 YYY 水杯的 listing。", 12);
  expect(long.current.messages).toHaveLength(4);
  expect(await route(long, unsure)).toMatchObject({ status: "available", decision: "create-new" });
});

it("opens a new topic when one product's listing, then another's, is followed by advertising", async () => {
  const two = { ...listing(1, "帮我规划虚构店铺下个月的广告预算。"), current: topicProjection("XXX 瑜伽垫 listing 优化", ["优化虚构的 XXX 瑜伽垫的 listing。", "现在优化虚构的 YYY 水杯的 listing。"]), currentLength: 2 };
  expect(await route(two, questions => scriptedRoutingAnswers(questions, 0.1, 0.9))).toMatchObject({ status: "available", decision: "create-new" });
});

it("asks more of a continuation as the topic grows, from an even answer at two seller messages to the confident line at eight", async () => {
  const at = async (length: number, continuing: number, significant: number) => (await route(listing(1, "继续。", length), questions => scriptedRoutingAnswers(questions, continuing, significant))).decision;
  expect([await at(2, 0.5, 0.9), await at(2, 0.49, 0.9), await at(2, 0.2, 0.5), await at(2, 0.2, 0.51)]).toEqual(["continue-current", "create-new", "continue-current", "create-new"]);
  expect([await at(5, 0.65, 0.9), await at(5, 0.64, 0.9), await at(5, 0.2, 0.35), await at(5, 0.2, 0.36)]).toEqual(["continue-current", "create-new", "continue-current", "create-new"]);
  expect([await at(8, 0.8, 0.9), await at(8, 0.79, 0.9), await at(8, 0.2, 0.2), await at(8, 0.2, 0.21)]).toEqual(["continue-current", "create-new", "continue-current", "create-new"]);
  expect([await at(30, 0.79, 0.9), await at(1, 0.49, 0.9)]).toEqual(["create-new", "create-new"]);
  // Without a length the router counts the seller's messages it is shown.
  const leaning = (questions: Questions) => scriptedRoutingAnswers(questions, 0.55, 0.9);
  expect([(await route(listing(2, "继续。"), leaning)).decision, (await route(listing(4, "继续。"), leaning)).decision]).toEqual(["continue-current", "create-new"]);
});

it("continues a message on a low lasting-change answer only where Jev does not also call it unlikely to continue, at any length", async () => {
  // The live witness: 「换个新话题：用一句话说说什么是 ASIN。」 on a row of nine, answered 0.14 for a lasting change and 0.03 for continuing.
  const at = async (length: number, continuing: number, significant: number) => (await route(listing(1, "换个新话题：用一句话说说什么是 ASIN。", length), questions => scriptedRoutingAnswers(questions, continuing, significant))).decision;
  expect([await at(9, 0.03, 0.14), await at(9, 0.19, 0.0), await at(2, 0.19, 0.5), await at(1, 0.0, 0.0)]).toEqual(["create-new", "create-new", "create-new", "create-new"]);
  expect([await at(9, ROUTING_LIMITS.unlikely, 0.14), await at(2, ROUTING_LIMITS.unlikely, 0.5)]).toEqual(["continue-current", "continue-current"]);
});

it("routes a projection that carries no provenance flag, as the live session's does", async () => {
  const one = input();
  expect(one).not.toHaveProperty("provenance");
  expect(await evaluate(one)).toMatchObject({ status: "available", decision: "continue-current" });
});

it("cuts a long message to its head and tail around a marker, the latest at 2,048 and the others at 512, and still refuses a blank one", async () => {
  expect(cut("abcdefghij", 10)).toBe("abcdefghij");
  expect(cut("😀".repeat(100), 40)).toBe(`${"😀".repeat(5)}\n[… 90 characters omitted …]\n${"😀".repeat(5)}`);
  const one = input();
  const paste = `Here is the invented supplier sheet: ${"品".repeat(5000)} Now plan the invented ad budget instead.`;
  let state: RoutingState | undefined;
  const result = await routeTopic({ ...one, current: topicProjection("Walmart inventory planning", [paste]), latestUserMessage: paste }, { now: () => 0, ask: async (received, questions) => { state = received; return scriptedRoutingAnswers(questions, 0.05); } });
  expect(result).toMatchObject({ status: "available", decision: "create-new" });
  for (const [text, max] of [[state!.latestUserMessage, ROUTING_LIMITS.latestChars], [state!.current.messages[0]!, ROUTING_LIMITS.messageChars]] as const) {
    expect([...text]).toHaveLength(max);
    expect(text.startsWith("Here is the invented supplier sheet:")).toBe(true);
    expect(text.endsWith("Now plan the invented ad budget instead.")).toBe(true);
    expect(text).toMatch(/\n\[… \d+ characters omitted …\]\n/);
  }
  expect(result.latestUserMessage).toBe(state!.latestUserMessage);
  for (const blank of [" ".repeat(5000), ""]) {
    expect(await routeTopic({ ...one, latestUserMessage: blank }, { now: () => 0, ask: vi.fn() })).toMatchObject({ reason: "invalid-input" });
    expect(await routeTopic({ ...one, current: topicProjection("Walmart inventory planning", [blank]) }, { now: () => 0, ask: vi.fn() })).toMatchObject({ reason: "invalid-input" });
  }
});

it("gives the asker the deadline its caller names", async () => {
  vi.useFakeTimers(); let signal!: AbortSignal;
  const pending = routeTopic(input(), { now: () => Date.now(), timeoutMs: 20_000, ask: (_s, _q, received) => { signal = received; return new Promise(() => {}); } });
  await vi.advanceTimersByTimeAsync(19_999);
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ status: "unavailable", reason: "timeout", latencyMs: 20_000 });
});

it("clears the deadline when the asker answers in time", async () => {
  vi.useFakeTimers();
  expect(await evaluate()).toMatchObject({ status: "available" });
  expect(vi.getTimerCount()).toBe(0);
});

it("reads each field once and validates what it read, so a getter cannot pass the bound and hand over more", async () => {
  let reads = 0;
  const words = input().latestUserMessage;
  const one = { ...input(), get latestUserMessage() { reads += 1; return reads === 1 ? words : "x".repeat(5000); } };
  let state: RoutingState | undefined;
  expect(await routeTopic(one, { now: () => 0, ask: async (received, questions) => { state = received; return scriptedRoutingAnswers(questions, 0.95); } })).toMatchObject({ status: "available", latestUserMessage: words });
  expect(reads).toBe(1);
  expect(state!.latestUserMessage).toBe(words);
  reads = 0;
  const invalid = { ...input(), baselineDecision: "rename", get latestUserMessage() { reads += 1; return reads === 1 ? words : "x".repeat(5000); } };
  expect(await routeTopic(invalid as unknown as RoutingInput, { now: () => 0, ask: vi.fn() })).toMatchObject({ reason: "invalid-input", latestUserMessage: words });
  expect(reads).toBe(1);
});

it("keeps each of several requests in flight to its own input, whatever order they complete in", async () => {
  const one = { ...input() }; const states: RoutingState[] = []; const finish: ((raw: unknown) => void)[] = []; const batches: Questions[] = [];
  const ask = (state: RoutingState, questions: Questions) => { states.push(state); batches.push(questions); return new Promise(resolve => finish.push(resolve)); };
  const a = routeTopic({ ...one, tenant: "invented A" } as RoutingInput, { ask, now: () => 0 });
  const bInput = { ...one, latestUserMessage: "Keep the invented inventory plan." };
  const b = routeTopic({ ...bInput, tenant: "invented B" } as RoutingInput, { ask, now: () => 0 });
  const c = routeTopic({ ...one, current: topicProjection("Renamed invented work", one.current.messages) }, { ask, now: () => 0 });
  one.latestUserMessage = "Changed after dispatch";
  finish[2]!(scriptedRoutingAnswers(batches[2]!, 0.95)); const latest = await c;
  finish[1]!(scriptedRoutingAnswers(batches[1]!, 0.05)); const other = await b;
  finish[0]!(scriptedRoutingAnswers(batches[0]!, 0.95)); const old = await a;
  expect(states[0]!.latestUserMessage).not.toBe(one.latestUserMessage);
  expect(states[1]!.latestUserMessage).toBe(bInput.latestUserMessage);
  expect(states[2]!.current.title).toBe("Renamed invented work");
  expect(states[0]!.current).not.toBe(states[1]!.current);
  expect([old.decision, other.decision, latest.decision]).toEqual(["continue-current", "create-new", "continue-current"]);
  expect(JSON.stringify(states)).not.toContain("invented A");
  expect(Object.isFrozen(latest)).toBe(true);
});

it("retains the safe baseline on refusal, malformed/missing output or ignored timeout", async () => {
  const one = input();
  for (const decision of ["continuation", "new-topic"] as const) for (const raw of [null, { stopReason: "error", answers: {} }, { stopReason: "stop", answers: {} }, { stopReason: "stop", answers: [] }]) {
    const result = await routeTopic({ ...one, baselineDecision: decision }, { ask: async () => raw, now: () => 0 });
    expect(result).toMatchObject({ status: "unavailable", decision: decision === "continuation" ? "continue-current" : "create-new", probabilities: null, titleFlag: null });
  }
  vi.useFakeTimers(); let finish!: (raw: unknown) => void; let signal!: AbortSignal;
  const pending = routeTopic(one, { now: () => Date.now(), ask: (_s, _q, received) => { signal = received; return new Promise(resolve => { finish = resolve; }); } });
  await vi.advanceTimersByTimeAsync(ROUTING_LIMITS.timeoutMs);
  const result = await pending;
  expect(result).toMatchObject({ status: "unavailable", reason: "timeout", latencyMs: 1000, decision: "continue-current" });
  expect(signal.aborted).toBe(true);
  finish({ answers: {} }); await Promise.resolve();
  expect(result.status).toBe("unavailable"); expect(vi.getTimerCount()).toBe(0);
});

it("serializes deterministic fixture metrics and exact disclosure without counting unavailable or ambiguous reviews as successes", async () => {
  const report = await compareRoutingFixtures();
  expect(await compareRoutingFixtures()).toEqual(report);
  expect(report.rows).toHaveLength(14);
  expect(report.totals).toMatchObject({ requestCount: 14, latencyMs: 98, unavailable: 4, advisoryMissed: 0, advisorySuperfluous: 0 });
  for (const row of report.rows.filter(r => r.expected === null)) expect(row.baseline.missedBoundary).toBeNull();
  await expect(`${JSON.stringify(report, null, 2)}\n`).toMatchFileSnapshot("../support/routing-comparison.json");
});
