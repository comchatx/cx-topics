import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import { JEV } from "../../src/extensions/judge.js";
import type { PassContext } from "../../src/extensions/pass.js";

let clock = 0;
export const base = (id: string) => ({ id, parentId: null, timestamp: new Date(Date.UTC(2026, 9, 15) + (clock += 60_000)).toISOString() });
export const said = (id: string, text: string): SessionEntry => ({ ...base(id), type: "message", message: { role: "user", content: [{ type: "text", text }], timestamp: clock } }) as SessionEntry;
export const answered = (id: string, text: string, steps: readonly string[] = []): SessionEntry =>
  ({ ...base(id), type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "invented private reasoning" }, ...steps.map(name => ({ type: "toolCall", id: name, name, arguments: { secret: "invented tool arguments" } })), { type: "text", text }], stopReason: "stop" } }) as unknown as SessionEntry;
export const others = (id: string): SessionEntry[] => [
  { ...base(`${id}-system`), type: "message", message: { role: "system", content: "invented system prompt", timestamp: clock } },
  { ...base(`${id}-result`), type: "message", message: { role: "toolResult", toolCallId: "x", toolName: "bash", content: [{ type: "text", text: "invented tool result" }], isError: false, timestamp: clock } },
  { ...base(`${id}-custom`), type: "message", message: { role: "custom", customType: "invented", content: "invented custom message", display: true, timestamp: clock } },
  { ...base(`${id}-bash`), type: "message", message: { role: "bashExecution", command: "invented command", output: "invented bash output", timestamp: clock } },
  { ...base(`${id}-entry`), type: "custom", customType: "invented", data: { text: "invented custom entry" } },
  { ...base(`${id}-image`), type: "message", message: { role: "user", content: [{ type: "image", data: "aW52ZW50ZWQ=", mimeType: "image/png" }], timestamp: clock } },
] as unknown as SessionEntry[];

/** BE3600, then Walmart, then the message to judge: two titled History rows, the latest of them the topic in progress. */
export const conversation = (): SessionEntry[] => [
  said("u0", "invented greeting before any title"), answered("a0", "invented hello"),
  said("u1", "Analyse the invented BE3600 positioning."), answered("a1", "Invented BE3600 notes."),
  ...others("x1"),
  said("u2", "Now plan the invented Walmart inventory."), answered("a2", "Invented stock plan.", ["bash"]),
  said("u3", "Add a reorder point to the plan. <quote entry=\"a2\" at=\"1\">Invented stock plan.</quote>"),
];
export const LABELS: Readonly<Record<string, string>> = { u1: "BE3600 analysis", u2: "Walmart inventory" };

export type Asked = { readonly state: Record<string, unknown>; readonly questions: Record<string, unknown>; readonly options: Record<string, unknown> };
export type Titled = { readonly context: { systemPrompt: string; messages: { content: { text: string }[] }[] }; readonly options: Record<string, unknown> };
/**
 * pi as the judge reads it: the branch and labels, a classifier that answers each question as `answer` says, and the model the seller
 * is chatting on, which answers with the titles `titles` gives in turn.
 */
export function context(entries: SessionEntry[], answer: (question: string) => number, labels: Record<string, string> = { ...LABELS }, titles: string[] = ["Reorder point"]) {
  const asked: Asked[] = [];
  const titled: Titled[] = [];
  const jev = { id: JEV.model, provider: JEV.provider };
  const model = { id: "invented-chat-model", provider: "invented-provider" };
  let reply = async (questions: Record<string, unknown>): Promise<unknown> => ({
    api: "typesafe-system-one", provider: "typesafe", model: "jev-latest", stopReason: "stop", timestamp: 1,
    answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: "bool", probability: answer(key) }])),
  });
  let write = async (): Promise<unknown> => ({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: titles.shift() ?? "Untitled" }] });
  const ctx = {
    cwd: "/invented/tenant",
    sessionManager: { getEntries: () => entries, getBranch: () => entries, getEntry: (id: string) => entries.find(entry => entry.id === id), getLabel: (id: string) => labels[id] },
    modelRegistry: {
      findOfType: vi.fn((..._args: unknown[]) => jev),
      classify: vi.fn(async (_model: unknown, request: { state: Record<string, unknown>; questions: Record<string, unknown> }, options: Record<string, unknown>) => {
        asked.push({ state: request.state, questions: request.questions, options });
        return reply(request.questions);
      }),
      streamSimple: vi.fn((_model: unknown, request: Titled["context"], options: Record<string, unknown>) => {
        titled.push({ context: request, options });
        return { result: write };
      }),
    },
    model: model as { readonly id: string; readonly provider: string } | undefined,
  };
  return {
    ctx: ctx as unknown as PassContext, raw: ctx, asked, titled, labels, entries, jev, model,
    answerWith: (next: typeof reply) => { reply = next; }, titleWith: (next: typeof write) => { write = next; },
  };
}
export const continuing = (key: string) => (key === "continueCurrent" ? 0.95 : 0.9);
export const stale = (key: string) => (key === "continueCurrent" ? 0.95 : key === "titleAdequate" ? 0.1 : 0.9);
export const separate = (key: string) => (key === "continueCurrent" ? 0.05 : 0.9);
