'use strict';

/**
 * Double-entry ledger helpers.
 * ----------------------------
 * Every transfer records two ledger entries — a debit against the sender and
 * a credit to the receiver — each capturing the resulting balance. This gives
 * a reconciliation-friendly trail (the sum of all entries for a user should
 * always equal their wallet balance) while the original `transactions` table
 * stays intact for Phase 1–3 compatibility.
 *
 * All amounts are integer cents. Callers MUST invoke recordTransfer inside the
 * same DB transaction that moves the wallet balances.
 */
function recordTransfer(db, entry) {
  const {
    transactionId,
    senderId,
    receiverId,
    amountCents,
    senderBalanceAfter,
    receiverBalanceAfter,
    currency = 'EUR',
  } = entry;

  const insert = db.prepare(
    `INSERT INTO ledger_entries
       (transaction_id, user_id, counterparty_id, direction, amount_cents, balance_after_cents, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run(transactionId, senderId, receiverId, 'debit', amountCents, senderBalanceAfter, currency);
  insert.run(transactionId, receiverId, senderId, 'credit', amountCents, receiverBalanceAfter, currency);
}

// --- Cursor helpers (opaque, stable across pages) -------------------------

function encodeCursor(row) {
  if (!row) return null;
  return Buffer.from(`${row.created_at}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = raw.lastIndexOf('|');
    if (idx === -1) return null;
    const createdAt = raw.slice(0, idx);
    const id = Number(raw.slice(idx + 1));
    if (!createdAt || !Number.isInteger(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function readLedgerPage(db, { userId, cursor, limit = 20 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const decoded = decodeCursor(cursor);
  const where = decoded
    ? 'WHERE user_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))'
    : 'WHERE user_id = ?';
  const args = decoded ? [Number(userId), decoded.createdAt, decoded.createdAt, decoded.id, size + 1] : [Number(userId), size + 1];
  const rows = db.prepare(`SELECT * FROM ledger_entries ${where} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args);
  const hasMore = rows.length > size;
  const page = rows.slice(0, size);
  return { entries: page.map((row) => ({ id: Number(row.id), transactionId: Number(row.transaction_id), direction: row.direction, amountCents: Number(row.amount_cents), balanceAfterCents: Number(row.balance_after_cents), currency: row.currency, counterpartyId: Number(row.counterparty_id), createdAt: row.created_at })), nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null };
}

module.exports = { recordTransfer, encodeCursor, decodeCursor, readLedgerPage };
