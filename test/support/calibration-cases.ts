/**
 * What a seller message should do to History, read from the product owner's words: open a row of its own, or join the row in progress, its title
 * standing or rewritten. `either` is recorded and not counted, an ambiguity the words leave open.
 */
export type Expected = "new" | "continue" | "either";
export type CaseMessage = {
  readonly text: string;
  readonly expect: Expected;
  /** On a continuation: whether the row's title should be rewritten. Unset is `either`. */
  readonly stale?: boolean;
  /** A message as it stood in the seller's session, appended with the label it carried there and not judged: production's rows as they were. */
  readonly given?: { readonly label?: string };
};
export type CalibrationCase = { readonly id: string; readonly source: string; readonly messages: readonly CaseMessage[] };

const open = (text: string): CaseMessage => ({ text, expect: "new" });
const joins = (text: string, stale?: boolean): CaseMessage => (stale === undefined ? { text, expect: "continue" } : { text, expect: "continue", stale });
const either = (text: string): CaseMessage => ({ text, expect: "either" });
const given = (text: string, label?: string): CaseMessage => ({ text, expect: "either", given: label === undefined ? {} : { label } });

/** About 3,000 characters of invented Chinese reviews, as a seller pastes them: the instruction comes after. */
const REVIEWS = Array.from({ length: 60 }, (_, at) => [
  `评论${at + 1}：`,
  ["信号覆盖比旧路由器好很多，三楼也能满格，", "安装简单，十分钟就配好了，但是说明书写得太简略，", "用了两周偶尔掉线，重启后恢复，希望固件能更新，", "价格比TP-Link贵一点，不过散热做得不错，"][at % 4],
  ["孩子打游戏延迟明显降低，整体满意，给四星。", "外观大气，放在客厅不突兀，就是天线有点大。", "客服回复很快，帮我解决了桥接的问题，五星好评。", "网速测试比宣传的低一些，但日常够用，三星。"][(at >> 2) % 4],
].join("")).join("\n");

/**
 * The calibration set: the live witness, the deploy cases of the wiring report re-read for today's design (a return to earlier work is a
 * new row, going back not being a ComChatX thing), and cases written for each question and bar, in Chinese and English. Each case is
 * one conversation from its first message; the first is titled without Jev.
 */
