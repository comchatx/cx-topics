import { askQuestions, list, pick, record, validTitle, type AnswerFailure, type Question, type QuestionAsker, type Questions } from "./protocol.js";

export const ROUTING_LIMITS = Object.freeze({
  // A seller message over 512 code points, and the latest over 2,048, keeps its head and tail (`cut`).
  messageChars: 512, latestChars: 2048,
  // The newest 31 of a topic's seller messages are shown, as many as kept a full request in Chinese text within the size of a full one when
  // Jev was also shown cx's words and three earlier topics (56,355 bytes): where a topic now stands is in its newest messages, and its title
  // says where it began. The topic's length still counts every one. The bounds are code points, so the largest request is of characters
  // JSON writes in six bytes, 109,260 bytes.
  sellerMessages: 31,
  // How long the router gives the asker when its caller names no deadline.
  timeoutMs: 1000,
  confident: 0.8, unlikely: 0.2,
  // A title is rewritten only when Jev answers at most this that it still names the topic's work: a rewrite is a paid call and renames a
  // row the seller reads, so it takes the answer a settled topic takes to call a message a lasting change.
  staleTitle: 0.2,
  // How long the title model is given: nothing waits for a title, so the bound only ends a call that would otherwise hang, at the time
  // Jev's own call is given.
  titleMs: 20_000,
  // A title of 80 characters is under 128 tokens in any language; the cap bounds what a runaway answer costs.
  titleTokens: 128,
  // A topic of two seller messages or fewer is still finding its shape (the product owner's example: two messages on one product's listing, then a
  // third on another's, is one topic), so an even answer continues it.
  shortTopic: 2, shortTopicBar: 0.5,
  // By eight seller messages a topic is settled, and a message continues it only on the confident answer every message needed before.
  longTopic: 8,
});
export type Decision = "new-topic" | "continuation";
export type UnavailableReason = "invalid-input" | AnswerFailure;
export type RoutingDecision = "continue-current" | "create-new";
/** The topic in progress: its title, and the seller's own messages under it, oldest first; never cx's. */
export type TopicProjection = { readonly title?: string; readonly messages: readonly string[] };
export type RoutingInput = {
  readonly current: TopicProjection;
  readonly latestUserMessage: string;
  readonly baselineDecision: Decision;
  /** The seller's messages under the current title, before the projection keeps its newest; those the projection shows when not given. */
  readonly currentLength?: number;
};
type DisclosedTopic = { readonly title?: string; readonly messages: readonly string[] };
export type RoutingState = { readonly current: DisclosedTopic; readonly latestUserMessage: string };
export type RoutingAsker = QuestionAsker<RoutingState>;
export type RoutingAdvisory = {
  readonly latestUserMessage: string | null;
  readonly baseline: { readonly decision: Decision | null };
  readonly status: "available" | "unavailable";
  readonly reason?: UnavailableReason;
  readonly decision: RoutingDecision | null;
  readonly probabilities: Readonly<Record<string, number>> | null;
  readonly disagreement: boolean | null;
  /** Jev judged that the current title no longer names the topic's work; null when no title was asked about. */
  readonly titleFlag: boolean | null;
  readonly requestCount: 0 | 1;
  readonly latencyMs: number;
  readonly disclosedFields: readonly string[];
};

const filled = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
/**
 * A text longer than `max` code points keeps its head and its tail around a marker saying how much was left out, at most `max` in all: an instruction
 * typed after a long paste is what decides where a message belongs.
 */
export function cut(text: string, max: number): string {
  const points = [...text];
  if (points.length <= max) return text;
  const marker = (omitted: number) => `\n[… ${omitted} characters omitted …]\n`;
  const keep = max - marker(points.length).length;
  const head = Math.ceil(keep / 2);
  return `${points.slice(0, head).join("")}${marker(points.length - keep)}${points.slice(points.length - (keep - head)).join("")}`;
}
const cutText = (value: unknown, max: number): unknown => (filled(value) ? cut(value, max) : value);
const copyTopic = (value: unknown): Record<string, unknown> | undefined => {
  const topic = pick(value, ["title", "messages"]);
  return topic && { ...topic, messages: list(topic.messages, ROUTING_LIMITS.sellerMessages, text => cutText(text, ROUTING_LIMITS.messageChars)) };
};
function copied(input: unknown): Readonly<Record<string, unknown>> {
  const envelope = pick(input, ["current", "latestUserMessage", "baselineDecision", "currentLength"]) ?? {};
  return { ...envelope, latestUserMessage: cutText(envelope.latestUserMessage, ROUTING_LIMITS.latestChars), current: copyTopic(envelope.current) };
}
/** A topic Jev can judge against: a title, or at least one message of the seller's. */
function validTopic(topic: unknown): topic is TopicProjection {
  return record(topic) && (topic.title === undefined || validTitle(topic.title)) && Array.isArray(topic.messages)
    && (topic.title !== undefined || topic.messages.length > 0) && (topic.messages as unknown[]).every(filled);
}
function valid(input: Readonly<Record<string, unknown>>): input is RoutingInput {
  return (input.baselineDecision === "new-topic" || input.baselineDecision === "continuation")
    && filled(input.latestUserMessage) && validTopic(input.current)
    && (input.currentLength === undefined
      || (Number.isSafeInteger(input.currentLength) && (input.currentLength as number) >= (input.current as TopicProjection).messages.length));
}
const question = (instructions: string, yes: string, no: string): Question => Object.freeze({ type: "bool", instructions, criteria: Object.freeze({ true: yes, false: no }) });

