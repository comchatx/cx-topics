import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { routeTopic, ROUTING_LIMITS, type RoutingAdvisory } from "../../src/core/routing.js";
import { TITLE_SYSTEM, titlePrompt } from "../../src/core/titling.js";
import { holdsSymbol } from "../support/disclosure.js";
import { answered, context, continuing, conversation, LABELS, others, said, separate, stale, type Asked, type Titled } from "../support/session-fixtures.js";
import { asker, createJudge, JEV, projection, titler, topicBefore, verdictOf } from "../../src/extensions/judge.js";
import { title } from "../../src/extensions/topics.js";

afterEach(() => vi.useRealTimers());

const label = (labels: Record<string, string>) => (id: string) => labels[id];
const STATE = { current: null, latestUserMessage: "x" } as never;
/** The judge as the package makes it, writing into `labels` as pi's `setLabel` writes. */
const judging = (labels: Record<string, string>) => {
  const written: [string, string][] = [];
  const judge = createJudge(title, (id, raw) => { written.push([id, raw]); labels[id] = raw; });
  return { judge, written };
};
const prompted = (titled: Titled) => titled.context.messages[0]!.content[0]!.text;

it("shows Jev the topic in progress by its title and the seller's own words in it: no cx reply, earlier row, system prompt, tool, image or quote", () => {
  const input = projection(conversation(), label({ ...LABELS }), "u3")!;
  expect(JSON.parse(JSON.stringify(input))).toEqual({
    current: { title: "Walmart inventory", messages: ["Now plan the invented Walmart inventory."] },
    latestUserMessage: "Add a reorder point to the plan.", baselineDecision: "continuation", currentLength: 1,
  });
  expect(JSON.stringify(input)).not.toMatch(/Invented (stock plan|BE3600 notes)|BE3600 positioning|invented (system|tool|custom|bash|private|greeting|hello)|secret|aW52/);
  expect(input).not.toHaveProperty("provenance");
});

it("starts a topic at each labelled message, an earlier title's again a row of its own, and shows its newest seller messages while counting them all", () => {
  const entries: SessionEntry[] = [said("t1", "Optimise the invented XXX yoga mat listing."), answered("r1", "Invented listing.")];
  entries.push(said("b1", "Plan the invented ad budget."), answered("rb", "Invented budget."), said("t2", "Back to the invented XXX listing."));
  for (let i = 0; i < 34; i++) entries.push(answered(`r${i}`, `Invented listing step ${i}.`), said(`s${i}`, `Invented listing request ${i}.`));
  entries.push(...others("x").slice(-1), said("latest", "Now the invented YYY bottle listing."));
  const input = projection(entries, label({ t1: "XXX listing", b1: "Ad budget", t2: "XXX listing" }), "latest")!;
  expect(input.current.title).toBe("XXX listing");
  expect(input.current.messages).toEqual(Array.from({ length: ROUTING_LIMITS.sellerMessages }, (_, i) => `Invented listing request ${i + 34 - ROUTING_LIMITS.sellerMessages}.`));
  // The row's labelled message, its 34 requests and an image-only message; nothing of the first XXX row or the ad budget's.
  expect(input.currentLength).toBe(36);
  const short = projection([...entries.slice(0, 5), said("next", "And its bullet points?")], label({ t1: "XXX listing", b1: "Ad budget", t2: "XXX listing" }), "next")!;
  expect(short).toMatchObject({ current: { messages: ["Back to the invented XXX listing."] }, currentLength: 1 });
});

it("projects nothing before the first title, there being no topic to continue, nor for an id that is not a seller's message", () => {
  expect(projection([said("u0", "x"), answered("a0", "y"), said("u1", "first")], label({}), "u1")).toBeUndefined();
  expect(projection([said("u1", "x"), answered("a1", "y")], label({ u1: "X" }), "a1")).toBeUndefined();
  expect(projection([said("u1", "x")], label({}), "gone")).toBeUndefined();
});

it("finds the topic before a message by the seller message its title is on, and none before the first title", () => {
  expect(topicBefore(conversation(), label({ ...LABELS }), "u3")).toEqual({ start: "u2", title: "Walmart inventory", said: ["Now plan the invented Walmart inventory."], length: 1 });
  expect(topicBefore(conversation(), label({ ...LABELS }), "u1")).toBeUndefined();
  expect(topicBefore(conversation(), label({ ...LABELS }), "gone")).toBeUndefined();
});

