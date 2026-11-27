import type { AnswerFailure, Question, QuestionAsker, Questions } from "./protocol.js";

export const ROUTING_LIMITS = Object.freeze({
  // A seller message over 512 code points, and the latest over 2,048, keeps its head and tail (`cut`).
  messageChars: 512, latestChars: 2048,
  // The newest 31 of a topic's seller messages are shown, as many as kept a full request in Chinese text within the size of a full one when
  // Jev was also shown cx's words and three earlier topics (56,355 bytes): where a topic now stands is in its newest messages, and its title
  // says where it began. The topic's length still counts every one. The bounds are code points, so the largest request is of characters
  // JSON writes in six bytes, 109,260 bytes.
  sellerMessages: 31,
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
export type RoutingDecision = "continue-current" | "create-new";
/** The topic in progress: its title, and the seller's own messages under it, oldest first; never cx's. */
export type TopicProjection = { readonly title?: string; readonly messages: readonly string[] };
/** The topic and the seller's latest message, as the judge builds them: words of the seller's only, none empty. */
export type RoutingInput = {
  readonly current: TopicProjection;
  readonly latestUserMessage: string;
  /** The seller's messages under the current title, before the projection keeps its newest; those the projection shows when not given. */
  readonly currentLength?: number;
};
export type RoutingState = { readonly current: TopicProjection; readonly latestUserMessage: string };
export type RoutingAsker = QuestionAsker<RoutingState>;
/** Jev's verdict, or why there is none. `titleFlag`: the current title no longer names the topic's work; null when no title was asked about. */
export type RoutingAdvisory =
  | { readonly status: "available"; readonly decision: RoutingDecision; readonly titleFlag: boolean | null }
  | { readonly status: "unavailable"; readonly reason: AnswerFailure };

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
const question = (instructions: string, yes: string, no: string): Question => Object.freeze({ type: "bool", instructions, criteria: Object.freeze({ true: yes, false: no }) });

function questionsFor(state: RoutingState): Questions {
  return Object.freeze({
    significantChange: question("Does state.latestUserMessage request lasting separate work rather than a brief tangent or correction to state.current?", "Lasting separate work", "A brief tangent or a correction"),
    // The same task on another product sits between the two answers, so a topic's length can decide it; another kind of task does not.
    continueCurrent: question("Does state.latestUserMessage intend to continue or correct the work in state.current, its title and the seller's messages so far, rather than start separate work? The same task on another product continues it less surely than the same product; another kind of task does not continue it. Judge intent, not shared product words.", "Continues or corrects the work", "Starts another kind of work"),
    ...(state.current.title === undefined ? {} : { titleAdequate: question("Does state.current.title still name the work in state.current, the seller's messages so far, together with state.latestUserMessage? A title that names where the work began but not where it has gone does not.", "Still names the work", "No longer names the work") }),
  });
}
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

/** Jev asked once about the latest message against the topic in progress, each message cut to its bound; a failure is said, not decided. */
export async function routeTopic(input: RoutingInput, dependencies: { readonly ask: RoutingAsker }): Promise<RoutingAdvisory> {
  const { title } = input.current;
  const state: RoutingState = Object.freeze({
    current: Object.freeze({ ...(title === undefined ? {} : { title }), messages: Object.freeze(input.current.messages.map(text => cut(text, ROUTING_LIMITS.messageChars))) }),
    latestUserMessage: cut(input.latestUserMessage, ROUTING_LIMITS.latestChars),
  });
  const answer = await dependencies.ask(state, questionsFor(state));
  if ("failure" in answer) return Object.freeze({ status: "unavailable", reason: answer.failure });
  const answers = answer.answers;
  const continuing = answers.continueCurrent!;
  const bars = continuationBars(input.currentLength ?? input.current.messages.length);
  // A low "lasting change" continues a message only where Jev does not also call it unlikely to continue: Jev reads a one-line question of
  // another kind as a brief tangent, and the tangent then joined, and renamed, the row it left (the office's ruling, 2026-10-20).
  const decision: RoutingDecision = continuing >= bars.continuing || (answers.significantChange! <= bars.change && continuing >= ROUTING_LIMITS.unlikely) ? "continue-current" : "create-new";
  return Object.freeze({ status: "available", decision, titleFlag: answers.titleAdequate === undefined ? null : answers.titleAdequate <= ROUTING_LIMITS.staleTitle });
}
