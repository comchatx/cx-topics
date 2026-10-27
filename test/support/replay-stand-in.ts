import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ownPathOnly } from "./own-path.js";
import type { Upstreams } from "./replay.js";

/** What the stand-in Jev answers each question for a latest message: by default, a message that names a switch is new work. */
export type Scripted = (latest: string, question: string) => number;
const SWITCH = /换个|另外|回到|new topic|go back|now plan/i;
export const byWords: Scripted = (latest, question) => {
  const switching = SWITCH.test(latest);
  return question === "significantChange" ? (switching ? 0.9 : 0.1) : question === "continueCurrent" ? (switching ? 0.1 : 0.9) : 0.6;
};

/**
 * A loopback listener in TypeSafe's and OpenRouter's place, on the paths pi calls: Jev answers as `scripted` says, with the usage
 * TypeSafe reports; the title model streams the first words of the newest seller line it was shown. `fail` answers every call, or
 * `only` Jev's or the title model's, with that status instead. Nothing it says is a measurement.
 */
export async function standIn(options: { readonly scripted?: Scripted; readonly fail?: { readonly status: number; readonly body: string; readonly only?: "jev" | "title" } } = {}) {
  const scripted = options.scripted ?? byWords;
  const seen: { readonly path: string; readonly body: unknown }[] = [];
  const own = ownPathOnly(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    seen.push({ path: req.url ?? "", body });
    const jev = req.url === "/typesafe/v1/systemone";
    if (options.fail !== undefined && (options.fail.only === undefined || (options.fail.only === "jev") === jev)) { res.writeHead(options.fail.status, { "content-type": "application/json" }).end(options.fail.body); return; }
    if (jev) {
      const latest = String(body.state?.latestUserMessage ?? "");
      const answers = Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: "noul", noul: scripted(latest, key) }]));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: "jev-stand-in", answers, usage: { input_tokens: 300, output_tokens: 0 } }));
      return;
    }
    if (req.url === "/openrouter/api/v1/chat/completions") {
      const prompt = String(body.messages?.at(-1)?.content?.[0]?.text ?? body.messages?.at(-1)?.content ?? "");
      const newest = prompt.split("\n").filter(line => line.startsWith("[seller] ")).at(-1)?.slice("[seller] ".length) ?? "Untitled";
      const common = { id: "c", object: "chat.completion.chunk", created: 1, model: body.model };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: [...newest].slice(0, 12).join("") }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(404).end();
  });
  const server: Server = createServer(own.handler);
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}${own.path}`;
  const upstreams: Upstreams = { typesafe: `${origin}/typesafe/v1`, openrouter: `${origin}/openrouter/api/v1` };
  return { upstreams, seen, close: () => new Promise<void>(done => server.close(() => done())) };
}
