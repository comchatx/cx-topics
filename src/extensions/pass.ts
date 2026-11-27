import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { createJudge, isSellers, type JudgeContext } from "./judge.js";

/** The custom entry type the package keeps its progress under, in pi's session file. */
export const PROGRESS = "cx-topics";
/** Where the steward keeps the install tokens, under the tenant's root, pi's working directory. */
export const INSTALLS_FILE = ".pi/cx-installs.json";

/**
 * The package's progress, one custom entry per step: `install`, the token of the install it started from, on the entry that followed
 * the install's clears; `through`, the last seller message judged. An entry with neither starts from the first.
 */
export type Progress = { readonly install?: string; readonly through?: string };

/** What the pass reads of pi: the judge's, the whole session for its labels and its progress, and the tenant's root it runs in. */
export type PassContext = JudgeContext & { readonly sessionManager: JudgeContext["sessionManager"] & { getEntries(): SessionEntry[] }; readonly cwd: string };

/**
 * The key an install is recorded under, as pi tells one package from another: a path as the tenant's list stores it, an npm source by
 * its name alone, so that a new version of it is no install.
 */
export function installKey(source: string): string {
  if (!source.startsWith("npm:")) return source;
  const spec = source.slice("npm:".length);
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  return `npm:${at < 0 ? spec : spec.slice(0, at)}`;
}

/** The token the steward's file holds for `key`; none for no file, no key, no token or a file that does not read. */
export function tokenIn(text: string | undefined, key: string | undefined): string | undefined {
  if (text === undefined || key === undefined) return undefined;
  try {
    const tokens = (JSON.parse(text) as { readonly tokens?: unknown }).tokens;
    const token = typeof tokens === "object" && tokens !== null && !Array.isArray(tokens) ? (tokens as Record<string, unknown>)[key] : undefined;
    return typeof token === "string" && token !== "" ? token : undefined;
  } catch {
    return undefined;
  }
}

const progressOf = (entries: readonly SessionEntry[]): readonly Progress[] =>
  entries.flatMap(entry => {
    if (entry.type !== "custom" || entry.customType !== PROGRESS) return [];
    const data = entry.data as { readonly install?: unknown; readonly through?: unknown } | undefined;
    return [{ ...(typeof data?.install === "string" ? { install: data.install } : {}), ...(typeof data?.through === "string" ? { through: data.through } : {}) }];
  });

export type PassPorts = {
  readonly title: (raw: string) => string | undefined;
  /** pi's `setLabel`: a title, or `undefined` to clear one. */
  readonly setLabel: (id: string, label: string | undefined) => void;
  /** pi's `appendEntry` under `PROGRESS`. */
  readonly keep: (progress: Progress) => void;
  /** The install token the steward holds for this package, read when a pass begins. */
  readonly token: (ctx: PassContext) => string | undefined;
};

export type Pass = {
  /** A seller message ended. */
  readonly arrived: () => void;
  /** A request is about to go: where a seller message arrived since the last, the pass is asked to go on. It waits for nothing. */
  readonly context: (ctx: PassContext) => void;
  /** pi loaded the package — a start, a reload, another session: the pass is asked to go on, or to start over after an install. */
  readonly started: (ctx: PassContext) => void;
  /** pi is about to reload or leave the session: nothing more is written by this pass, and a call in flight is left unread. */
  readonly stopped: () => void;
  /** No pass runs. */
  readonly idle: () => Promise<void>;
};

class Stopped extends Error {}

/**
 * One pass at a time over the seller messages on the branch, in order, each judged once, from where the last kept progress says. A load
 * whose install token is in none of the progress entries is an install: every label on a seller message, branch or not, is cleared, the
 * clears are followed by a progress entry naming the token, and the pass judges from the first. A first load with no progress at all
 * takes the newest seller message as judged, asking nothing. A judgment that stops writes nothing more, and the pass stops at that
 * message until the next seller message or load. Progress off the branch goes on from the branch's newest seller message, asking nothing.
 */
export function createPass(ports: PassPorts): Pass {
  let arrivals = 0;
  let over = false;
  let wanted: PassContext | undefined;
  let running: Promise<void> | undefined;
  const live = (): void => { if (over) throw new Stopped(); };
  const judge = createJudge(ports.title, (id, label) => { live(); ports.setLabel(id, label); }, live);
  const keep = (progress: Progress): Progress => { live(); ports.keep(progress); return progress; };

  async function walk(ctx: PassContext): Promise<void> {
    const session = ctx.sessionManager;
    const kept = progressOf(session.getEntries());
    const token = ports.token(ctx);
    let last = kept.at(-1);
    if (token !== undefined && !kept.some(progress => progress.install === token)) {
      for (const entry of session.getEntries()) if (isSellers(entry) && session.getLabel(entry.id) !== undefined) { live(); ports.setLabel(entry.id, undefined); }
      last = keep({ install: token });
    } else if (last === undefined) {
      const newest = session.getBranch().filter(isSellers).at(-1);
      last = keep(newest === undefined ? {} : { through: newest.id });
    }
    for (;;) {
      const sellers = session.getBranch().filter(isSellers);
      const at = last.through === undefined ? -1 : sellers.findIndex(entry => entry.id === last!.through);
      if (last.through !== undefined && at < 0) {
        const newest = sellers.at(-1);
        if (newest === undefined) return;
        last = keep({ through: newest.id });
        continue;
      }
      const next = sellers[at + 1];
      if (next === undefined) return;
      if (await judge(ctx, next.id) === "stopped") return;
      last = keep({ through: next.id });
    }
  }

  function poke(ctx: PassContext): void {
    if (over) return;
    wanted = ctx;
    if (running !== undefined) return;
    running = (async () => {
      while (wanted !== undefined && !over) {
        const now = wanted;
        wanted = undefined;
        // A ctx pi replaced or reloaded since throws, as a write after `stopped` does: the pass ends there, writing nothing more.
        try { await walk(now); } catch { /* nothing more is written */ }
      }
      running = undefined;
    })();
  }

  return {
    arrived: () => { arrivals += 1; },
    context(ctx) {
      if (arrivals === 0) return;
      arrivals = 0;
      poke(ctx);
    },
    started: poke,
    stopped: () => { over = true; },
    async idle() {
      while (running !== undefined) await running;
    },
  };
}
