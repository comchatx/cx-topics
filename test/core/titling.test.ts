import { expect, it } from "vitest";
import { ROUTING_LIMITS } from "../../src/core/routing.js";
import { TITLE_SYSTEM, titleLanguage, titlePrompt } from "../../src/core/titling.js";

it("tells the title model the title is the seller's, in their words and language, of at most eight words, and nothing else", () => {
  expect(TITLE_SYSTEM).toBe([
    "You write the title of one topic in a seller's History: the piece of work the seller's messages ask for.",
    "The title is for the seller, who reads it to find this work again: name the work in the seller's own words, as they would write it.",
    "Write at most eight words, in the language the seller writes in, such as \"Competitor price history\" or \"瑜伽垫 listing 新标题\".",
    "Reply with the title alone: no quotes, no punctuation at its end, no explanation.",
  ].join("\n"));
});

it("shows a new topic's message alone, and a rewrite the title it replaces and the seller's messages so far", () => {
  expect(titlePrompt({ messages: ["优化虚构的 XXX 瑜伽垫的 listing。"] })).toBe("Title this new topic from the seller's message.\n\n[seller] 优化虚构的 XXX 瑜伽垫的 listing。\n\nWrite the title in Chinese.");
  expect(titlePrompt({ title: "Walmart inventory", messages: ["Plan the invented Walmart stock.", "Add a reorder point."] })).toBe([
    "The topic is titled \"Walmart inventory\", which no longer names its work. Write a title that names the work as it stands now.",
    "",
    "[seller] Plan the invented Walmart stock.",
    "[seller] Add a reorder point.",
    "",
    "Write the title in English.",
  ].join("\n"));
});

it("shows the newest 31 of the seller's messages, each cut as Jev is shown it, the latest at 2,048 and the others at 512", () => {
  const messages = [...Array.from({ length: 40 }, (_, i) => `${i} ${"品".repeat(600)}`), `latest ${"船".repeat(3000)}`];
  const shown = titlePrompt({ title: "Invented", messages }).replace(/\n\nWrite the title in Chinese\.$/, "").split("[seller] ").slice(1).map(line => line.replace(/\n$/, ""));
  expect(shown).toHaveLength(ROUTING_LIMITS.sellerMessages);
  expect(shown[0]!.startsWith(`${41 - ROUTING_LIMITS.sellerMessages} `)).toBe(true);
  // A cut keeps head and tail around its marker, at most the limit in all.
  for (const [line, max] of [[shown[0]!, ROUTING_LIMITS.messageChars], [shown.at(-1)!, ROUTING_LIMITS.latestChars]] as const) {
    expect([...line].length).toBeLessThanOrEqual(max);
    expect([...line].length).toBeGreaterThan(max - 4);
    expect(line).toMatch(/\n\[… \d+ characters omitted …\]\n/);
  }
  expect(shown.at(-1)!.startsWith("latest ")).toBe(true);
});

it("names the title's language from the seller's newest message: Chinese for a Han character, English for ASCII alone, else the message's own", () => {
  // English messages were titled in Chinese when the language was asked for in words alone.
  expect(titleLanguage("Plan 60 days of stock for the yoga mats.")).toBe("Write the title in English.");
  expect(titleLanguage("")).toBe("Write the title in English.");
  // Typographic quotes are not ASCII: a message holding them is told to follow its own language, as any other non-ASCII one is.
  for (const quoted of ["Write the \u201cBE3600\u201d copy, it\u2019s due.", "\u201cBonjour\u201d", "\u2018Hola\u2019", "\u201c\u201d"]) expect(titleLanguage(quoted)).toBe("Write the title in the language of the last [seller] line.");
  expect(titleLanguage("Plan the 瑜伽垫 stock.")).toBe("Write the title in Chinese.");
  expect(titleLanguage("帮我看一下 B0CX1234。")).toBe("Write the title in Chinese.");
  expect(titleLanguage("Planifica el stock de esterillas, por favor — señor.")).toBe("Write the title in the language of the last [seller] line.");
  expect(titleLanguage("ヨガマットのストック")).toBe("Write the title in the language of the last [seller] line.");
  // The latest message decides, not the earlier ones a rewrite shows.
  expect(titlePrompt({ title: "瑜伽垫补货", messages: ["瑜伽垫补货检查。", "Now in English, please."] }).endsWith("\n\nWrite the title in English.")).toBe(true);
});