it("acts on no unavailable result, though it carries a fallback decision, and reads a stale title only on a continuation", async () => {
  const input = projection(conversation(), label({ ...LABELS }), "u3")!;
  for (const raw of [{ stopReason: "error", answers: {} }, { stopReason: "aborted", answers: {} }, { stopReason: "stop", answers: {} }, undefined]) {
    const advisory = await routeTopic(input, { ask: async () => raw, now: () => 0 });
    expect(advisory).toMatchObject({ status: "unavailable", decision: "continue-current" });
    expect(verdictOf(advisory)).toBeUndefined();
  }
  const available = (decision: RoutingAdvisory["decision"], titleFlag: boolean | null) => ({ status: "available", decision, titleFlag }) as RoutingAdvisory;
  expect(verdictOf(available("continue-current", false))).toEqual({ decision: "continue", stale: false });
  expect(verdictOf(available("continue-current", null))).toEqual({ decision: "continue", stale: false });
  expect(verdictOf(available("continue-current", true))).toEqual({ decision: "continue", stale: true });
  expect(verdictOf(available("create-new", true))).toEqual({ decision: "new" });
});

it("asks pi's classifier for Jev with no retry and the call's own deadline alone, so Stop leaves it, and no key, address or header of its own", async () => {
  const one = context(conversation(), continuing);
  const signal = new AbortController().signal;
  const raw = await asker(one.ctx)(STATE, { q: { type: "bool", instructions: "i", criteria: { true: "t", false: "f" } } }, signal);
  expect(one.raw.modelRegistry.findOfType).toHaveBeenCalledWith("classifier", "typesafe", "jev-latest");
  expect(one.raw.modelRegistry.classify.mock.calls[0]![0]).toBe(one.jev);
  expect(one.asked[0]!.options).toEqual({ maxRetries: 0, timeoutMs: 20_000, signal });
  expect(raw).toMatchObject({ stopReason: "stop" });
  // Where pi has no Jev configured nothing is asked, and the answer is no answer.
  const none = context(conversation(), continuing);
  none.raw.modelRegistry.findOfType.mockReturnValue(undefined as never);
  expect(await asker(none.ctx)(STATE, {}, signal)).toBeUndefined();
  expect(none.raw.modelRegistry.classify).not.toHaveBeenCalled();
});

it("titles through pi's own nested call on the model the seller is chatting on, within 20,000 ms and 128 tokens, on no signal of the run's", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const one = context(conversation(), continuing, { ...LABELS }, ["Walmart reorder point", "Walmart stock"]);
  expect(await titler(one.ctx)({ title: "Walmart inventory", messages: ["a", "b"] })).toEqual({ text: "Walmart reorder point" });
  expect(one.raw.modelRegistry.complete.mock.calls[0]![0]).toBe(one.model);
  expect(one.titled[0]!.context).toEqual({ systemPrompt: TITLE_SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: titlePrompt({ title: "Walmart inventory", messages: ["a", "b"] }) }], timestamp: expect.any(Number) }] });
  expect(Object.keys(one.titled[0]!.options).sort()).toEqual(["cacheRetention", "maxTokens", "signal"]);
  expect(one.titled[0]!.options).toMatchObject({ maxTokens: 128, cacheRetention: "none" });
  expect(timeout).toHaveBeenCalledWith(20_000);
  expect(one.titled[0]!.options["signal"]).toBe(timeout.mock.results[0]!.value);
  timeout.mockRestore();
  // The model is read at each call: the seller's switch since the last title writes the next.
  const switched = { id: "invented-other-model", provider: "invented-other-provider" };
  one.raw.model = switched;
  expect(await titler(one.ctx)({ messages: ["c"] })).toEqual({ text: "Walmart stock" });
  expect(one.raw.modelRegistry.complete.mock.calls[1]![0]).toBe(switched);
  // Only an answer pi ends with `stop` is a title: a refusal, a timeout, a cut answer or a throw gives none, and says why.
  for (const [failed, failure] of [
    [async () => ({ role: "assistant", stopReason: "error", errorMessage: "403 membership_required", content: [{ type: "text", text: "Refused" }] }), "refused"],
    [async () => ({ role: "assistant", stopReason: "aborted", content: [{ type: "text", text: "Timed" }] }), "timeout"],
    [async () => ({ role: "assistant", stopReason: "length", content: [{ type: "text", text: "Cut" }] }), "malformed"],
    [async () => { throw new Error("invented failure"); }, "refused"],
  ] as const) {
    one.titleWith(failed);
    expect(await titler(one.ctx)({ messages: ["a"] })).toEqual({ failure });
  }
  // No model chosen: no title, and no model of the package's own asked instead.
  const none = context(conversation(), continuing);
  none.raw.model = undefined;
  expect(await titler(none.ctx)({ messages: ["a"] })).toEqual({ failure: "no-model" });
  expect(none.raw.modelRegistry.complete).not.toHaveBeenCalled();
});

