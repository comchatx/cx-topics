import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ModelRegistry, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { continuationBars, routeTopic } from "../../src/core/routing.js";
import { createJudge, projection, topicBefore, type JudgeContext } from "../../src/extensions/judge.js";
import { title } from "../../src/extensions/topics.js";
import type { CalibrationCase, Expected } from "./calibration-cases.js";

/** TypeSafe's price for Jev's input, US$ per token, and the platform's margin: the card's *Money* formula, which the ledger books. */
const JEV_USD_PER_TOKEN = 0.042 / 1_000_000;
const MARGIN = 1.3;
const UNITS_PER_USD = 1_000_000;

/** A model as pi's catalogue names it. */
export type Chat = { readonly provider: string; readonly model: string };
/**
 * The model the calibration set was measured on, the platform's default, which a seller chats on until they pick another: the replay's
 * session is on it, so the titles it writes are that model's.
 */
export const CALIBRATED: Chat = Object.freeze({ provider: "balance", model: "minimax/minimax-m3" });

export type Call = { readonly kind: "jev" | "title"; readonly model: string; readonly inputTokens: number; readonly outputTokens: number; readonly usd: number; readonly units: number; readonly failure?: string };
export type Answers = { readonly significantChange?: number; readonly continueCurrent?: number; readonly titleAdequate?: number };
/**
 * Jev's judgment of a message. "continue, rewrite asked" is Jev saying the row's title no longer names its work; whether a new title was
 * written is `titled` (a rewrite that comes back as the same words writes none). A `stale` expectation scores Jev's flag, not the label.
 */
export type Verdict = "given" | "first" | "new" | "continue" | "continue, rewrite asked" | "unavailable";
export type MessageRecord = {
  readonly at: number;
  readonly text: string;
  readonly expect: Expected;
  readonly expectStale?: boolean;
  /** The row the message was judged against: its title and how many seller messages it held. */
  readonly topic?: { readonly title: string; readonly length: number };
  readonly answers?: Answers;
  readonly bars?: { readonly continuing: number; readonly change: number; readonly staleTitle: number };
  readonly verdict: Verdict;
  readonly reason?: string;
  /** What was written: a title, and the message it is on, by its index in the case. */
  readonly titled?: { readonly title: string; readonly on: number; readonly rewrite: boolean; readonly sameLanguage: boolean };
  readonly stopped: boolean;
  readonly calls: readonly Call[];
  /** Whether the verdict is the one the product owner's words want; none for `either`, and none for a call that failed. */
  readonly pass?: boolean;
};
export type CaseRecord = { readonly id: string; readonly source: string; readonly messages: readonly MessageRecord[]; readonly failures: number; readonly otherLanguage: number; readonly usd: number; readonly units: number };

/** Whether a text is written in Chinese, by any CJK character in it: a title should be, exactly when the message it was written on is. */
const chinese = (text: string): boolean => /[\u3400-\u9fff]/.test(text);

/** Thrown before a message is judged once the budget is spent: the replay stops there. The judge swallows what its calls throw, so the check is not inside them. */
export class OverBudget extends Error {}

type Registry = Pick<ModelRegistry, "findOfType" | "classify" | "find" | "streamSimple">;

const failureText = (stopReason: string, errorMessage: unknown) => `${stopReason}${typeof errorMessage === "string" ? `: ${errorMessage.slice(0, 200)}` : ""}`;

