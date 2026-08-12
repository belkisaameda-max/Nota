'use strict';

/**
 * Idempotency storage abstraction.
 * --------------------------------
 * Transfers are made idempotent by an (sender_id, idempotency_key) pair. The
 * DB-level UNIQUE index (`transfer_idempotency_unique`) is the authoritative,
 * durable guard: even under concurrency or after a restart, a second insert
 * with the same key can never succeed, so a retried request can never
 * double-spend.
 *
 * This module hides those details behind a small interface so the storage can
 * later move to Redis/Upstash (e.g. SETNX on the key) without touching the
 * transfer route logic.
 */
function createIdempotencyStore(db) {
  const lookupStmt = db.prepare(
    'SELECT id FROM transactions WHERE sender_id = ? AND idempotency_key = ?'
  );

  return {
    /** Return the prior result for (userId, key) if one exists, else null. */
    lookup(userId, key) {
      if (!key) return null;
      const row = lookupStmt.get(Number(userId), key);
      return row ? { transactionId: Number(row.id) } : null;
    },

    /**
     * True when an error is the unique-constraint violation that signals a
     * concurrent duplicate insert lost the race. Callers treat this as
     * "already processed" rather than a failure.
     */
    isDuplicateError(err) {
      const msg = String(err && err.message);
      return /UNIQUE constraint failed:\s*transactions\.sender_id/i.test(msg);
    },
  };
}

module.exports = { createIdempotencyStore };
