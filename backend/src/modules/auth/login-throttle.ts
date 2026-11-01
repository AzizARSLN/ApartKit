const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

type Entry = { failures: number; resetAt: number };

/** Tek süreçlik deploy için bellek içi sayaç; ek altyapı gerektirmez. */
export function createLoginThrottle(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();

  function active(key: string): Entry | null {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.resetAt <= now()) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  return {
    retryAfterSeconds(key: string): number {
      const entry = active(key);
      if (!entry || entry.failures < MAX_FAILURES) return 0;
      return Math.ceil((entry.resetAt - now()) / 1000);
    },
    recordFailure(key: string): void {
      const entry = active(key);
      if (entry) {
        entry.failures += 1;
        return;
      }
      for (const [k, e] of entries) {
        if (e.resetAt <= now()) entries.delete(k);
      }
      entries.set(key, { failures: 1, resetAt: now() + WINDOW_MS });
    },
    clear(key: string): void {
      entries.delete(key);
    },
  };
}