it("titles on a physical model through pi's bounded call, and on a virtual one through the call pi routes it on, with the same options", async () => {
  const one = context(conversation(), continuing, { ...LABELS }, ["Walmart reorder point", "Walmart stock"]);
  expect(await titler(one.ctx)({ messages: ["a"] })).toEqual({ text: "Walmart reorder point" });
  one.raw.model = { id: "auto", provider: "invented-router", api: "pi-virtual" } as typeof one.raw.model;
  expect(await titler(one.ctx)({ messages: ["b"] })).toEqual({ text: "Walmart stock" });
  expect([one.raw.modelRegistry.complete.mock.calls.length, one.raw.modelRegistry.streamSimple.mock.calls.length]).toEqual([1, 1]);
  expect(one.raw.modelRegistry.streamSimple.mock.calls[0]![0]).toBe(one.raw.model);
  const { signal: first, ...bounds } = one.titled[0]!.options;
  const { signal: second, ...same } = one.titled[1]!.options;
  expect([same, second instanceof AbortSignal, first instanceof AbortSignal]).toEqual([bounds, true, true]);
});

it("asks Jev once for a seller message under a title, with nothing but a title and the seller's words in the state, and titles new work from its words", async () => {
  const one = context(conversation(), separate);
  const { judge, written } = judging(one.labels);
  expect(await judge(one.ctx, "u3")).toBe("judged");
  expect(one.asked).toHaveLength(1);
  expect(holdsSymbol(one.asked[0]!.state)).toBe(false);
  expect(one.asked[0]!.state).toEqual({ current: { title: "Walmart inventory", messages: ["Now plan the invented Walmart inventory."] }, latestUserMessage: "Add a reorder point to the plan." });
  expect(Object.keys(one.asked[0]!.questions)).toEqual(["significantChange", "continueCurrent", "titleAdequate"]);
  expect(one.titled.map(prompted)).toEqual([titlePrompt({ messages: ["Add a reorder point to the plan."] })]);
  expect(written).toEqual([["u3", "Reorder point"]]);
  // Another id judges nothing: cx's answer, or one gone from the branch.
  expect([await judge(one.ctx, "a2"), await judge(one.ctx, "gone")]).toEqual(["judged", "judged"]);
  expect([one.asked.length, one.titled.length]).toEqual([1, 1]);
});

it("writes nothing on a continuation whose title still names the work, and rewrites the title on the topic's first message when it no longer does", async () => {
  const kept = context(conversation(), continuing);
  const quiet = judging(kept.labels);
  expect(await quiet.judge(kept.ctx, "u3")).toBe("judged");
  expect([kept.titled.length, quiet.written]).toEqual([0, []]);
  const moved = context(conversation(), stale, { ...LABELS }, ["Walmart reorder planning"]);
  const rewrite = judging(moved.labels);
  expect(await rewrite.judge(moved.ctx, "u3")).toBe("judged");
  expect(moved.titled.map(prompted)).toEqual([titlePrompt({ title: "Walmart inventory", messages: ["Now plan the invented Walmart inventory.", "Add a reorder point to the plan."] })]);
  expect(rewrite.written).toEqual([["u2", "Walmart reorder planning"]]);
  // A rewrite to the same title writes nothing.
  const same = context(conversation(), stale, { ...LABELS }, ["Walmart inventory"]);
  const unchanged = judging(same.labels);
  expect(await unchanged.judge(same.ctx, "u3")).toBe("judged");
  expect(unchanged.written).toEqual([]);
});

