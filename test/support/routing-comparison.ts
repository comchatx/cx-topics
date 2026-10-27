import { ReviewFailure } from "../../src/core/protocol.js";
import { routeTopic, type RoutingDecision, type RoutingState } from "../../src/core/routing.js";
import { routingFixtures, scriptedRoutingAnswers } from "./routing-fixtures.js";
const errors = (decision: RoutingDecision, expected: RoutingDecision | null) => ({
  missedBoundary: expected === null ? null : expected !== "continue-current" && decision === "continue-current",
  superfluousBoundary: expected === null ? null : expected === "continue-current" && decision !== "continue-current",
});
export async function compareRoutingFixtures() {
  const rows = [];
  for (const fixture of routingFixtures) {
    let clock = 0;
    let disclosed: RoutingState | undefined;
    const result = await routeTopic(fixture.input, { now: () => clock, ask: async (state, questions) => {
      disclosed = state; clock += 7;
      if (fixture.failure === "refused") return { stopReason: "error", answers: {}, errorMessage: "invented refusal" };
      if (fixture.failure === "timeout") throw new ReviewFailure("timeout");
      if (fixture.failure === "malformed") return { stopReason: "stop", answers: [] };
      if (fixture.failure === "missing") return { stopReason: "stop", answers: {} };
      return scriptedRoutingAnswers(questions, fixture.continuing, fixture.significant);
    } });
    const baseline = fixture.input.baselineDecision === "continuation" ? "continue-current" : "create-new";
    rows.push({ fixture: fixture.name, expected: fixture.expected, baseline: { decision: baseline, ...errors(baseline, fixture.expected) },
      advisory: result.status === "available" ? { decision: result.decision, ...errors(result.decision!, fixture.expected), disagreement: result.disagreement, titleFlag: result.titleFlag, probabilities: result.probabilities } : { unavailable: result.reason, fallback: result.decision },
      requestCount: result.requestCount, latencyMs: result.latencyMs, disclosedFields: result.disclosedFields, disclosed,
    });
  }
  return { evidence: "Invented projections and scripted intent probabilities only. No new provider calls, quality claim or production integration.", rows,
    totals: {
      baselineMissed: rows.filter(r => r.baseline.missedBoundary).length,
      baselineSuperfluous: rows.filter(r => r.baseline.superfluousBoundary).length,
      advisoryMissed: rows.filter(r => "missedBoundary" in r.advisory && r.advisory.missedBoundary).length,
      advisorySuperfluous: rows.filter(r => "superfluousBoundary" in r.advisory && r.advisory.superfluousBoundary).length,
      disagreements: rows.filter(r => "disagreement" in r.advisory && r.advisory.disagreement).length,
      titleFlags: rows.filter(r => "titleFlag" in r.advisory && r.advisory.titleFlag).length,
      unavailable: rows.filter(r => "unavailable" in r.advisory).length,
      requestCount: rows.reduce((n, r) => n + r.requestCount, 0), latencyMs: rows.reduce((n, r) => n + r.latencyMs, 0),
    },
  };
}
