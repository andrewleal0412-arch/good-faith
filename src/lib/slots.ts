/** Runs at most `n` jobs at once: the next `queue` wait their turn, and a job past those is refused (null) rather than
 *  held. The hosted demo is one small server, so work that loads many files at once (a statement packet) goes through
 *  one of these instead of starting once per request. */
export function slots(n: number, queue: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(job: () => Promise<T>): Promise<T | null> {
    if (running < n) running++;
    else if (waiting.length < queue) await new Promise<void>((go) => waiting.push(go)); // handed a slot by a finished job
    else return null;
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
