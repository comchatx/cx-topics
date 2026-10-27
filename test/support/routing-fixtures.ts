import type { Decision, RoutingDecision, RoutingInput, TopicProjection } from "../../src/core/routing.js";
import type { Questions } from "../../src/core/protocol.js";

export const topicProjection = (title: string | undefined, messages: readonly string[]): TopicProjection => Object.freeze({ ...(title === undefined ? {} : { title }), messages: Object.freeze([...messages]) });
export const scriptedRoutingAnswers = (questions: Questions, continuing: number, significant = 0.9) => ({ stopReason: "stop", answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: "bool", probability: key === "continueCurrent" ? continuing : key === "significantChange" ? significant : 0.9 }])) });
export type RoutingFixture = { readonly name: string; readonly expected: RoutingDecision | null; readonly input: RoutingInput; readonly continuing: number; readonly significant: number; readonly failure?: "refused" | "timeout" | "malformed" | "missing" };
const fixture = (name: string, latestUserMessage: string, expected: RoutingDecision | null, continuing: number, baselineDecision: Decision = "continuation", significant = 0.9, failure?: RoutingFixture["failure"]): RoutingFixture => Object.freeze({
  name, expected, continuing, significant, ...(failure === undefined ? {} : { failure }),
  input: Object.freeze({
    latestUserMessage, baselineDecision,
    current: topicProjection("Walmart inventory planning", ["For an invented shop, plan Walmart stock handling.", "Keep the stock plan to the two invented warehouses."]),
  }),
});
export const routingFixtures: readonly RoutingFixture[] = Object.freeze([
  fixture("current-continuation", "Add a reorder checklist for the same Walmart stock plan.", "continue-current", 0.95),
  fixture("misleading-shared-product", "Plan Walmart receiving checks for BE3600 cartons. This is warehouse stock handling, not product analysis.", "continue-current", 0.95),
  fixture("shared-product-separate-intent", "Write a fictional BE3600 mystery story, unrelated to the inventory plan.", "create-new", 0.05),
  fixture("brief-tangent", "Quick aside: what does reorder mean? Then continue the stock plan.", "continue-current", 0.4, "new-topic", 0.1),
  fixture("correction", "Correction: the invented inventory has two shelves, not three. Keep the same plan.", "continue-current", 0.95),
  fixture("chinese-new", "現在另外設計一個虛構的月球車遊戲，與庫存無關。", "create-new", 0.05),
  fixture("mixed-continuation", "Walmart inventory 再加一個 reorder point，同一個計劃。", "continue-current", 0.9),
  fixture("rename-context", "The inventory title is misleading: this is still the same Walmart stock work, not a launch.", "continue-current", 0.95),
  fixture("debatable-subproblem", "Could stock planning become a separate reusable handbook for other shops?", null, 0.45, "continuation", 0.6),
  fixture("queued-new", "Queue this: after the inventory answer, plan the invented BE3600 sales campaign.", "create-new", 0.05),
  ...(["refused", "timeout", "malformed", "missing"] as const).map(failure => fixture(`provider-${failure}`, "Add a shelf to the same invented inventory plan.", "continue-current", 0.95, "continuation", 0.9, failure)),
]);
