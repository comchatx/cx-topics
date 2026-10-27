import { afterEach, expect, it, vi } from "vitest";
import { routeTopic, ROUTING_LIMITS, type RoutingInput } from "../../src/core/routing.js";
import { failureOf, parseAnswers, ReviewFailure, type Questions } from "../../src/core/protocol.js";
import { routingFixtures } from "../support/routing-fixtures.js";

afterEach(() => vi.useRealTimers());
const input = (): RoutingInput => ({ ...routingFixtures[0]!.input });
const bool = (probability: unknown) => ({ type: "bool", probability });
const answers = { significantChange: bool(0.1), continueCurrent: bool(0.9), titleAdequate: bool(0.9) };
const evaluate = (raw: unknown) => routeTopic(input(), { ask: async () => raw, now: () => 0 });
const questions: Questions = {
  significantChange: { type: "bool", instructions: "Invented question.", criteria: { true: "yes", false: "no" } },
  continueCurrent: { type: "bool", instructions: "Invented second question.", criteria: { true: "yes", false: "no" } },
};

it.each([
  { stopReason: "stop", answers: { ...answers, significantChange: { type: "choice", probability: 0.1 } } },
  { stopReason: "stop", answers: { ...answers, significantChange: { type: "bool", noul: 0.1 } } },
  { stopReason: "stop", answers: "yes" },
  "yes",
])("refuses an answer that is not a probability of a bool question %#", raw => {
  expect(parseAnswers(raw, questions)).toBe("malformed");
});

it("rejects malformed, missing, nonfinite and out-of-range probabilities while retaining the baseline", async () => {
  for (const raw of [null, [], "yes", { stopReason: "stop" }, { stopReason: "stop", answers: [] }, { stopReason: "stop", answers: null },
    ...[null, {}, true, "yes", NaN, Infinity, -Infinity, -0.01, 1.01].map(probability => ({ stopReason: "stop", answers: { ...answers, significantChange: bool(probability) } }))]) {
    expect(await evaluate(raw)).toMatchObject({ status: "unavailable", reason: "malformed", baseline: { decision: "continuation" }, probabilities: null });
  }
  for (const key of Object.keys(answers)) {
    const partial: Record<string, unknown> = { ...answers }; delete partial[key];
    expect(await evaluate({ stopReason: "stop", answers: partial })).toMatchObject({ status: "unavailable", reason: "missing-answers" });
  }
  expect(await evaluate({ stopReason: "stop", answers: Object.create(answers) })).toMatchObject({ status: "unavailable", reason: "missing-answers" });
  for (const p of [0, 1]) expect(await evaluate({ stopReason: "stop", answers: { significantChange: bool(1 - p), continueCurrent: bool(p), titleAdequate: bool(p) } })).toMatchObject({ status: "available", decision: p === 1 ? "continue-current" : "create-new", titleFlag: p === 0 });
});

it("returns unavailable for any result but an answer, whatever pi names it, keeping none of its text", async () => {
  for (const [stopReason, reason] of [["error", "refused"], ["aborted", "timeout"], [undefined, "refused"]] as const) {
    const result = await evaluate({ stopReason, answers, errorMessage: "invented secret error body" });
    expect(result).toMatchObject({ status: "unavailable", reason });
    expect(JSON.stringify(result)).not.toContain("invented secret");
  }
});

it("returns unavailable for explicit refusal, thrown failure and timeout, and keeps only a known failure kind", async () => {
  for (const error of [new ReviewFailure("refused"), new Error("invented secret error body"), new ReviewFailure("timeout"), new ReviewFailure("invented upstream body" as "refused")]) {
    const result = await routeTopic(input(), { ask: async () => { throw error; }, now: () => 0 });
    expect(result).toMatchObject({ status: "unavailable", reason: error instanceof ReviewFailure && error.kind === "timeout" ? "timeout" : "refused" });
    expect(JSON.stringify(result)).not.toMatch(/invented (secret|upstream)/);
  }
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const pending = routeTopic(input(), { ask: async (_state, _questions, received) => { signal = received; return new Promise(() => {}); }, now: () => Date.now() });
  await vi.advanceTimersByTimeAsync(ROUTING_LIMITS.timeoutMs);
  expect(await pending).toMatchObject({ status: "unavailable", reason: "timeout", requestCount: 1, latencyMs: ROUTING_LIMITS.timeoutMs });
  expect(signal!.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("requires an own answer to every question, reads a parser failure as malformed, and forwards none of pi's metadata", async () => {
  expect(parseAnswers({ stopReason: "stop", answers: Object.create(answers) }, questions)).toBe("missing-answers");
  expect(parseAnswers({ stopReason: "stop", answers: { significantChange: answers.significantChange } }, questions)).toBe("missing-answers");
  const raw = new Proxy({}, { get: (_target, key) => { if (key === "then") return undefined; throw new Error("Invented parser failure"); } });
  expect(await evaluate(raw)).toMatchObject({ status: "unavailable", reason: "malformed" });
  const result = { api: "typesafe-system-one", provider: "typesafe", model: "jev-latest", answers: { ...answers }, stopReason: "stop", usage: { input: 445, output: 0 }, timestamp: 1 };
  const advisory = await evaluate(result);
  result.answers.significantChange = bool(1);
  expect(advisory).toMatchObject({ status: "available", probabilities: { significantChange: 0.1, continueCurrent: 0.9 } });
  for (const key of ["api", "provider", "model", "usage", "timestamp"]) expect(advisory).not.toHaveProperty(key);
});

it("reads no classifier label holding a quote, an opening or closing brace, or a colon, each on its own", () => {
  // Each text holds one of the four before its `error (400):`, and nothing else the label keeps out: read as a label it would be a 400.
  const refused = (errorMessage: string) => failureOf({ stopReason: "error", errorMessage });
  for (const held of ["\"", "{", "}", ":"]) expect(refused(`invented ${held} upstream error (400): temporarily unavailable`), held).toBe("refused");
  expect(refused("invented upstream error (400): temporarily unavailable")).toBe("rejected");
});