it("titles a seller message before the first title without asking Jev, whose only answer would be new work, and none of no words, asking nothing", async () => {
  const one = context([said("u1", "Analyse the invented BE3600 positioning.")], separate, {}, ["BE3600 analysis"]);
  const { judge, written } = judging(one.labels);
  expect(await judge(one.ctx, "u1")).toBe("judged");
  expect(one.asked).toHaveLength(0);
  expect(one.titled.map(prompted)).toEqual([titlePrompt({ messages: ["Analyse the invented BE3600 positioning."] })]);
  expect(written).toEqual([["u1", "BE3600 analysis"]]);
  const empty = context([said("u0", "<quote entry=\"x\" at=\"1\">only a quote</quote>")], separate, {});
  const quiet = judging(empty.labels);
  expect(await quiet.judge(empty.ctx, "u0")).toBe("judged");
  // Under a title, a blank message is not asked about either: it is judged, and stops nothing.
  const blank = context([...conversation(), said("u4", "<quote entry=\"a2\" at=\"1\">Invented stock plan.</quote>")], separate);
  const under = judging(blank.labels);
  expect(await under.judge(blank.ctx, "u4")).toBe("judged");
  expect([empty.asked.length, empty.titled.length, quiet.written, blank.asked.length, under.written]).toEqual([0, 0, [], 0, []]);
});

/** Each failure carries every answer new work would, so only what pi names it keeps it from being one. */
const full = (questions: Record<string, unknown>, probability: (key: string) => number = separate) =>
  Object.fromEntries(Object.keys(questions).map(key => [key, { type: "bool", probability: probability(key) }]));

it("stops, writing nothing, on a failure the same request may get past: the gate's refusals, 401, 402, 404, 408, 429, 5xx, an unread status, a timeout, no model", async () => {
  for (const errorMessage of [
    "System One API error (403): {\"error\":{\"code\":\"membership_required\",\"message\":\"membership_required: invented\"}}",
    "System One API error (403): {\"error\":{\"code\":\"debt_owed\"}}",
    "System One API error (403): {\"error\":{\"code\":\"model_not_served\"}}",
    "403 membership_required", "403 debt_owed",
    "System One API error (401): sign_in_again", "System One API error (402): invented", "System One API error (404): invented",
    "System One API error (408): invented", "System One API error (429): invented", "System One API error (500): invented",
    "System One API error (503): membership_unavailable", "Request timed out after 20000ms", "invented failure with no status", "",
    "System One API error (503): {\"error\":{\"message\":\"upstream (400) temporarily unavailable\"}}",
    "System One API error (503): {\"error\":{\"message\":\"upstream error (400): temporarily unavailable\"}}",
    "{\"error\":{\"message\":\"upstream error (400): invented, with no status pi wrote\"}}",
  ]) {
    const one = context(conversation(), separate);
    one.answerWith(async questions => ({ stopReason: "error", answers: full(questions), errorMessage }));
    const { judge, written } = judging(one.labels);
    expect([errorMessage, await judge(one.ctx, "u3")]).toEqual([errorMessage, "stopped"]);
    expect([one.titled.length, written]).toEqual([0, []]);
  }
  const aborted = context(conversation(), separate);
  aborted.answerWith(async questions => ({ stopReason: "aborted", answers: full(questions) }));
  expect(await judging(aborted.labels).judge(aborted.ctx, "u3")).toBe("stopped");
  const thrown = context(conversation(), separate);
  thrown.answerWith(async () => { throw new Error("invented failure"); });
  expect(await judging(thrown.labels).judge(thrown.ctx, "u3")).toBe("stopped");
  const none = context(conversation(), separate);
  none.raw.modelRegistry.findOfType.mockReturnValue(undefined as never);
  expect(await judging(none.labels).judge(none.ctx, "u3")).toBe("stopped");
  expect(none.raw.modelRegistry.classify).not.toHaveBeenCalled();
});

