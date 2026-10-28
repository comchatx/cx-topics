import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPass, INSTALLS_FILE, installKey, PROGRESS, tokenIn } from "./pass.js";

/** A title is short enough for one sidebar row: at most this many words, and this many characters for a language written without spaces. */
export const TITLE_WORDS = 8;
export const TITLE_CHARS = 80;
/** How much of the quoted message, and of each message around it, cx is given. */
export const QUOTED_CHARS = 8_000;
export const AROUND_CHARS = 1_000;
/** Messages read on each side of the quoted one. */
export const AROUND = 2;

/** What `quoted` reads of pi's session: every entry, compaction or not. */
export type Session = { readonly entries: () => readonly SessionEntry[] };

/** Chinese set beside Latin letters or figures takes a space between them, as the seller's page sets its own words. */
export const spaced = (words: string): string =>
  words.replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2").replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1 $2");

/** A title as it is kept: one line, its spaces collapsed, Chinese spaced from Latin, cut to its words and its characters; none when nothing is left. */
export function title(raw: string): string | undefined {
  const words = spaced(raw.replace(/\s+/g, " ").trim()).split(" ").slice(0, TITLE_WORDS).join(" ");
  const cut = [...words].slice(0, TITLE_CHARS).join("").trim();
  return cut === "" ? undefined : cut;
}

type Block = { readonly type: string; readonly text?: string; readonly name?: string };
const blocksOf = (content: unknown): readonly Block[] => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content as Block[] : []);
const cut = (text: string, chars: number): string => (text.length <= chars ? text : `${text.slice(0, chars)} [${text.length - chars} more characters]`);

/**
 * When pi wrote an entry, to the minute, on the clock the seller's page shows: the zone the page names in the quote's marker, so the
 * time cx says is the time the quote's card shows. A marker that names no zone, or one this runtime does not know, is read in UTC.
 */