/** The registry the judge is given: pi's own, each call's result kept and its cost counted against `budget`. */
function recording(registry: Registry, budget: { spent: number; readonly limit: number }) {
  const calls: Call[] = [];
  let answered: unknown;
  const wrapped: Registry = {
    findOfType: registry.findOfType.bind(registry),
    find: registry.find.bind(registry),
    async classify(model, context, options) {
      const result = await registry.classify(model, context, options);
      answered = result;
      const input = result.usage?.input ?? 0;
      const usd = input * JEV_USD_PER_TOKEN;
      budget.spent += usd;
      calls.push({ kind: "jev", model: `${model.provider}/${model.id}`, inputTokens: input, outputTokens: result.usage?.output ?? 0, usd, units: usd * MARGIN * UNITS_PER_USD, ...(result.stopReason === "stop" ? {} : { failure: failureText(result.stopReason, result.errorMessage) }) });
      return result;
    },
    streamSimple(model, context, options) {
      const stream = registry.streamSimple(model, context, options);
      const result = stream.result.bind(stream);
      return Object.assign(stream, {
        async result() {
          const answer = await result();
          const usd = answer.usage?.cost?.total ?? 0;
          budget.spent += usd;
          calls.push({ kind: "title" as const, model: `${model.provider}/${model.id}`, inputTokens: answer.usage?.input ?? 0, outputTokens: answer.usage?.output ?? 0, usd, units: usd * MARGIN * UNITS_PER_USD, ...(answer.stopReason === "stop" ? {} : { failure: failureText(answer.stopReason, answer.errorMessage) }) });
          return answer;
        },
      });
    },
  };
  return { wrapped, take: () => { const taken = { calls: calls.splice(0), answered }; answered = undefined; return taken; } };
}

const REPLY = Object.freeze({
  role: "assistant" as const, content: [{ type: "text" as const, text: "(cx's reply, which Jev is not shown)" }], api: "openai-completions" as const, provider: "replay", model: "replay",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" as const,
});

/**
 * One case through the package's own judging: each seller message appended to an in-memory pi session and judged by `createJudge` on
 * pi's registry, as the pass judges it, with a reply of cx's after it. A judgment that stops is recorded and the next message goes on,
 * where the pass would ask it again later. The session is on the model `chatOn` names for the message being judged, as pi reports the
 * seller's model at the moment of the call.
 */
export async function replayCase(registry: Registry, item: CalibrationCase, budget: { spent: number; readonly limit: number }, cwd: string, chatOn: (at: number) => Chat = () => CALIBRATED): Promise<CaseRecord> {
  const session = SessionManager.inMemory(cwd);
  const { wrapped, take } = recording(registry, budget);
  const writes: { id: string; label: string }[] = [];
  const judge = createJudge(title, (id, label) => { writes.push({ id, label }); session.appendLabelChange(id, label); });
  let judging = 0;
  const ctx: JudgeContext = { sessionManager: session, modelRegistry: wrapped, get model() { const chat = chatOn(judging); return registry.find(chat.provider, chat.model); } };
  const ids: string[] = [];
  const records: MessageRecord[] = [];
  const labelOf = (id: string) => { const raw = session.getLabel(id); return raw === undefined ? undefined : title(raw); };
  for (const [at, message] of item.messages.entries()) {
    if (budget.spent >= budget.limit) throw new OverBudget(`spent US$${budget.spent.toFixed(4)} of US$${budget.limit}`);
    const id = session.appendMessage({ role: "user", content: [{ type: "text", text: message.text }], timestamp: Date.now() });
    ids.push(id);
    if (message.given !== undefined) {
      if (message.given.label !== undefined) session.appendLabelChange(id, message.given.label);
      records.push(Object.freeze({ at, text: message.text, expect: message.expect, verdict: "given" as const, stopped: false, calls: [] }));
      session.appendMessage({ ...REPLY, timestamp: Date.now() });
      continue;
    }
    const branch = session.getBranch();
    const topic = topicBefore(branch, labelOf, id);
    const input = projection(branch, labelOf, id);
    const written = writes.length;
    judging = at;
    const outcome = await judge(ctx, id);
    const { calls, answered } = take();
    const titled = writes.slice(written).at(-1);
    let answers: Answers | undefined;
    let verdict: Verdict;
    let reason: string | undefined;
    if (topic === undefined) verdict = "first";
    else {
      const advisory = await routeTopic(input!, { ask: async () => answered, now: () => 0 });
      if (advisory.status === "available") {
        answers = advisory.probabilities as Answers;
        verdict = advisory.decision === "create-new" ? "new" : advisory.titleFlag === true ? "continue, rewrite asked" : "continue";
      } else {
        verdict = "unavailable";
        reason = advisory.reason;
      }
    }
    const failed = calls.find(call => call.failure !== undefined);
    if (reason === undefined && failed !== undefined) reason = failed.failure;
    const judged = verdict === "first" ? undefined : verdict === "unavailable" ? undefined : verdict === "new" ? "new" : "continue";
    const pass = judged === undefined || message.expect === "either" ? undefined
      : judged !== message.expect ? false
      : judged === "continue" && message.stale !== undefined ? (verdict === "continue, rewrite asked") === message.stale : true;
    records.push(Object.freeze({
      at, text: message.text, expect: message.expect, ...(message.stale === undefined ? {} : { expectStale: message.stale }),
      ...(topic === undefined ? {} : { topic: { title: topic.title, length: topic.length }, bars: { ...continuationBars(topic.length), staleTitle: 0.2 } }),
      ...(answers === undefined ? {} : { answers }), verdict, ...(reason === undefined ? {} : { reason }),
      ...(titled === undefined ? {} : { titled: { title: titled.label, on: ids.indexOf(titled.id), rewrite: titled.id !== id, sameLanguage: chinese(titled.label) === chinese(message.text) } }),
      stopped: outcome === "stopped", calls, ...(pass === undefined ? {} : { pass }),
    }));
    session.appendMessage({ ...REPLY, timestamp: Date.now() });
  }
  const all = records.flatMap(record => record.calls);
  return Object.freeze({
    id: item.id, source: item.source, messages: Object.freeze(records),
    failures: records.filter(record => record.pass === false).length,
    otherLanguage: records.filter(record => record.titled?.sameLanguage === false).length,
    usd: all.reduce((sum, call) => sum + call.usd, 0), units: all.reduce((sum, call) => sum + call.units, 0),
  });
}

