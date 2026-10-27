import { randomUUID } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

/**
 * A fake server's handler that answers only the callers its own test handed a URL: the URL is under `path`, a segment no other
 * double holds, and a request outside it is refused with 421, unread, and never reaches `handler`, which sees the request's URL
 * with `path` taken off. It imports nothing of the test runner, so a script a test runs may serve one too.
 */
export function ownPathOnly(handler: RequestListener): { readonly path: string; readonly handler: RequestListener } {
  const path = `/${randomUUID()}`;
  return {
    path,
    handler: (request: IncomingMessage, response: ServerResponse) => {
      const url = request.url ?? "";
      const rest = url.slice(path.length);
      if (!url.startsWith(path) || !(rest === "" || rest.startsWith("/") || rest.startsWith("?"))) { response.writeHead(421).end(); return; }
      request.url = rest.startsWith("/") ? rest : `/${rest}`;
      handler(request, response);
    },
  };
}
