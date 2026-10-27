export type Question = { readonly type: "bool"; readonly instructions: string; readonly criteria: { readonly true: string; readonly false: string } };
export type Questions = Readonly<Record<string, Question>>;
/** Asks the questions about the state; what it hands back is read as pi's `ClassifierResult`. */
export type QuestionAsker<State> = (state: State, questions: Questions, signal: AbortSignal) => Promise<unknown>;
/**
 * Why a call gave no answer. `malformed` and `missing-answers` are calls answered and billed whose answer cannot be read; `rejected` a
 * request the service refused as it is, which it refuses the same way each time it is sent. `refused` is a call refused for a reason
 * outside the request — the account, the platform's gate, a busy or failing service, or a status that cannot be read — `timeout` one cut
 * or not answered in time, and `no-model` one pi has no such model for: each of these may be served once what stood in its way is fixed.
 */
export type AnswerFailure = "refused" | "rejected" | "timeout" | "malformed" | "missing-answers" | "no-model";
/** The failures after which the same request may be served: a pass stops at the message, and asks again later. */
export const STOPPING: ReadonlySet<string> = new Set<AnswerFailure>(["refused", "timeout", "no-model"]);
export class ReviewFailure extends Error {
  constructor(readonly kind: "refused" | "timeout") { super(kind); }
}

export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const bounded = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max * 2 && value.trim() !== "" && [...value].length <= max;
export const validTitle = (value: unknown): value is string => bounded(value, 80) && !/[\r\n]/.test(value) && value.trim().split(/\s+/).length <= 8;
// Each allowed field is read once into a fresh object, so a getter cannot pass validation and then hand over something else.
export const pick = (value: unknown, keys: readonly string[]): Record<string, unknown> | undefined => record(value) ? Object.fromEntries(keys.map(key => [key, value[key]])) : undefined;
export function list<T>(value: unknown, max: number, copy: (item: unknown) => T): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const length = value.length;
  if (length > max) return undefined;
  const items: T[] = [];
  for (let i = 0; i < length; i++) items.push(copy(value[i]));
  return items;
}
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

/** What the classifier gave: the answers, or why there are none. Nothing at all is a model pi does not have. */
export function parseAnswers(raw: unknown, questions: Questions): Readonly<Record<string, number>> | AnswerFailure {
  if (raw === undefined) return "no-model";
  if (!record(raw)) return "malformed";
  // Anything but an answer is a failure, whatever pi names it: its own timeout reads "error", a cancelled call "aborted".
  if (raw.stopReason !== "stop") return failureOf(raw);
  if (!record(raw.answers)) return "malformed";
  const answers: Record<string, number> = {};
  for (const key of Object.keys(questions)) {
    if (!Object.hasOwn(raw.answers, key)) return "missing-answers";
    const answer = raw.answers[key];
    // pi checks that a probability is a finite number, not that it lies in [0, 1].
    if (!record(answer) || answer.type !== "bool" || typeof answer.probability !== "number" || !Number.isFinite(answer.probability)
      || answer.probability < 0 || answer.probability > 1) return "malformed";
    answers[key] = answer.probability;
  }
  return Object.freeze(answers);
}

export async function askQuestions<State>(state: State, questions: Questions, ask: QuestionAsker<State>, timeoutMs: number): Promise<Readonly<Record<string, number>> | AnswerFailure> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new ReviewFailure("timeout")); controller.abort(); }, timeoutMs);
    });
    const raw = await Promise.race([ask(state, questions, controller.signal), deadline]);
    try { return parseAnswers(raw, questions); } catch { return "malformed"; }
  } catch (error) {
    // Only the kind is kept, and only a known one, so an upstream error's text never reaches the advisory.
    return error instanceof ReviewFailure && error.kind === "timeout" ? "timeout" : "refused";
  } finally {
    clearTimeout(timer);
  }
}