export const CALIBRATION_CASES: readonly CalibrationCase[] = Object.freeze([
  {
    id: "witness",
    source: "the product owner's live conversation, beta-browser live check 2026-10-20 §6 and listing run day 2 (messages verbatim from the reports, the order from the History screenshot)",
    messages: [
      open("测试期间只读真店。不发任何会改动店铺的请求；要改的东西只把请求写给我看，不要发。"),
      either("现在装了哪些包？"),
      open("读一下我美国站 B0EXAMPLE1 现在的 listing，连同它的 issues。"),
      open("昨天那份搜索查询绩效报告后来怎么样了？"),
      joins("只要最近一周。"),
      open("再看一下 B0EXAMPLE1 和昨天那五个竞品，跟昨天比有什么变化？"),
      either("根据市场变化，给 B0EXAMPLE1 这个 listing 的改法和预期效果，只要方案，不要分析过程。"),
      joins("为什么？", false),
      joins("把你要发的请求写给我看：origin、method、path、body。不要发。"),
      joins("现在怎么样了？", false),
      joins("现在怎么样了？", false),
      open("换个新话题：用一句话说说什么是 ASIN。"),
      open("你现在用的是什么模型"),
      joins("现在呢？", false),
      open("你好，用一句话介绍你自己。"),
    ],
  },
  {
    id: "witness-as-filed",
    source: "the witness with production's rows before 「换个新话题」 given as History showed them (beta-browser live check 2026-10-20 §6): the listing row's title on its first message, everything after it in that row",
    messages: [
      given("测试期间只读真店。不发任何会改动店铺的请求；要改的东西只把请求写给我看，不要发。", "SP-API 只读边界确认"),
      given("现在装了哪些包？"),
      given("读一下我美国站 B0EXAMPLE1 现在的 listing，连同它的 issues。", "B0EXAMPLE1 listing 及 issues 读取"),
      given("昨天那份搜索查询绩效报告后来怎么样了？"),
      given("只要最近一周。"),
      given("再看一下 B0EXAMPLE1 和昨天那五个竞品，跟昨天比有什么变化？"),
      given("根据市场变化，给 B0EXAMPLE1 这个 listing 的改法和预期效果，只要方案，不要分析过程。"),
      given("为什么？"),
      given("把你要发的请求写给我看：origin、method、path、body。不要发。"),
      given("现在怎么样了？"),
      given("现在怎么样了？"),
      open("换个新话题：用一句话说说什么是 ASIN。"),
      open("你现在用的是什么模型"),
      joins("现在呢？", false),
      open("你好，用一句话介绍你自己。"),
    ],
  },
  {
    id: "return-en",
    source: "wiring report, real case 1, re-read: going back is a new row",
    messages: [
      open("Analyse the BE3600 router's positioning against the TP-Link AX55 on Amazon US."),
      open("Now plan Walmart inventory for the yoga mats for Q4."),
      open("Go back to the BE3600 work and draft its launch price."),
    ],
  },
  {
    id: "return-zh",
    source: "wiring report, real case 2, re-read: going back is a new row",
    messages: [open("帮我分析瑜伽垫在亚马逊的补货节奏"), open("另外看看下个月TikTok的广告预算"), open("回到瑜伽垫补货，按60天备货算一下数量")],
  },
  {
    id: "long-paste",
    source: "wiring report, real case 3, re-read: after cases 1 and 2's topics, the paste going back is a new row",
    messages: [
      open("Analyse the BE3600 router's positioning against the TP-Link AX55 on Amazon US."),
      open("Now plan Walmart inventory for the yoga mats for Q4."),
      open("帮我分析瑜伽垫在亚马逊的补货节奏"),
      open("另外看看下个月TikTok的广告预算"),
      open(`${REVIEWS}\n看完这些，回到之前BE3600的定价分析`),
    ],
  },
  {
    id: "correction",
    source: "wiring report, real case 4; a title naming the corrected detail may be rewritten (the office's ruling, 2026-10-20)",
    messages: [open("Plan 60 days of stock for the yoga mats."), joins("Actually make it 45 days.")],
  },
  {
    id: "same-product-new-intent",
    source: "wiring report, real case 5: either answer is recorded",
    messages: [open("Analyse BE3600 reviews."), either("Write TikTok ad copy for the BE3600.")],
  },
  {
    id: "steer",
    source: "wiring report, real case 6: a steer sent while cx works on case 4's first message, judged once",
    messages: [open("Plan 60 days of stock for the yoga mats."), joins("and check the Canadian store too")],
  },
  {
    id: "switch-long-zh",
    source: "written: an announced new topic after a long topic, the witness's shape on invented words (significantChange, the long bars)",
    messages: [
      open("帮我看一下 B0CX1234 这个瑜伽垫 listing 的标题和五点描述。"),
      joins("标题里加上“加厚”这个词。"),
      joins("第三条五点写得太长了，缩短一点。"),
      joins("再给我两个备选标题。"),
      joins("第二个备选不错，就用它。"),
      joins("后台关键词也按新标题调一下。"),
      joins("把改后的完整 listing 发我。"),
      joins("五点里的尺寸单位改成英寸。"),
      joins("好的，没问题了。"),
      open("换个话题：FBA 的长期仓储费怎么算？"),
    ],
  },
  {
    id: "switch-short-zh",
    source: "written: the same announced switch after a short topic (the short bars)",
    messages: [open("帮我看一下 B0CX1234 这个瑜伽垫 listing 的标题和五点描述。"), open("换个话题：FBA 的长期仓储费怎么算？")],
  },
  {
    id: "switch-long-en",
    source: "written: an announced new topic after a long topic, in English",
    messages: [
      open("Review the PPC campaign for my garlic press, ASIN B0GP5555."),
      joins("Pause the keywords with ACoS above 60%."),
      joins("Raise the bid on 'garlic crusher' by 10%."),
      joins("Add 'stainless garlic press' as an exact match."),
      joins("What's the campaign's spend this week?"),
      joins("Lower the daily budget to $40."),
      joins("Show me the search terms report for it."),
      joins("Negate 'garlic peeler'."),
      joins("Thanks, that's it for the campaign."),
      open("New topic: in one sentence, what is Brand Registry?"),
    ],
  },
  {
    id: "unannounced-question-long-zh",
    source: "written: a one-sentence question of another kind after a long topic, no switch announced (significantChange's 'brief tangent')",
    messages: [
      open("帮我看一下 B0CX1234 这个瑜伽垫 listing 的标题和五点描述。"),
      joins("标题里加上“加厚”这个词。"),
      joins("第三条五点写得太长了，缩短一点。"),
      joins("再给我两个备选标题。"),
      joins("第二个备选不错，就用它。"),
      joins("后台关键词也按新标题调一下。"),
      joins("把改后的完整 listing 发我。"),
      joins("五点里的尺寸单位改成英寸。"),
      open("对了，你现在用的是什么模型？"),
    ],
  },
  {
    id: "greeting-mid-topic-en",
    source: "written: a greeting and self-introduction request in the middle of a topic, as the live check's test message",
    messages: [
      open("Review the PPC campaign for my garlic press, ASIN B0GP5555."),
      joins("Pause the keywords with ACoS above 60%."),
      joins("Raise the bid on 'garlic crusher' by 10%."),
      open("Hi, introduce yourself in one sentence."),
    ],
  },
  {
    id: "follow-ups-zh",
    source: "written: short follow-ups and corrections that carry no product word (continueCurrent; the title stands, except where a correction changes the detail it names)",
    messages: [
      open("算一下我加拿大站这个月的 FBA 费用。"),
      joins("不对，是美国站。"),
      joins("为什么比上个月高？", false),
      joins("只看大件商品。", false),
      joins("现在呢？", false),
    ],
  },
  {
    id: "drift-zh",
    source: "written: work that moves step by step from the listing to its A+ content (titleAdequate: a rewrite where it moves; either after, the row may already be renamed)",
    messages: [
      open("帮我检查 B0CX1234 的 listing 有没有违规词。"),
      joins("把违规词替换掉。", false),
      joins("顺便把 A+ 页面的文案也重写一下。"),
      joins("A+ 第二个模块加一张对比图的说明。"),
      joins("A+ 第三个模块改成品牌故事。"),
    ],
  },
  {
    id: "same-task-other-product-en",
    source: "written: the same task on another product, after a short and after a long topic (continueCurrent's product sentence; the bars by length)",
    messages: [
      open("Write five bullet points for my bamboo cutting board, ASIN B0BB1111."),
      either("Now the same for my bamboo utensil set, B0BB2222."),
      joins("Make the utensil set's bullets shorter."),
      joins("Add the dishwasher-safe claim to them."),
      joins("Turn the third bullet into a question."),
      joins("Use US spelling throughout."),
      joins("Put the material first in each bullet."),
      joins("Drop the emoji."),
      either("Now write bullets for the bamboo bath mat, B0BB3333."),
    ],
  },
  {
    id: "other-kind-same-product-zh",
    source: "written: another kind of task on the product in progress (continueCurrent's 'another kind of task does not continue it')",
    messages: [
      open("帮我写 B0CX1234 瑜伽垫的五点描述。"),
      joins("第一条强调防滑。"),
      open("帮我算一下 B0CX1234 下个季度要备多少货。"),
    ],
  },
  {
    id: "answer-to-cx-en",
    source: "written: the seller answering cx's question in a word or two",
    messages: [open("Pull the search query performance report for my store."), joins("Last 7 days.", false), joins("Only the top 20 queries.", false)],
  },
]);
