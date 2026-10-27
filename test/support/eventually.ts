import { TestRunner, vi } from "vitest";

// Taken before any test can fake the clock, so a test that does still has its time spent read in real time.
const now = Date.now.bind(Date);
const ends = new WeakMap<object, AbortSignal>();

/** The time a poll leaves its test, so the poll fails on its own last error and the test's own cleanup runs before the runner's timeout. */
const margin = (timeout: number): number => Math.min(2_000, timeout / 10);

/** A test's life as a poll owns it: aborted when the test ends, however it ends, and the time the poll may spend before then. */
export function testLife(): { readonly ended: AbortSignal; readonly budget: number } | undefined {
  const test = TestRunner.getCurrentTest();
  if (test === undefined || !(test.timeout > 0)) return undefined;
  let ended = ends.get(test);
  if (ended === undefined) {
    const finished = new AbortController();
    test.context.onTestFinished(() => finished.abort(new Error("its test ended")));
    ended = AbortSignal.any([test.context.signal, finished.signal]);
    ends.set(test, ended);
  }
  const spent = now() - (test.result?.startTime ?? now());
  return { ended, budget: test.timeout - spent - margin(test.timeout) };
}

// vi.waitFor gives up after one second unless told otherwise, and a full run on two cores can hold the awaited work back longer.
// A poll is vi.waitFor's, moving faked timers while a check is pending, for the time its test has left and no longer, so it fails only
// when what it waits for never comes, on that thing's own error. Once the test ends the check is not called again, the poll ends on its
// last error, and the check is handed the test's end to abort the work it starts. A poll still pending when its test ends moves whatever
// fake clock is current by one interval at vi.waitFor's next tick, as vi.waitFor's own does, before the check sees the end; a check that
// ignores that end and stays pending lets every tick do so until the poll's time is up.
export function eventually<T>(check: (ended: AbortSignal) => T | Promise<T>, options: { readonly interval?: number } = {}): Promise<T> {
  const life = testLife();
  if (life === undefined) return vi.waitFor(() => check(new AbortController().signal), options);
  const { ended, budget } = life;
  let lastError: unknown = new Error("Timed out in eventually");
  if (ended.aborted) return Promise.reject(lastError);
  let stop = (): void => undefined;
  const stopped = new Promise<never>((_, reject) => { stop = () => reject(lastError); });
  ended.addEventListener("abort", stop, { once: true });
  const polled = vi.waitFor(async () => {
    // A value ends vi.waitFor's own retries; the poll has already failed on the test's end.
    if (ended.aborted) return undefined as T;
    try {
      return await check(ended);
    } catch (error) {
      lastError = error;
      throw error;
    }
  }, { interval: options.interval ?? 50, timeout: Math.max(0, budget) });
  return Promise.race([polled, stopped]).finally(() => ended.removeEventListener("abort", stop));
}
