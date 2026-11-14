# Changelog

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
