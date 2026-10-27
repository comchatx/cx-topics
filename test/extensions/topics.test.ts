import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { AROUND_CHARS, quoted, title, type Session } from "../../src/extensions/topics.js";

let clock = Date.UTC(2026, 8, 30, 10, 12);
const base = (id: string) => ({ id, parentId: null, timestamp: new Date(clock += 60_000).toISOString() });
const said = (id: string, text: string): SessionEntry => ({ ...base(id), type: "message", message: { role: "user", content: [{ type: "text", text }], timestamp: clock } }) as SessionEntry;
const answered = (id: string, text: string, steps: readonly string[] = []): SessionEntry =>
  ({ ...base(id), type: "message", message: { role: "assistant", content: [...steps.map(name => ({ type: "toolCall", id: name, name, arguments: {} })), { type: "text", text }], stopReason: steps.length > 0 ? "toolUse" : "stop" } }) as unknown as SessionEntry;
const result = (id: string): SessionEntry => ({ ...base(id), type: "message", message: { role: "toolResult", toolCallId: "x", toolName: "x", content: [{ type: "text", text: "raw" }], isError: false, timestamp: clock } }) as SessionEntry;

/** A session as pi keeps it: entries in order. */
const session = (entries: SessionEntry[]): Session => ({ entries: () => entries });

it("keeps a title to one line of at most eight words and eighty characters, and none of only spaces", () => {
  expect(title("  Price   history\nof B0EXAMPLE2  ")).toBe("Price history of B0EXAMPLE2");
  expect(title("one two three four five six seven eight nine ten")).toBe("one two three four five six seven eight");
  expect(title("竞".repeat(90))).toHaveLength(80);
  expect(title(" \n ")).toBeUndefined();
});

it("spaces Chinese from Latin letters and figures in a title, as the seller's page sets its words", () => {
  expect(title("瑜伽垫listing新标题")).toBe("瑜伽垫 listing 新标题");
  expect(title("Q4广告关键词")).toBe("Q4 广告关键词");
  expect(title("十月Prime大促的备货")).toBe("十月 Prime 大促的备货");
  expect(title("Buy Box 被抢走")).toBe("Buy Box 被抢走");
});

it("reads a quoted message with two messages on each side, who and when, an answer's steps as one line each, and no tool result", () => {
  clock = Date.UTC(2026, 8, 30, 10, 12);
  const one = session([said("u1", "first"), answered("a1", "one"), said("u2", "price?"), answered("a2", "It was 32.99 on Sunday.", ["keepa"]), result("r2"), said("u3", "and now?"), answered("a3", "33.49"), said("u4", "last")]);
  expect(quoted(one, "a2")).toBe([
    "[cx · 2026-09-30 10:14 UTC]\none",
    "[seller · 2026-09-30 10:15 UTC]\nprice?",
    ">>> The quoted message:\n[cx · 2026-09-30 10:16 UTC]\nIt was 32.99 on Sunday.\n(step: keepa)\n<<<",
    "[seller · 2026-09-30 10:18 UTC]\nand now?",
    "[cx · 2026-09-30 10:19 UTC]\n33.49",
  ].join("\n\n"));
  expect(quoted(one, "u1").startsWith(">>> The quoted message:\n[seller")).toBe(true);
  expect(quoted(one, "r2")).toBe("This message is from an earlier conversation and can't be read here.");
  expect(quoted(one, "gone")).toBe("This message is from an earlier conversation and can't be read here.");
});

