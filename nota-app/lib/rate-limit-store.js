'use strict';

/**
 * Rate-limit storage abstraction.
 * -------------------------------
 * A store implements a single method:
 *
 *   hit(key, windowMs) -> { count, resetAt }
 *
 * `count` is the number of requests seen in the current window (including this
 * one) and `resetAt` is the epoch-ms time the window rolls over.
 *
 * Two implementations are provided:
 *   - MemoryRateLimitStore: process-local, for local dev / tests.
 *   - SqliteRateLimitStore:  durable across restarts within this instance.
 *
 * A Redis/Upstash store can be added later implementing the same `hit`
 * contract (e.g. via INCR + PEXPIRE) with no changes to the middleware.
 */

class MemoryRateLimitStore {
  constructor() {
    this.hits = new Map(); // key -> { count, resetAt }
  }

  hit(key, windowMs) {
    const now = Date.now();
    if (this.hits.size > 10_000) {
      for (const [k, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(k);
    }
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return { count: entry.count, resetAt: entry.resetAt };
  }
}

class SqliteRateLimitStore {
  constructor(db) {
    this.db = db;
    this._pruneCounter = 0;
  }

  hit(key, windowMs) {
    const now = Date.now();
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Opportunistic cleanup of expired counters.
      if (++this._pruneCounter % 500 === 0) {
        db.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').run(now);
      }
      const row = db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').get(key);
      let count;
      let resetAt;
      if (!row || Number(row.reset_at) <= now) {
        resetAt = now + windowMs;
        count = 1;
        db.prepare(
          'INSERT INTO rate_limits(key, count, reset_at) VALUES(?, 1, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at'
        ).run(key, resetAt);
      } else {
        resetAt = Number(row.reset_at);
        count = Number(row.count) + 1;
        db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key);
      }
      db.exec('COMMIT');
      return { count, resetAt };
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    }
  }
}

module.exports = { MemoryRateLimitStore, SqliteRateLimitStore };
