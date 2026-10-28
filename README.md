Names your conversations and retrieves the messages you quote. cx-topics is one pi extension: it titles the seller's work itself, on the model the seller is chatting on and on Jev's verdict on each seller message, and gives cx one tool, `quoted`, that reads a message the seller quoted.

## The titles

The package names and renames. It titles the conversation's first seller message and each message Jev judges new work, and rewrites a topic's title when Jev judges it no longer names the topic's work, message by message as they come and, after an install, over the whole conversation from its first message. A title is the seller's, in the seller's words and language: the title model is told it is for the seller, who reads it to find the work again. It is one line, Chinese spaced from Latin letters and figures, at most 8 words and 80 characters (`title()`); an answer with nothing left writes nothing. cx is offered no tool to name or rename, and is told nothing of titles.

A title is a pi label on a seller message: a new topic's on its first message, a rewrite as a later label on the same message. A message of no words, an image or quotes alone, gets no title of its own and stays in the topic before it. A message continues the current topic or opens a new one; none returns to an earlier topic.

**When it asks.** One Jev classify per seller message under a title. One pass at a time walks the seller messages on the branch (`getBranch`) in order, from the last one its progress names, and judges each not judged yet (`src/extensions/pass.ts`). The progress is a custom entry under `cx-topics`, `{through: <entry id>}` after each judged message and `{install: <token>}` after an install's clears; pi keeps them in the session file and puts none in the model's context.

**Where it carries on.** A progress entry naming a message no longer on the branch carries on from the branch's newest seller message, asking nothing. A first load with no progress entry and no unseen install token writes a starting entry at the branch's newest seller message and asks nothing.

**When it starts over.** Only an install starts from the first message: it clears every title the package wrote and titles the conversation again. pi tells a package nothing of how it came to be loaded, so the host records each install with a fresh token in `.pi/cx-installs.json` under the project (`INSTALLS_FILE`), keyed by the package's source with any npm version dropped (`installKey`), and the package reads a load as an install when the token for its own key is in none of its progress entries. Its key is the source pi lists for the `quoted` tool whose file is the package's own, so another package's `quoted` lends none. No key, no file, no token or a file that does not read: it carries on.

**When it titles.**
- The conversation's first seller message with words, and a message Jev judges new work: the title model titles it from the seller's message alone.
- A continuation: the same Jev call answers whether the current title still names the work in the topic. At 0.2 or less (`ROUTING_LIMITS.staleTitle`) the title model rewrites the title from that title and the topic's seller messages.
- A title is written only while the label it was asked on still stands, and only where it differs from it.

**What Jev is shown.** The topic in progress, from pi's branch: its title and the seller's own words in it, `<quote>` markers taken out, and the message judged; none of cx's words, tool calls, thinking or images. Past 31 seller messages, the newest 31 (`ROUTING_LIMITS.sellerMessages`). Each message over 512 code points and the latest over 2,048 keep their head and tail around `\n[… N characters omitted …]\n`. The topic's length sets how sure Jev must be that a message continues it: in a topic of two seller messages or fewer an even answer continues it, from eight on the confident 0.8, and between the two the bar rises evenly (`ROUTING_LIMITS`). The largest request Jev is sent is 109,260 bytes.

**The models.** Jev by pi's catalogue, `typesafe` `jev-latest` (`JEV`). The title model is the one the seller is chatting on, read from pi (`ctx.model`) at each title call, so a model the seller switches to writes the next title: a title is the seller's, written by the model they chose (Jack, 2026-10-28), and the package names no model of its own and offers no setting for one. The title call goes through pi's nested call (`modelRegistry.complete`) with no reasoning, no tools, at most 128 output tokens and no cache retention, within 20,000 ms. The package holds no address or key: where pi has no Jev configured nothing is asked, and where the session has no model, or pi holds no key or sign-in for it, no title is written and the pass stops at that message as on a refused call.