it("moves on, writing nothing, when the call was answered or the request itself refused: 400, 413, 422, a 403 of no gate code, usage, an unreadable answer", async () => {
  for (const failure of [
    (questions: Record<string, unknown>) => ({ stopReason: "error", answers: full(questions), errorMessage: "System One API error (400): {\"error\":\"max_tokens_exceeded\"}" }),
    (questions: Record<string, unknown>) => ({ stopReason: "error", answers: full(questions), errorMessage: "System One API error (413): request_too_large" }),
    (questions: Record<string, unknown>) => ({ stopReason: "error", answers: full(questions), errorMessage: "System One API error (422): invented" }),
    (questions: Record<string, unknown>) => ({ stopReason: "error", answers: full(questions), errorMessage: "System One API error (403): invented provider refusal" }),
    (questions: Record<string, unknown>) => ({ stopReason: "error", answers: full(questions), errorMessage: "System One API error (400): {\"error\":\"invented (429) in the provider's words\"}" }),
    (questions: Record<string, unknown>) => ({ stopReason: "error", answers: full(questions), errorMessage: "System One API returned an invalid answer", usage: { input: 445, output: 0, totalTokens: 445 } }),
    (questions: Record<string, unknown>) => ({ stopReason: "stop", answers: full(questions, key => (key === "significantChange" ? 1.5 : separate(key))) }),
    (_questions: Record<string, unknown>) => ({ stopReason: "stop", answers: {} }),
  ]) {
    const one = context(conversation(), separate);
    one.answerWith(async questions => failure(questions));
    const { judge, written } = judging(one.labels);
    expect(await judge(one.ctx, "u3")).toBe("judged");
    expect([one.titled.length, written]).toEqual([0, []]);
  }
});

it("reads the title call's failures as Jev's, by the status at the head of pi's text before any number in the provider's body: a refusal or a timeout stops, an answer cut at its cap or a request refused as it is moves on", async () => {
  for (const [answer, outcome] of [
    [{ role: "assistant", stopReason: "error", errorMessage: "403 membership_required", content: [], usage: { input: 0, output: 0, totalTokens: 0 } }, "stopped"],
    [{ role: "assistant", stopReason: "error", errorMessage: "429 invented", content: [], usage: { input: 0, output: 0, totalTokens: 0 } }, "stopped"],
    [{ role: "assistant", stopReason: "aborted", content: [{ type: "text", text: "Timed" }], usage: { input: 9, output: 1, totalTokens: 10 } }, "stopped"],
    [{ role: "assistant", stopReason: "length", content: [{ type: "text", text: "Cut" }], usage: { input: 9, output: 128, totalTokens: 137 } }, "judged"],
    [{ role: "assistant", stopReason: "error", errorMessage: "400 invented", content: [], usage: { input: 0, output: 0, totalTokens: 0 } }, "judged"],
    [{ role: "assistant", stopReason: "error", errorMessage: "503: {\"error\":{\"message\":\"upstream (400) temporarily unavailable\"}}", content: [], usage: { input: 0, output: 0, totalTokens: 0 } }, "stopped"],
    [{ role: "assistant", stopReason: "error", errorMessage: "400 {\"error\":\"invented (429) in the provider's words\"}", content: [], usage: { input: 0, output: 0, totalTokens: 0 } }, "judged"],
    [{ role: "assistant", stopReason: "error", errorMessage: "503 {\"error\":{\"message\":\"upstream error (400): temporarily unavailable\"}}", content: [], usage: { input: 0, output: 0, totalTokens: 0 } }, "stopped"],
    [{ role: "assistant", stopReason: "error", errorMessage: "400 {\"error\":{\"message\":\"upstream error (429): invalid request\"}}", content: [], usage: { input: 0, output: 0, totalTokens: 0 } }, "judged"],
    [{ role: "assistant", stopReason: "error", errorMessage: "503: {\"error\":{\"message\":\"upstream error (400): temporarily unavailable\"}}", content: [], usage: { input: 0, output: 0, totalTokens: 0 } }, "stopped"],
    [{ role: "assistant", stopReason: "error", errorMessage: "Provider finish_reason: content_filter", content: [], usage: { input: 30, output: 2, totalTokens: 32 } }, "judged"],
  ] as const) {
    const one = context(conversation(), separate);
    one.titleWith(async () => answer);
    const { judge, written } = judging(one.labels);
    expect([answer.stopReason, await judge(one.ctx, "u3")]).toEqual([answer.stopReason, outcome]);
    expect([one.titled.length, written]).toEqual([1, []]);
  }
  const thrown = context(conversation(), separate);
  thrown.titleWith(async () => { throw new Error("invented failure"); });
  expect(await judging(thrown.labels).judge(thrown.ctx, "u3")).toBe("stopped");
  const none = context([said("u1", "Analyse the invented BE3600 positioning.")], separate, {});
  none.raw.model = undefined;
  expect(await judging(none.labels).judge(none.ctx, "u1")).toBe("stopped");
});

