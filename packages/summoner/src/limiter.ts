/** Sliding-window limiter: at most `max` acquisitions per `windowMs` (SUM-4: 240 per minute). */
export class RateLimiter {
  private stamps: number[] = [];
  constructor(private max = 240, private windowMs = 60_000, private now: () => number = Date.now, private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  /** Number of calls currently counted inside the window. */
  get used(): number {
    this.prune();
    return this.stamps.length;
  }

  private prune() {
    const cutoff = this.now() - this.windowMs;
    while (this.stamps.length && this.stamps[0]! <= cutoff) this.stamps.shift();
  }

  async acquire(): Promise<void> {
    for (;;) {
      this.prune();
      if (this.stamps.length < this.max) {
        this.stamps.push(this.now());
        return;
      }
      await this.sleep(Math.max(5, this.stamps[0]! + this.windowMs - this.now()));
    }
  }
}