function questionsFor(state: RoutingState): Questions {
  return Object.freeze({
    significantChange: question("Does state.latestUserMessage request lasting separate work rather than a brief tangent or correction to state.current?", "Lasting separate work", "A brief tangent or a correction"),
    // The same task on another product sits between the two answers, so a topic's length can decide it; another kind of task does not.
    continueCurrent: question("Does state.latestUserMessage intend to continue or correct the work in state.current, its title and the seller's messages so far, rather than start separate work? The same task on another product continues it less surely than the same product; another kind of task does not continue it. Judge intent, not shared product words.", "Continues or corrects the work", "Starts another kind of work"),
    ...(state.current.title === undefined ? {} : { titleAdequate: question("Does state.current.title still name the work in state.current, the seller's messages so far, together with state.latestUserMessage? A title that names where the work began but not where it has gone does not.", "Still names the work", "No longer names the work") }),
  });
}
const fieldPaths = (state: RoutingState): readonly string[] => Object.freeze([
  "current", ...(state.current.title === undefined ? [] : ["current.title"]), "current.messages", ...state.current.messages.map((_, i) => `current.messages[${i}]`),
  "latestUserMessage",
]);

/**
 * How sure Jev must be that a message continues the current topic, or how unsure that it is a lasting change, by the seller's messages
 * under it: the longer the topic, the less a message may move and still continue it.
 */
export function continuationBars(length: number): { readonly continuing: number; readonly change: number } {
  const { shortTopic, longTopic, shortTopicBar, confident, unlikely } = ROUTING_LIMITS;
  const along = Math.min(1, Math.max(0, (length - shortTopic) / (longTopic - shortTopic)));
  const between = (short: number, long: number) => short * (1 - along) + long * along;
  return { continuing: between(shortTopicBar, confident), change: between(1 - shortTopicBar, unlikely) };
}

/** `timeoutMs` is how long the asker is given before its signal aborts; the router's own second when none is given. */
export async function routeTopic(input: RoutingInput, dependencies: { readonly ask: RoutingAsker; readonly now: () => number; readonly timeoutMs?: number }): Promise<RoutingAdvisory> {
  const start = dependencies.now();
  const envelope = copied(input);
  const baselineDecision = envelope.baselineDecision === "new-topic" || envelope.baselineDecision === "continuation" ? envelope.baselineDecision : null;
  const base = {
    latestUserMessage: filled(envelope.latestUserMessage) ? envelope.latestUserMessage : null,
    baseline: Object.freeze({ decision: baselineDecision }),
    probabilities: null, disagreement: null, titleFlag: null,
  };
  if (!valid(envelope)) return Object.freeze({ ...base, status: "unavailable", reason: "invalid-input", decision: null, requestCount: 0, latencyMs: 0, disclosedFields: Object.freeze([]) });
  const current = envelope.current;
  const state: RoutingState = Object.freeze({
    current: Object.freeze({ ...(current.title === undefined ? {} : { title: current.title }), messages: Object.freeze([...current.messages]) }),
    latestUserMessage: envelope.latestUserMessage,
  });
  const fallback = baselineDecision === "continuation" ? "continue-current" : "create-new";
  const evidence = { ...base, requestCount: 1 as const, disclosedFields: fieldPaths(state) };
  const answers = await askQuestions(state, questionsFor(state), dependencies.ask, dependencies.timeoutMs ?? ROUTING_LIMITS.timeoutMs);
  const latencyMs = Math.max(0, dependencies.now() - start);
  if (typeof answers === "string") return Object.freeze({ ...evidence, status: "unavailable", reason: answers, decision: fallback, latencyMs });
  const continuing = answers.continueCurrent!;
  const bars = continuationBars(envelope.currentLength ?? current.messages.length);
  // An advisory: whether a title is written, by the package as a pi label, is the caller's to decide.
  // A low "lasting change" continues a message only where Jev does not also call it unlikely to continue: Jev reads a one-line question of
  // another kind as a brief tangent, and the tangent then joined, and renamed, the row it left (the office's ruling, 2026-10-20).
  const decision: RoutingDecision = continuing >= bars.continuing || (answers.significantChange! <= bars.change && continuing >= ROUTING_LIMITS.unlikely) ? "continue-current" : "create-new";
  return Object.freeze({
    ...evidence, status: "available", decision, probabilities: answers, latencyMs,
    disagreement: (decision === "continue-current" ? "continuation" : "new-topic") !== baselineDecision,
    titleFlag: answers.titleAdequate === undefined ? null : answers.titleAdequate <= ROUTING_LIMITS.staleTitle,
  });
}