/** Every case in order, within one budget; a case the budget stops is not recorded, and the rest are not run. */
export async function replay(registry: Registry, cases: readonly CalibrationCase[], limitUsd: number, cwd: string): Promise<{ readonly cases: readonly CaseRecord[]; readonly stoppedBy?: string }> {
  const budget = { spent: 0, limit: limitUsd };
  const done: CaseRecord[] = [];
  for (const item of cases) {
    try { done.push(await replayCase(registry, item, budget, cwd)); } catch (error) {
      if (error instanceof OverBudget) return { cases: done, stoppedBy: `${item.id}: ${error.message}` };
      throw error;
    }
  }
  return { cases: done };
}

const pct = (value: number | undefined) => (value === undefined ? "—" : value.toFixed(2));
const mark = (record: MessageRecord) => (record.pass === undefined ? (record.verdict === "first" || record.verdict === "given" ? "" : record.expect === "either" ? "either" : "no verdict") : record.pass ? "ok" : "FAIL");
const shown = (text: string) => { const flat = text.replace(/\s+/g, " "); return flat.length <= 60 ? flat : `${flat.slice(0, 40)}… [${flat.length} chars] …${flat.slice(-16)}`; };

/** The replay as a table per case, for the stop report and the merge request. */
export function sheet(result: { readonly cases: readonly CaseRecord[]; readonly stoppedBy?: string }): string {
  const lines: string[] = [];
  for (const item of result.cases) {
    lines.push(`### ${item.id}`, "", item.source, "", "| # | message | wants | row before (length) | sig / cont / title | bars cont / change | verdict | title written | result |", "|---|---|---|---|---|---|---|---|---|");
    for (const record of item.messages) {
      const answers = record.answers === undefined ? "—" : `${pct(record.answers.significantChange)} / ${pct(record.answers.continueCurrent)} / ${pct(record.answers.titleAdequate)}`;
      const bars = record.bars === undefined ? "—" : `${pct(record.bars.continuing)} / ${pct(record.bars.change)}`;
      const wants = record.expect === "continue" && record.expectStale !== undefined ? `continue, ${record.expectStale ? "rewrite" : "title stands"}` : record.expect;
      const titled = record.titled === undefined ? (record.verdict === "continue, rewrite asked" ? "— (none written)" : "—") : `${record.titled.rewrite ? "rewrite on" : "on"} #${record.titled.on}: ${record.titled.title}${record.titled.sameLanguage ? "" : " (other language)"}`;
      lines.push(`| ${record.at} | ${shown(record.text)} | ${wants} | ${record.topic === undefined ? "—" : `${record.topic.title} (${record.topic.length})`} | ${answers} | ${bars} | ${record.verdict}${record.reason === undefined ? "" : ` (${record.reason})`} | ${titled} | ${mark(record)} |`);
    }
    lines.push("", `Failures: ${item.failures}. Titles in another language than their message: ${item.otherLanguage}. Cost: US$${item.usd.toFixed(5)}, ${Math.round(item.units)} units at the ledger's rates.`, "");
  }
  const failures = result.cases.reduce((sum, item) => sum + item.failures, 0);
  const usd = result.cases.reduce((sum, item) => sum + item.usd, 0);
  const otherLanguage = result.cases.reduce((sum, item) => sum + item.otherLanguage, 0);
  lines.push(`**All cases: ${failures} failures; ${otherLanguage} titles in another language; US$${usd.toFixed(4)}.**${result.stoppedBy === undefined ? "" : ` Stopped by the budget at ${result.stoppedBy}.`}`);
  return lines.join("\n");
}

