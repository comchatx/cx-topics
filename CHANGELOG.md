# Changelog

## 0.2.1

- An install, the first or after a remove, again clears every title the package wrote and titles each conversation from its first message, as before 0.2.0. The package reads `.pi/cx-installs.json` again, and the built module exports `INSTALLS_FILE` and `installKey` again. 0.2.0's other changes stay.

## 0.2.0

- A reinstall no longer clears the titles and asks Jev again about every seller message of every conversation. The session's progress carries on, so a message sent while the package was off is judged when the pass reaches it. The package reads no `.pi/cx-installs.json`, and the built module no longer exports `INSTALLS_FILE` or `installKey`.
- `routeTopic` answers a decision and a stale-title flag, or why there is none. The fields nothing read are gone: `baseline`, `fallback`, `probabilities`, `disagreement`, `requestCount`, `latencyMs` and `disclosedFields`. Also gone are the input copy guarding against getters, the input validation (a message of no words is passed over before Jev is asked, as it was) and the router's own deadline beside `askJev`'s 20 seconds. What a judgment decides is unchanged.

## 0.1.11

- The tile's mark on the Plugins page is the signed drawing.

## 0.1.10

- The README's "What it needs" section goes, its heading with it (signed on 2026-11-18): the Plugins page draws Jev from `comchatx.builds`. "What it costs" is unchanged.

## 0.1.9

- The card's name is the one signed on 2026-11-17: "Chat Chapters" on the English page (`comchatx.name`) and 「随题话章」 on the Chinese page (`comchatx.nameZh`).

## 0.1.8

- Jev's client is `@comchatx/typesafe`'s, a dependency from 0.1.3 on: `askJev` asks pi's classifier with no retry, and `JEV_PROVIDER`, `JEV_MODEL`, `Question`, `Questions` and `AnswerFailure` are its. This package's own copies are gone: the two names, the question and failure types, and the reading of pi's classifier result (`parseAnswers`). `failureOf` stays here: it reads the title model's failure, a chat model's.
- What a judgment decides from Jev's answer, and the failures it reads, are unchanged.
- Two test cases name what was observed on 2026-10-20 without the office's reference.

## 0.1.7

- The card's name is the one signed on 2026-11-11, "Conversation Titles", in `comchatx.name`, the same on the Chinese and the English page.

## 0.1.6

- The card's line and the Overview, in English and Chinese, are the words signed on 2026-11-10: "Titles each piece of work, and reads quotes in context." as npm's `description`, and 「每件事都有标题，引用旧消息时 cx 连前后一起读。」 as `comchatx.about`. They said "Names your conversations and retrieves the messages you quote." and 「为对话生成标题，并读取你引用的消息及上下文。」.
- What only a developer reads moved from the README to `DEVELOPING.md`: the opening description and "The titles", "`quoted`", "The quote marker", "How it is built", "Tests", "Release".
- `DEVELOPING.md` holds the install line, `pi install npm:@comchatx/cx-topics`.

## 0.1.5

- The README in Chinese, `README.zh-CN.md`, which the Plugins page draws as the Overview in Chinese.

## 0.1.4 (unreleased)

- A title is written by the model the seller is chatting on, read from pi at each title call. On a physical model the call is as before, at most 128 output tokens with no thinking; on a virtual model the seller selected, pi routes it (`streamSimple`) and the thinking level the seller's router returns applies, pi adding its budget to the 128, since pi 1.4.0 offers an extension no public way to route and then bound a request; `TITLE_MODEL` (`balance` `minimax/minimax-m3`) is gone, and where the session has no model, or pi holds no key for it, no title is written.
- `package.json`'s `comchatx` field names Jev in `builds`, so the Plugins page lists it among the plugins this one uses.
