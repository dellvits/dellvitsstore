import type { Store, Options } from 'express-rate-limit';
import { one, run } from './db.js';

/** Shared counters keep login limits effective across serverless instances. */
export class PostgresRateLimitStore implements Store {
  localKeys = false;
  private windowMs = 60_000;
  constructor(public readonly prefix: string) {}
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  async increment(key: string) {
    const now = new Date().toISOString();
    const reset = new Date(Date.now() + this.windowMs).toISOString();
    const row = (await one(
      `INSERT INTO rate_limits(key,hits,reset_at) VALUES(?,1,?)
       ON CONFLICT(key) DO UPDATE SET
         hits=CASE WHEN rate_limits.reset_at<=? THEN 1 ELSE rate_limits.hits+1 END,
         reset_at=CASE WHEN rate_limits.reset_at<=? THEN excluded.reset_at ELSE rate_limits.reset_at END
       RETURNING hits,reset_at`,
      this.prefix + key,
      reset,
      now,
      now,
    ))!;
    // Expired counters are safe to discard, and don't accumulate indefinitely.
    await run('DELETE FROM rate_limits WHERE reset_at<?', now);
    return { totalHits: row.hits, resetTime: new Date(row.reset_at) };
  }
  async decrement(key: string) {
    await run('UPDATE rate_limits SET hits=GREATEST(0,hits-1) WHERE key=?', this.prefix + key);
  }
  async resetKey(key: string) {
    await run('DELETE FROM rate_limits WHERE key=?', this.prefix + key);
  }
}
