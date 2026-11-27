import { expect, it, vi } from "vitest";
import { routeTopic, ROUTING_LIMITS, type RoutingInput } from "../../src/core/routing.js";
import { raw, routingFixtures, scriptedRoutingAnswers, topicProjection } from "../support/routing-fixtures.js";

const input = (): RoutingInput => ({ ...routingFixtures[0]!.input });
it("judges against a title with no words of the seller's under it, or words with no title, asking whether a title still names the work only where there is one", async () => {
  const one = input();
  const ask = vi.fn(async (_state, questions) => scriptedRoutingAnswers(questions, 0.9));
  const titled = await routeTopic({ ...one, current: topicProjection("Invented image work", []), currentLength: 1 }, { ask: raw(ask) });
  expect(titled).toMatchObject({ status: "available", decision: "continue-current", titleFlag: false });
  expect(Object.keys(ask.mock.calls[0]![1])).toEqual(["significantChange", "continueCurrent", "titleAdequate"]);
  expect(ask.mock.calls[0]![0]).toEqual({ current: { title: "Invented image work", messages: [] }, latestUserMessage: one.latestUserMessage });
  const untitled = { ...one, current: topicProjection(undefined, one.current.messages) };
  expect(await routeTopic(untitled, { ask: raw(async (_s, q) => scriptedRoutingAnswers(q, 0.9)) })).toMatchObject({ decision: "continue-current", titleFlag: null });
  expect(await routeTopic(untitled, { ask: raw(async (_s, q) => scriptedRoutingAnswers(q, 0.45)) })).toMatchObject({ decision: "create-new" });
});
it("keeps a full request in Chinese text within the size of the full one before it, at most the seller-message bound", async () => {
  // A full projection in Chinese: an 80-character title, the bound's messages at 512 characters and the latest at 2,048, three bytes a
  // character, and the three questions a titled topic is asked. The largest request, of six-byte characters, is the judge's test.
  let bytes = 0;
  let questionCount = 0;
  const full = { ...input(), current: topicProjection("燈".repeat(80), Array(ROUTING_LIMITS.sellerMessages).fill("船".repeat(512))), latestUserMessage: "船".repeat(2048), currentLength: 40 };
  const result = await routeTopic(full, { ask: raw(async (state, questions) => {
    bytes = Buffer.byteLength(JSON.stringify({ model: "jev-latest", state, questions })); questionCount = Object.keys(questions).length;
    return scriptedRoutingAnswers(questions, 0.95);
  }) });
  expect(result).toMatchObject({ decision: "continue-current" });
  expect(questionCount).toBe(3);
  expect(bytes).toBeLessThanOrEqual(56_355);
  // One more message would not fit, so the bound is as many as do.
  expect(bytes + Buffer.byteLength(`,${JSON.stringify("船".repeat(512))}`)).toBeGreaterThan(56_355);
});