**Failures write nothing.** Only a result pi ends with `stop` that answers every question is a verdict, and only an answer pi ends with `stop` is a title. A call that was answered, or a request refused as it is (`400`, `413`, `422`, or a `403` without one of the gate's codes), moves on to the next message; a call that failed otherwise stops the pass at that message, to ask it again at the next seller message or the next load, never in a loop. No call is retried.

**Stop.** Stop ends cx's answer, not the filing of the seller's message: a Jev call and a title call in flight are left to finish, each on its own deadline, and the title is written.

## `quoted`

`quoted` takes `entry`, a pi entry id. It reads pi's whole session (`getEntries`, compacted or not) and answers the quoted message with up to 2 messages of the seller's or cx's on each side: who, when, the words, and one line per tool step an answer took. The time is to the minute, on the zone of the newest quote marker naming one, else in UTC. The quoted message is cut at 8,000 characters and its neighbours at 1,000, each cut naming what it left. An id the session does not hold answers that the message is from an earlier conversation.

On every request of a session that loads the package the model is told, in the system prompt's tools section, that `quoted` reads a quoted message by the `entry` attribute of its `<quote>` tag, and in its rules section that a message holding a quote is answered after `quoted` reads it: 255 characters, about 64 tokens.

## The quote marker

A quote inside the seller's message is sent as

```
<quote entry="<pi entry id>" at="<epoch>:<seq>" zone="<IANA zone>">the quoted or selected words</quote>
```

one marker per quoted message or selection, before the seller's own words. Quoted words never carry a literal `</quote>`. `entry` is what `quoted` reads; `zone` is the zone the quote's card shows its time in. Without this package the model reads the quoted words inline.

## How it is built

- `src/core/` holds the pure parts — the protocol of Jev's questions, the routing bars and the title's cut — and imports nothing but itself.
- `src/extensions/topics.ts` is the one extension; `judge.ts` asks and writes, `pass.ts` walks the branch. `npm run build` bundles `topics.ts` into `dist/extensions/topics.js`, pi's own packages left for pi to supply; the package ships that file alone. The built module also exports `INSTALLS_FILE`, `installKey` and `JEV`, for a host to hold the package to.
- `package.json` declares no `type`. pi's loader then reads the bundle at the path pi lists the `quoted` tool's source by; declared a module, it is loaded natively and knows itself by its real path, which behind a symlink is not the path pi lists, so the package would find no key of its own and miss an install.

## Tests

- `test/core/` — the protocol, the routing bars against a fixed comparison (`test/support/routing-comparison.json`), the title's cut, and that the core imports nothing else and the bundle carries the live files alone.
- `test/extensions/` — the title and the quote reading on pi's own session shapes, Jev's verdict and the titles, and the pass: an install's clears and its judging from the first, carrying on, a branch left, one pass at a time, a reload's cut call asked again, and the key read from pi's tool list.
- `test/support/replay.test.ts` and `replay-main.test.ts` — the calibration replay on a stand-in through pi's own registry, with no key: the title request names the session's model, a model switched between two messages titles the second, and a model pi holds no key for is asked nothing.
- `test/package.test.ts` — the pinned pi loads the built extension with its tool and handlers; the built module exports what a host holds it to; the package ships the built extension alone.

**The calibration set.** `test/support/calibration-cases.ts`, replayed by hand by `test/support/replay-main.ts`, bundled with esbuild as `replay-main.test.ts` does (`--live --keys <env file>`): each seller message judged by the package's own judge on pi's registry, against TypeSafe and OpenRouter on development keys read from an env file by name, and held to the outcome wanted — a new topic, a continuation with its title standing or a rewrite asked. With no key it runs on a stand-in. The set was measured with the session on `balance` `minimax/minimax-m3`, the platform's default (`CALIBRATED`); Jev's verdicts do not depend on the session's model, while a title's wording now varies with the model the seller chats on.

## Release

Each version is published by `.github/workflows/release.yml` on a `v<version>` tag, from this repository as the package's trusted publisher on npm.
