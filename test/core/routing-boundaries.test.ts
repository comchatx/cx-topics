import { expect, it, vi } from "vitest";
import { routeTopic, ROUTING_LIMITS, type RoutingInput } from "../../src/core/routing.js";
import { routingFixtures, scriptedRoutingAnswers, topicProjection } from "../support/routing-fixtures.js";

const input = (): RoutingInput => ({ ...routingFixtures[0]!.input });
const bad = () => {
  const one = input();
  const topic = one.current;
  return [null, undefined,
    { ...one, baselineDecision: "rename" }, { ...one, latestUserMessage: " " },
    { ...one, current: undefined }, { ...one, current: null },
    { ...one, current: { ...topic, messages: null } }, { ...one, current: { ...topic, messages: new Array(3) } }, { ...one, current: { ...topic, messages: [topic.messages[0], , topic.messages[1]] } },
    { ...one, current: { ...topic, title: "one\ntwo" } }, { ...one, current: { ...topic, title: "x".repeat(81) } },
    { ...one, current: { messages: [] } }, { ...one, current: { ...topic, messages: [null] } },
    { ...one, current: { ...topic, messages: [{ role: "user", text: topic.messages[0] }] } },
    { ...one, current: { ...topic, messages: Array(ROUTING_LIMITS.sellerMessages + 1).fill(topic.messages[0]) } },
    // A length shorter than the seller's messages shown, or not a whole count.
    { ...one, currentLength: 1 }, { ...one, currentLength: 2.5 }, { ...one, currentLength: "2" },
  ];
};
it.each(bad())("returns invalid-input without asking or disclosure for invalid routing envelope %#", async raw => {
  const ask = vi.fn();
  const result = await routeTopic(raw as unknown as RoutingInput, { ask, now: () => 0 });
  expect(result).toMatchObject({ status: "unavailable", reason: "invalid-input", requestCount: 0, decision: null, disclosedFields: [] });
  expect(ask).not.toHaveBeenCalled();
  expect(Object.isFrozen(result.baseline)).toBe(true);
});
it("judges against a title with no words of the seller's under it, or words with no title, asking whether a title still names the work only where there is one", async () => {
  const one = input();
  const ask = vi.fn(async (_state, questions) => scriptedRoutingAnswers(questions, 0.9));
  const titled = await routeTopic({ ...one, current: topicProjection("Invented image work", []), currentLength: 1 }, { ask, now: () => 0 });
  expect(titled).toMatchObject({ status: "available", decision: "continue-current", titleFlag: false, disclosedFields: ["current", "current.title", "current.messages", "latestUserMessage"] });
  expect(Object.keys(ask.mock.calls[0]![1])).toEqual(["significantChange", "continueCurrent", "titleAdequate"]);
  expect(ask.mock.calls[0]![0]).toEqual({ current: { title: "Invented image work", messages: [] }, latestUserMessage: one.latestUserMessage });
  const untitled = { ...one, current: topicProjection(undefined, one.current.messages) };
  expect(await routeTopic(untitled, { ask: async (_s, q) => scriptedRoutingAnswers(q, 0.9), now: () => 0 })).toMatchObject({ decision: "continue-current", titleFlag: null });
  expect(await routeTopic(untitled, { ask: async (_s, q) => scriptedRoutingAnswers(q, 0.45), now: () => 0 })).toMatchObject({ decision: "create-new" });
});
it("keeps a full request in Chinese text within the size of the full one before it, at most the seller-message bound", async () => {
  // A full projection in Chinese: an 80-character title, the bound's messages at 512 characters and the latest at 2,048, three bytes a
  // character, and the three questions a titled topic is asked. The largest request, of six-byte characters, is the judge's test.
  let bytes = 0;
  let questionCount = 0;
  const full = { ...input(), current: topicProjection("燈".repeat(80), Array(ROUTING_LIMITS.sellerMessages).fill("船".repeat(512))), latestUserMessage: "船".repeat(2048), currentLength: 40 };
  const result = await routeTopic(full, { ask: async (state, questions) => {
    bytes = Buffer.byteLength(JSON.stringify({ model: "jev-latest", state, questions })); questionCount = Object.keys(questions).length;
    return scriptedRoutingAnswers(questions, 0.95);
  }, now: () => 0 });
  expect(result.decision).toBe("continue-current");
  expect(questionCount).toBe(3);
  expect(bytes).toBeLessThanOrEqual(56_355);
  // One more message would not fit, so the bound is as many as do.
  expect(bytes + Buffer.byteLength(`,${JSON.stringify("船".repeat(512))}`)).toBeGreaterThan(56_355);
});