/** Where the replay sends Jev's and the session model's calls: TypeSafe and OpenRouter themselves, or a stand-in's loopback. */
export type Upstreams = { readonly typesafe: string; readonly openrouter: string };
export const LIVE: Upstreams = Object.freeze({ typesafe: "https://api.typesafe.ai/v1", openrouter: "https://openrouter.ai/api/v1" });

type ProviderEntry = { baseUrl?: string; apiKey?: string; models?: { id: string; baseUrl?: string }[]; [key: string]: unknown };

/**
 * The image's own `typesafe` entry and the provider entry of the models the session chats on (`balance`, the platform's OpenRouter),
 * those models alone kept, sent to `upstreams` on the keys pi reads from the environment by name: the requests are the box's, with no
 * proxy between.
 */
export function modelsFor(image: { readonly providers: Readonly<Record<string, ProviderEntry>> }, upstreams: Upstreams, chat: readonly Chat[]): { providers: Record<string, ProviderEntry> } {
  const typesafe = image.providers.typesafe!;
  const providers: Record<string, ProviderEntry> = { typesafe: { ...typesafe, baseUrl: upstreams.typesafe, apiKey: "${CMX_KEY_TYPESAFE}" } };
  for (const provider of new Set(chat.map(one => one.provider))) {
    const entry = image.providers[provider]!;
    const kept = new Set(chat.filter(one => one.provider === provider).map(one => one.model));
    providers[provider] = {
      ...entry, baseUrl: upstreams.openrouter, apiKey: "${CMX_KEY_OPENROUTER}",
      models: (entry.models ?? []).filter(model => kept.has(model.id)).map(model => ({ ...model, baseUrl: upstreams.openrouter })),
    };
  }
  return { providers };
}

/** The two keys by name from an env file's lines, never any other line, a `Bearer ` before a key dropped since pi writes its own; nothing is echoed. */
export function keysIn(text: string): { readonly CMX_KEY_TYPESAFE?: string; readonly CMX_KEY_OPENROUTER?: string } {
  const found: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?(CMX_KEY_TYPESAFE|CMX_KEY_OPENROUTER)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null) continue;
    const value = match[2]!.replace(/^(['"])(.*)\1$/, "$2").replace(/^Bearer\s+/i, "");
    if (value !== "") found[match[1]!] = value;
  }
  return found;
}

/** pi's registry on `modelsFor`'s entries, written under `dir` with an empty login file there: no file of the machine's is read. */
export async function registryFor(image: Parameters<typeof modelsFor>[0], upstreams: Upstreams, dir: string, chat: readonly Chat[] = [CALIBRATED]): Promise<ModelRegistry> {
  const modelsPath = join(dir, "models.json");
  writeFileSync(modelsPath, JSON.stringify(modelsFor(image, upstreams, chat)));
  return new ModelRegistry(await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath, refreshOnCreate: false, allowModelNetwork: false }));
}
