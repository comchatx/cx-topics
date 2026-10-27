import { cut, ROUTING_LIMITS } from "./routing.js";

/** What the title model is told: the title is the seller's, in the seller's words and language, at most eight words, and nothing else. */
export const TITLE_SYSTEM = [
  "You write the title of one topic in a seller's History: the piece of work the seller's messages ask for.",
  "The title is for the seller, who reads it to find this work again: name the work in the seller's own words, as they would write it.",
  "Write at most eight words, in the language the seller writes in, such as \"Competitor price history\" or \"瑜伽垫 listing 新标题\".",
  "Reply with the title alone: no quotes, no punctuation at its end, no explanation.",
].join("\n");

/**
 * The language the title is written in, read by code from the seller's newest message: Chinese for any Han character, English for a
 * message of ASCII alone, and otherwise the message's own. Asked only in words, the title model wrote Chinese titles
 * for English messages (the office's ruling, 2026-10-20).
 */
export function titleLanguage(newest: string): string {
  if (/\p{Script=Han}/u.test(newest)) return "Write the title in Chinese.";
  if (/^[\x00-\x7f]*$/.test(newest)) return "Write the title in English.";
  return "Write the title in the language of the last [seller] line.";
}

/** A topic to title: the seller's own messages in it, oldest first, the latest last, and, for a rewrite, the title it has now. */
export type TitleRequest = { readonly title?: string; readonly messages: readonly string[] };

/**
 * The words the title model is shown: the seller's messages as Jev is shown them, the newest `sellerMessages`, each cut to `messageChars`
 * and the latest to `latestChars`; none of cx's. A rewrite also shows the title it replaces. It ends with the language to write in.
 */
export function titlePrompt(request: TitleRequest): string {
  const { sellerMessages, messageChars, latestChars } = ROUTING_LIMITS;
  const shown = request.messages.slice(-sellerMessages);
  const lines = shown.map((text, at) => `[seller] ${cut(text, at === shown.length - 1 ? latestChars : messageChars)}`);
  return [
    ...(request.title === undefined ? ["Title this new topic from the seller's message."] : [`The topic is titled "${request.title}", which no longer names its work. Write a title that names the work as it stands now.`]),
    "",
    ...lines,
    "",
    titleLanguage(shown.at(-1) ?? ""),
  ].join("\n");
}
