import type { AnswerFailure, JevAnswer, Questions } from "@comchatx/typesafe";

// The questions, the answer and why a call gave none are Jev's client's, in `@comchatx/typesafe`.
export type { AnswerFailure, Question, Questions } from "@comchatx/typesafe";
/** Asks the questions about the state: Jev's answer, or why there is none, within the asker's own deadline. */
export type QuestionAsker<State> = (state: State, questions: Questions) => Promise<JevAnswer>;
/** The failures after which the same request may be served: a pass stops at the message, and asks again later. */
export const STOPPING: ReadonlySet<string> = new Set<AnswerFailure>(["refused", "timeout", "no-model"]);

export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
/** The platform's own refusals, each named in the body it answers: an account served no model, or a sign-in or key that ended. */
const GATE_CODES = /\b(membership_required|debt_owed|model_not_served|sign_in_again)\b/;
/**
 * The HTTP status pi writes at the head of a failed call's text: `403 …` or `403: …` for a chat model's call, read first, and
 * `<label> error (403): …` for a classifier, a label holding no quote, brace or colon. A failure with no leading status whose words open
 * like such a label, `upstream error (400): …` over a streamed 200, is read by that number.
 */
const statusOf = (message: string): number | undefined => {
  const found = /^(\d{3})\b/.exec(message) ?? /^[^()\n{}":]* error \((\d{3})\)(?::|$)/.exec(message);
  return found === null ? undefined : Number(found[1]);
};
/** A service reports usage only for a call it answered, and a classifier's or a chat model's answer is billed on it. */
const billed = (usage: unknown): boolean =>
  record(usage) && ["input", "output", "totalTokens"].some(key => typeof usage[key] === "number" && (usage[key] as number) > 0);

/**
 * Why a call pi did not end with `stop` gave nothing, from what pi kept of it; none of its text leaves here. A call cut or timed out is
 * `timeout`; one answered — ended at its token cap, or carrying usage — is `malformed`; a request refused as it is — 400, 413, 422, or a
 * 403 that names none of the platform's refusals — is `rejected`; anything else, a status unread among them, is `refused`.
 */
export function failureOf(raw: Readonly<Record<string, unknown>>): AnswerFailure {
  if (raw.stopReason === "aborted") return "timeout";
  if (raw.stopReason === "length" || raw.stopReason === "toolUse" || billed(raw.usage)) return "malformed";
  const message = typeof raw.errorMessage === "string" ? raw.errorMessage : "";
  if (/timed out/i.test(message)) return "timeout";
  const status = statusOf(message);
  return status === 400 || status === 413 || status === 422 || (status === 403 && !GATE_CODES.test(message)) ? "rejected" : "refused";
}