it("asks classify once on a refusal, retrying nothing, as a call TypeSafe received is billed even when its answer is lost", async () => {
  const one = context(conversation(), separate);
  one.answerWith(async questions => ({ stopReason: "error", answers: full(questions), errorMessage: "System One API error (403): {\"error\":{\"code\":\"debt_owed\"}}" }));
  expect(await judging(one.labels).judge(one.ctx, "u3")).toBe("stopped");
  expect(one.raw.modelRegistry.classify).toHaveBeenCalledTimes(1);
  expect(one.asked[0]!.options).toMatchObject({ maxRetries: 0 });
});

it("writes a title, new or a rewrite, only while the label it was asked on stands", async () => {
  const one = context(conversation(), separate);
  const { judge, written } = judging(one.labels);
  one.titleWith(async () => { one.labels["u3"] = "Named meanwhile"; return { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Reorder point" }] }; });
  expect(await judge(one.ctx, "u3")).toBe("judged");
  expect(written).toEqual([]);
  const renamed = context(conversation(), stale);
  const rewrite = judging(renamed.labels);
  renamed.titleWith(async () => { renamed.labels["u2"] = "Walmart stock, renamed meanwhile"; return { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Walmart reorder planning" }] }; });
  expect(await rewrite.judge(renamed.ctx, "u3")).toBe("judged");
  expect([renamed.titled.length, rewrite.written, renamed.labels["u2"]]).toEqual([1, [], "Walmart stock, renamed meanwhile"]);
});

/** The bytes pi sends for a Jev request: `JSON.stringify` of the model, the state and the questions, each `bool` as TypeSafe's `noul`. */
const wireBytes = (asked: Asked): number => Buffer.byteLength(JSON.stringify({
  model: JEV.model, state: asked.state, questions: Object.fromEntries(Object.entries(asked.questions).map(([key, question]) => [key, { ...(question as object), type: "noul" }])),
}));
/** The request Jev is sent for a topic at every bound: an 80-character title, 40 seller messages of `each`, and a latest of `latest`. */
async function largest(each: string, latest: string, titled: string): Promise<number> {
  const entries = [...Array.from({ length: 40 }, (_, at) => said(`m${at}`, each)), said("last", latest)];
  const one = context(entries, continuing, { m0: titled });
  await judging(one.labels).judge(one.ctx, "last");
  expect(one.asked).toHaveLength(1);
  expect((one.asked[0]!.state as { current: { messages: unknown[] } }).current.messages).toHaveLength(ROUTING_LIMITS.sellerMessages);
  return wireBytes(one.asked[0]!);
}

it("sends Jev at most 109,260 bytes, the bounds counted in code points: what a seller message can carry costs JSON six bytes a code point at most", async () => {
  const { messageChars, latestChars } = ROUTING_LIMITS;
  // A control character, like a lone surrogate, is written `\u0001` by `JSON.stringify`: six bytes, the most any code point takes.
  const worst = (n: number) => "\u0001".repeat(n);
  const bytes = await largest(worst(messageChars), worst(latestChars), worst(80));
  expect(bytes).toBe(109_260);
  expect(await largest("\ud800".repeat(messageChars), "\ud800".repeat(latestChars), "\ud800".repeat(80))).toBe(bytes);
  // A four-byte character, and a three-byte one, make it smaller; a message past its bound is cut back within it, the marker included.
  expect(await largest("😀".repeat(messageChars), "😀".repeat(latestChars), "😀".repeat(80))).toBeLessThan(bytes);
  expect(await largest("船".repeat(messageChars), "船".repeat(latestChars), "燈".repeat(80))).toBeLessThan(bytes);
  expect(await largest(worst(messageChars * 4), worst(latestChars * 4), worst(80))).toBeLessThan(bytes);
});