it("says when on the clock the seller's page shows, the zone the newest marker quoting the message names, and UTC where none names a zone it knows", () => {
  const asked = (marker: string): Session => (clock = Date.UTC(2026, 9, 19, 17, 40), session([said("u1", "Stock is 412."), answered("a1", "Noted."), said("u2", `${marker}Will this cover October?`)]));
  // 17:42 UTC on 19 October is 01:42 on 20 October in Shanghai, the time the quote's card showed there.
  expect(quoted(asked('<quote entry="u1" at="e:1" zone="Asia/Shanghai">Stock is 412.</quote>\n\n'), "u1")).toBe([
    ">>> The quoted message:\n[seller · 2026-10-20 01:41 Asia/Shanghai]\nStock is 412.\n<<<",
    "[cx · 2026-10-20 01:42 Asia/Shanghai]\nNoted.",
    "[seller · 2026-10-20 01:43 Asia/Shanghai]\n<quote entry=\"u1\" at=\"e:1\" zone=\"Asia/Shanghai\">Stock is 412.</quote>\n\nWill this cover October?",
  ].join("\n\n"));
  expect(quoted(asked('<quote entry="u1" at="e:1">Stock is 412.</quote>\n\n'), "u1")).toContain("[seller · 2026-10-19 17:41 UTC]");
  expect(quoted(asked('<quote entry="u1" at="e:1" zone="Mars/Olympus">Stock is 412.</quote>\n\n'), "u1")).toContain("[seller · 2026-10-19 17:41 UTC]");
  // A zone named for another message is not this one's.
  expect(quoted(asked('<quote entry="a1" at="e:2" zone="Asia/Shanghai">Noted.</quote>\n\n'), "u1")).toContain("[seller · 2026-10-19 17:41 UTC]");
  // Only the marker's own `zone` and `entry` are read: an attribute whose name ends in them, or their words inside another's value, name
  // nothing, and read as a marker that names no zone does.
  for (const marker of [
    '<quote entry="u1" at="e:1" data-zone="Asia/Shanghai">Stock is 412.</quote>\n\n',
    '<quote entry="u1" at="e:1" note=\'zone="Asia/Shanghai"\'>Stock is 412.</quote>\n\n',
    '<quote entry="u1" at="e:1" note="zone=Asia/Shanghai">Stock is 412.</quote>\n\n',
    '<quote data-entry="u1" at="e:1" zone="Asia/Shanghai">Stock is 412.</quote>\n\n',
  ]) expect(quoted(asked(marker), "u1"), marker).toContain("[seller · 2026-10-19 17:41 UTC]");
});

it("reads the zone of the newest marker quoting the message that names one: a newer marker naming none, or an empty one, leaves the older's; one naming a zone it does not know is read in UTC; of two in one message, the first", () => {
  clock = Date.UTC(2026, 9, 19, 17, 40);
  const marker = (zone: string | undefined): string => `<quote entry="u1" at="e:1"${zone === undefined ? "" : ` zone="${zone}"`}>Stock is 412.</quote>\n\n`;
  const after = (newer: string | undefined) => (clock = Date.UTC(2026, 9, 19, 17, 40), session([said("u1", "Stock is 412."), said("u2", `${marker("Asia/Shanghai")}Is that right?`), said("u3", `${marker(newer)}And now?`)]));
  expect([undefined, "", "Mars/Olympus", "America/New_York"].map((newer) => /\[seller · [^\]]*\]\nStock is 412\.\n<<</.exec(quoted(after(newer), "u1"))?.[0].split("\n")[0])).toEqual([
    "[seller · 2026-10-20 01:41 Asia/Shanghai]", "[seller · 2026-10-20 01:41 Asia/Shanghai]", "[seller · 2026-10-19 17:41 UTC]", "[seller · 2026-10-19 13:41 America/New_York]",
  ]);
  clock = Date.UTC(2026, 9, 19, 17, 40);
  const both = session([said("u1", "Stock is 412."), said("u2", `${marker("Asia/Shanghai")}${marker("America/New_York")}Which?`)]);
  expect(quoted(both, "u1")).toContain("[seller · 2026-10-20 01:41 Asia/Shanghai]");
});

it("reads no step of a `topic` call, which sessions from before keep, and passes over an answer that only made one, as the seller's page draws neither", () => {
  clock = Date.UTC(2026, 8, 30, 10, 12);
  const one = session([said("u1", "first"), answered("a0", "", ["topic"]), answered("a1", "one", ["topic", "keepa"]), said("u2", "and now?"), answered("a2", "", ["topic"]), answered("a3", "33.49")]);
  expect(quoted(one, "u2")).toBe([
    "[seller · 2026-09-30 10:13 UTC]\nfirst",
    "[cx · 2026-09-30 10:15 UTC]\none\n(step: keepa)",
    ">>> The quoted message:\n[seller · 2026-09-30 10:16 UTC]\nand now?\n<<<",
    "[cx · 2026-09-30 10:18 UTC]\n33.49",
  ].join("\n\n"));
  expect(quoted(one, "a2")).toContain(">>> The quoted message:\n[cx · 2026-09-30 10:17 UTC]\n<<<");
  expect(quoted(one, "a1")).not.toContain("(step: topic)");
});

it("cuts a long message around the quoted one, and says how much it cut", () => {
  const long = "x".repeat(AROUND_CHARS + 50);
  expect(quoted(session([said("u1", long), answered("a1", "short")]), "a1")).toContain(`${"x".repeat(AROUND_CHARS)} [50 more characters]`);
});
