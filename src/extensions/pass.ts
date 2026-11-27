import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { createJudge, isSellers, type JudgeContext } from "./judge.js";

/** The custom entry type the package keeps its progress under, in pi's session file. */
export const PROGRESS = "cx-topics";

/** The package's progress, one custom entry per step: `through`, the last seller message judged. An entry without it starts from the first. */
export type Progress = { readonly through?: string };

/** What the pass reads of pi: the judge's, and the whole session for its progress. */
export type PassContext = JudgeContext & { readonly sessionManager: JudgeContext["sessionManager"] & { getEntries(): SessionEntry[] } };

const progressOf = (entries: readonly SessionEntry[]): readonly Progress[] =>
  entries.flatMap(entry => {
    if (entry.type !== "custom" || entry.customType !== PROGRESS) return [];
    const data = entry.data as { readonly through?: unknown } | undefined;
    return [typeof data?.through === "string" ? { through: data.through } : {}];
  });

export type PassPorts = {
  readonly title: (raw: string) => string | undefined;
  /** pi's `setLabel`: a title, or `undefined` to clear one. */
  readonly setLabel: (id: string, label: string | undefined) => void;
  /** pi's `appendEntry` under `PROGRESS`. */
  readonly keep: (progress: Progress) => void;
};

export type Pass = {
  /** A seller message ended. */
  readonly arrived: () => void;
  /** A request is about to go: where a seller message arrived since the last, the pass is asked to go on. It waits for nothing. */
  readonly context: (ctx: PassContext) => void;
  /** pi loaded the package — a start, a reload, another session: the pass is asked to go on. */
  readonly started: (ctx: PassContext) => void;
  /** pi is about to reload or leave the session: nothing more is written by this pass, and a call in flight is left unread. */
  readonly stopped: () => void;
  /** No pass runs. */
  readonly idle: () => Promise<void>;
};

class Stopped extends Error {}

/**
 * One pass at a time over the seller messages on the branch, in order, each judged once, from where the last kept progress says. A first
 * load with no progress at all takes the newest seller message as judged, asking nothing; a reinstall finds the session's progress and
 * goes on from it, so a message sent while the package was off is judged when it is reached. A judgment that stops writes nothing more, and the pass stops at that
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
    let last = progressOf(session.getEntries()).at(-1);
    if (last === undefined) {
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
