import type { ModelRegistry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { failureOf, STOPPING, type AnswerFailure } from "../core/protocol.js";
import { ROUTING_LIMITS, routeTopic, type RoutingAdvisory, type RoutingAsker, type RoutingInput } from "../core/routing.js";
import { TITLE_SYSTEM, titlePrompt, type TitleRequest } from "../core/titling.js";

/** Jev as pi's catalogue names it. Where it is and with which key is pi's provider configuration, so this package holds neither. */
export const JEV = Object.freeze({ provider: "typesafe", model: "jev-latest" });
/** How long one call is given, as cx-jev-tidy gives its own. */
export const CALL_MS = 20_000;

/** Jev's verdict on one seller message: it continues the topic in progress, its title still naming the work or no longer, or starts new work. */
export type Verdict = { readonly decision: "continue"; readonly stale: boolean } | { readonly decision: "new" };

/** What the judge reads of pi: the branch and its labels, any entry by id, the classifier, and the model the seller is chatting on. */
export type JudgeContext = {
  readonly sessionManager: { getBranch(): SessionEntry[]; getEntry(id: string): SessionEntry | undefined; getLabel(id: string): string | undefined };
  readonly modelRegistry: Pick<ModelRegistry, "findOfType" | "classify" | "streamSimple">;
  readonly model: Parameters<ModelRegistry["streamSimple"]>[0] | undefined;
};

type Said = Extract<SessionEntry, { type: "message" }>;
export const isSellers = (entry: SessionEntry): entry is Said => entry.type === "message" && entry.message.role === "user";
/** A quote the page put in a seller's message: the quoted words are not the seller's own, and History leaves them out too. */
const QUOTE = /<quote\b[^>]*>[\s\S]*?<\/quote>/g;

/** A seller's own words: the message's text, its quotes taken out; never an image. */
export function words(entry: Said): string {
  const content: unknown = "content" in entry.message ? entry.message.content : undefined;
  const text = typeof content === "string" ? content
    : Array.isArray(content) ? content.flatMap(block => (block?.type === "text" && typeof block.text === "string" ? [block.text] : [])).join("\n") : "";
  return text.replace(QUOTE, "").trim();
}

/** The topic in progress before a seller message: the message its title is on, the title, the seller's words in it, and how many messages it holds. */
export type Topic = { readonly start: string; readonly title: string; readonly said: readonly string[]; readonly length: number };

/**
 * The topic the seller message `id` is judged against: the History row it ends, from the latest labelled message of the seller's before it,
 * a later label with an earlier title starting a row of its own, with the seller's words in it, never cx's, since cx's replies come from
 * the seller's messages. Its length is every seller message in the row, one of no words included. None before the first title.
 */
export function topicBefore(branch: readonly SessionEntry[], label: (id: string) => string | undefined, id: string): Topic | undefined {
  const at = branch.findIndex(entry => entry.id === id);
  if (at < 0) return undefined;
  let topic: { start: string; title: string; said: string[]; length: number } | undefined;
  for (const entry of branch.slice(0, at)) {
    if (!isSellers(entry)) continue;
    const named = label(entry.id);
    if (named !== undefined) topic = { start: entry.id, title: named, said: [], length: 0 };
    if (topic === undefined) continue;
    topic.length += 1;
    const text = words(entry);
    if (text !== "") topic.said.push(text);
  }
  return topic && Object.freeze({ ...topic, said: Object.freeze(topic.said) });
}

/** What Jev is shown to judge the seller message `id`: the topic before it, by its title and the newest `ROUTING_LIMITS.sellerMessages` of the seller's words in it. */
export function projection(branch: readonly SessionEntry[], label: (id: string) => string | undefined, id: string): RoutingInput | undefined {
  const latest = branch.find(entry => entry.id === id);
  const topic = latest !== undefined && isSellers(latest) ? topicBefore(branch, label, id) : undefined;
  if (topic === undefined) return undefined;
  return Object.freeze({
    current: Object.freeze({ title: topic.title, messages: Object.freeze(topic.said.slice(-ROUTING_LIMITS.sellerMessages)) }),
    // Without a verdict a message stays in the topic in progress.
    latestUserMessage: words(latest as Said), baselineDecision: "continuation" as const, currentLength: topic.length,
  });
}

/** A verdict only from an answer: an unavailable advisory carries a fallback decision, and it is not one. */
export function verdictOf(advisory: RoutingAdvisory): Verdict | undefined {
  if (advisory.status !== "available") return undefined;
  return Object.freeze(advisory.decision === "continue-current" ? { decision: "continue" as const, stale: advisory.titleFlag === true } : { decision: "new" as const });
}

type ClassifierState = Parameters<ModelRegistry["classify"]>[1]["state"];

/**
 * Asks through pi's classifier with no retry, since a call TypeSafe received is billed even when its answer is lost. Its signal is the
 * router's deadline alone: Stop ends cx's answer, not the filing of the message the seller sent, and a call cut after TypeSafe has it is
 * billed all the same.
 */
export const asker = (ctx: JudgeContext): RoutingAsker => async (state, questions, signal) => {
  const jev = ctx.modelRegistry.findOfType("classifier", JEV.provider, JEV.model);
  if (jev === undefined) return undefined;
  return ctx.modelRegistry.classify(jev, { state: state as unknown as ClassifierState, questions }, { maxRetries: 0, timeoutMs: CALL_MS, signal });
};

/** What the title model gave: a title's raw words, or why there are none. */
export type Titled = { readonly text: string } | { readonly failure: AnswerFailure };

/**
 * A title from the model the seller is chatting on, read from pi at the call, so a model switched since the last title writes the next;
 * through pi's own nested call for whatever the seller can select, which routes a virtual model to the model it picks before the request
 * (`streamSimple`; `complete` refuses one), within `ROUTING_LIMITS.titleMs` and on no other signal, as Jev's call; only an answer pi
 * ends with `stop` is one. Anything else is a failure read as Jev's is (`failureOf`): a refusal, among them a model pi holds no key or sign-in for, a
 * timeout, a cut answer, no model chosen. The package has no model of its own to fall back on.
 */
export const titler = (ctx: JudgeContext) => async (request: TitleRequest): Promise<Titled> => {
  const model = ctx.model;
  if (model === undefined) return { failure: "no-model" };
  try {
    const answer = await ctx.modelRegistry.streamSimple(model, {
      systemPrompt: TITLE_SYSTEM,
      messages: [{ role: "user", content: [{ type: "text", text: titlePrompt(request) }], timestamp: Date.now() }],
    }, { maxTokens: ROUTING_LIMITS.titleTokens, signal: AbortSignal.timeout(ROUTING_LIMITS.titleMs), cacheRetention: "none" }).result();
    if (answer.stopReason !== "stop") return { failure: failureOf(answer as unknown as Record<string, unknown>) };
    return { text: answer.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join(" ") };
  } catch {
    return { failure: "refused" };
  }
};

/**
 * How a seller message's judgment ended: `judged`, whatever it wrote — a verdict acted on, an answer that could not be read, a request
 * refused as it is, a message of no words — or `stopped`, nothing written, on a failure the same request may get past later (`STOPPING`).
 */
export type Outcome = "judged" | "stopped";
const ended = (failure: AnswerFailure | undefined): Outcome => (failure !== undefined && STOPPING.has(failure) ? "stopped" : "judged");

/**
 * The judgment of one seller message, against the titles those before it wrote. Before the first title, and on new work, the seller's
 * model titles the message; on a continuation whose title Jev judged no longer names the work, it rewrites the title on the
 * topic's first message. `title` keeps what it writes as a title is kept; `setLabel` writes it. `live` throws once the judgment's pass is
 * over, so a Jev answer that lands after it buys no title call.
 */
export function createJudge(title: (raw: string) => string | undefined, setLabel: (id: string, label: string) => void, live: () => void = () => {}): (ctx: JudgeContext, id: string) => Promise<Outcome> {
  const labelOf = (ctx: JudgeContext) => (id: string): string | undefined => {
    const raw = ctx.sessionManager.getLabel(id);
    return raw === undefined ? undefined : title(raw);
  };
  /** Writes a title the model gave, on `target`, while the label there is still the one the request was built on. */
  async function name(ctx: JudgeContext, target: string, request: TitleRequest): Promise<Outcome> {
    live();
    const titled = await titler(ctx)(request);
    if ("failure" in titled) return ended(titled.failure);
    const kept = title(titled.text);
    if (kept === undefined || kept === request.title || ctx.sessionManager.getEntry(target) === undefined || labelOf(ctx)(target) !== request.title) return "judged";
    setLabel(target, kept);
    return "judged";
  }
  return async (ctx, id) => {
    const branch = ctx.sessionManager.getBranch();
    const latest = branch.find(entry => entry.id === id);
    if (latest === undefined || !isSellers(latest)) return "judged";
    const said = words(latest);
    const topic = topicBefore(branch, labelOf(ctx), id);
    // Before the first title there is no topic to continue, so Jev is not asked: the message opens one.
    if (topic === undefined) return said === "" ? "judged" : name(ctx, id, { messages: [said] });
    const advisory = await routeTopic(projection(branch, labelOf(ctx), id)!, { ask: asker(ctx), now: Date.now, timeoutMs: CALL_MS });
    const verdict = verdictOf(advisory);
    if (verdict === undefined) return ended(advisory.reason === "invalid-input" ? undefined : advisory.reason);
    if (verdict.decision === "new") return name(ctx, id, { messages: [said] });
    if (verdict.stale) return name(ctx, topic.start, { title: topic.title, messages: [...topic.said, said] });
    return "judged";
  };
}