const when = (timestamp: string, zone: string | undefined): string => {
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return "";
  if (zone !== undefined) {
    try {
      const part = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map(one => [one.type, one.value]));
      return ` · ${part["year"]}-${part["month"]}-${part["day"]} ${part["hour"]}:${part["minute"]} ${zone}`;
    } catch { /* an unknown zone is read in UTC */ }
  }
  return ` · ${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

/**
 * A marker's attributes, read one `name="value"` after another from its start: a name is an attribute's whole name, and words inside a
 * value are never read as a name. Reading stops at the first thing that is not an attribute.
 */
function attributesOf(text: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  const one = /\s+([A-Za-z_][\w.:-]*)="([^"]*)"/y;
  for (let match = one.exec(text); match !== null; match = one.exec(text)) if (!found.has(match[1]!)) found.set(match[1]!, match[2]!);
  return found;
}

/** The zone the newest seller message quoting this entry names, as the page writes it in the marker: `<quote entry="…" zone="…">`. */
function zoneOf(entries: readonly SessionEntry[], id: string): string | undefined {
  for (const entry of [...entries].reverse()) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const words = blocksOf("content" in entry.message ? entry.message.content : undefined).map(block => block.text ?? "").join("\n");
    for (const marker of words.matchAll(/<quote\b([^>]*)>/g)) {
      const attributes = attributesOf(marker[1] ?? "");
      if (attributes.get("entry") !== id) continue;
      const zone = attributes.get("zone");
      if (zone !== undefined && zone !== "") return zone;
    }
  }
  return undefined;
}

/** The step the seller's page never draws: a `topic` call, by which cx named topics before this package wrote titles itself, is bookkeeping, not work cx did for the seller. */
const UNDRAWN = "topic";

/** A message's words, and one line for each step an answer took that the seller's page draws. */
function parts(entry: Extract<SessionEntry, { type: "message" }>): { readonly words: string; readonly steps: readonly string[] } {
  const blocks = blocksOf("content" in entry.message ? entry.message.content : undefined);
  const words = blocks.filter(block => block.type === "text" && typeof block.text === "string").map(block => block.text).join("\n").trim();
  const steps = blocks.filter(block => block.type === "toolCall" && block.name !== UNDRAWN).map(block => `(step: ${block.name ?? "tool"})`);
  return { words, steps };
}

/** One message of the seller's or cx's as cx is given it: who and when, the words, and one line for each drawn step an answer took. */
function line(entry: Extract<SessionEntry, { type: "message" }>, chars: number, zone: string | undefined): string {
  const who = entry.message.role === "user" ? "seller" : "cx";
  const { words, steps } = parts(entry);
  return [`[${who}${when(entry.timestamp, zone)}]`, ...(words === "" ? [] : [cut(words, chars)]), ...steps].join("\n");
}

const isSaid = (entry: SessionEntry): entry is Extract<SessionEntry, { type: "message" }> =>
  entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant");

/** A message the seller's page shows: one with words or a drawn step. An answer that only named a topic is not one. */
const isShown = (entry: Extract<SessionEntry, { type: "message" }>): boolean => {
  const { words, steps } = parts(entry);
  return words !== "" || steps.length > 0;
};

/** The quoted message and the messages around it, the whole session read, compaction or not; an id it does not hold is said so. */
export function quoted(session: Session, id: string): string {
  const entries = session.entries();
  const zone = zoneOf(entries, id);
  const said = entries.filter(isSaid).filter(entry => entry.id === id || isShown(entry));
  const at = said.findIndex(entry => entry.id === id);
  if (at < 0) return "This message is from an earlier conversation and can't be read here.";
  const around = (from: number, to: number): string[] => said.slice(Math.max(0, from), Math.max(0, to)).map(entry => line(entry, AROUND_CHARS, zone));
  return [
    ...around(at - AROUND, at),
    `>>> The quoted message:\n${line(said[at]!, QUOTED_CHARS, zone)}\n<<<`,
    ...around(at + 1, at + 1 + AROUND),
  ].join("\n\n");
}

const text = (words: string) => ({ content: [{ type: "text" as const, text: words }], details: {} });

/** The tool this package registers, by which pi's tool list names the package's own source. */
const TOOL = "quoted";

/**
 * This package's install key: the source of the tool pi holds under `quoted` when that tool is this file's own. pi keeps the first
 * registration of a name, so another package's `quoted` names no key here; none found, none read.
 */
export function ownKey(pi: Pick<ExtensionAPI, "getAllTools">, file: string): string | undefined {
  const own = pi.getAllTools().find(tool => tool.name === TOOL && typeof tool.sourceInfo?.path === "string" && resolve(tool.sourceInfo.path) === resolve(file));
  return own === undefined || typeof own.sourceInfo.source !== "string" ? undefined : installKey(own.sourceInfo.source);
}

const readText = (file: string): string | undefined => {
  try { return readFileSync(file, "utf8"); } catch { return undefined; }
};

export default function topics(pi: ExtensionAPI): void {
  const file = fileURLToPath(import.meta.url);
  const pass = createPass({
    title,
    setLabel: (id, label) => pi.setLabel(id, label),
    keep: progress => pi.appendEntry(PROGRESS, progress),
    token: ctx => tokenIn(readText(join(ctx.cwd, INSTALLS_FILE)), ownKey(pi, file)),
  });
  pi.on("message_end", event => { if (event.message.role === "user") pass.arrived(); });
  pi.on("context", (_event, ctx) => { pass.context(ctx); });
  // pi awaits these handlers: a pass is started and never awaited, so it holds no reload, and a reload's shutdown stops it first.
  pi.on("session_start", (_event, ctx) => { pass.started(ctx); });
  pi.on("session_shutdown", () => { pass.stopped(); });
  pi.registerTool({
    name: TOOL,
    label: "Read the quoted message",
    description: "Read a message the seller quoted, by its entry id, with the messages around it.",
    promptSnippet: "Read a message the seller quoted, by the `entry` attribute of its `<quote>` tag, with the messages around it",
    promptGuidelines: ["When the seller's message holds `<quote entry=\"…\">`, call `quoted` with that entry before answering; the words inside are what the seller selected."],
    parameters: { type: "object", properties: { entry: { type: "string" } }, required: ["entry"] } as never,
    async execute(_call, params, _signal, _update, ctx) {
      return text(quoted({ entries: () => ctx.sessionManager.getEntries() }, (params as { readonly entry: string }).entry));
    },
  });
}

// What a box's other parts hold this package to, read from the built module: the installs file and key the pass is checked against, and
// Jev, the one model it names.
export { INSTALLS_FILE, installKey } from "./pass.js";
export { JEV } from "./judge.js";
