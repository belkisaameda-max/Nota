'use strict';

const { clean, centsFrom, limitFrom } = require('../lib/validation');
const { ApiError, asyncHandler } = require('../lib/errors');
const { recordTransfer, readLedgerPage } = require('../lib/ledger');
const { EVENTS } = require('../lib/audit');

function registerTransferRoutes(app, { db, auth, audit, idempotency }) {
  app.get('/api/transactions', auth, asyncHandler(async (req, res) => {
    const limit = limitFrom(req.query.limit, 20, 100);
    const cursor = Number.isInteger(Number(req.query.cursor)) ? Number(req.query.cursor) : null;
    const rows = db.prepare(`SELECT t.*, s.name sender_name, s.username sender_username, r.name receiver_name, r.username receiver_username
      FROM transactions t JOIN users s ON s.id=t.sender_id JOIN users r ON r.id=t.receiver_id
      WHERE (t.sender_id=? OR t.receiver_id=?) ${cursor ? 'AND t.id < ?' : ''}
      ORDER BY t.id DESC LIMIT ?`).all(...(cursor ? [req.user.sub, req.user.sub, cursor, limit + 1] : [req.user.sub, req.user.sub, limit + 1]));
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    res.json({ transactions: page.map((t) => ({ id: Number(t.id), amountCents: Number(t.amount_cents), currency: t.currency, status: t.status, note: t.note, createdAt: t.created_at, direction: Number(t.sender_id) === Number(req.user.sub) ? 'sent' : 'received', counterparty: Number(t.sender_id) === Number(req.user.sub) ? { name: t.receiver_name, username: t.receiver_username } : { name: t.sender_name, username: t.sender_username } })), nextCursor: hasMore ? Number(page[page.length - 1].id) : null });
  }));

  app.get('/api/ledger', auth, asyncHandler(async (req, res) => {
    const page = readLedgerPage(db, { userId: req.user.sub, cursor: req.query.cursor, limit: req.query.limit });
    res.json(page);
  }));

  app.post('/api/transfers', auth, asyncHandler(async (req, res) => {
    const recipient = clean(req.body.recipient || req.body.receiverEmail, 120).toLowerCase();
    const amount = centsFrom(req.body.amount);
    const note = clean(req.body.note, 140);
    const key = clean(req.get('Idempotency-Key') || req.body.idempotencyKey, 80);
    if (!recipient) throw ApiError.badRequest('Find and choose a recipient.');
    if (!amount) throw ApiError.badRequest('Enter a valid positive test-credit amount.');
    if (!key) throw ApiError.badRequest('Transfer reference missing. Please try again.');

    try {
      db.exec('BEGIN IMMEDIATE');
      const prior = idempotency.lookup(req.user.sub, key);
      if (prior) { db.exec('COMMIT'); return res.json({ message: 'This transfer was already completed.', transactionId: prior.transactionId, duplicate: true }); }
      const receiver = db.prepare('SELECT id,name,username FROM users WHERE username=? OR email=?').get(recipient, recipient);
      if (!receiver) throw ApiError.badRequest('No Nota user matches that username or email.');
      if (Number(receiver.id) === Number(req.user.sub)) throw ApiError.badRequest('You cannot send test credits to yourself.');
      const wallet = db.prepare('SELECT balance_cents FROM wallets WHERE user_id=?').get(req.user.sub);
      if (!wallet || Number(wallet.balance_cents) < amount) throw ApiError.badRequest('Your test-credit balance is too low.');
      db.prepare('UPDATE wallets SET balance_cents=balance_cents-?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(amount, req.user.sub);
      db.prepare('UPDATE wallets SET balance_cents=balance_cents+?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(amount, receiver.id);
      const result = db.prepare(`INSERT INTO transactions (sender_id,receiver_id,amount_cents,currency,note,status,idempotency_key) VALUES (?,?,?,'EUR',?,'completed',?)`).run(req.user.sub, receiver.id, amount, note, key);
      const senderBalance = db.prepare('SELECT balance_cents FROM wallets WHERE user_id=?').get(req.user.sub);
      const receiverBalance = db.prepare('SELECT balance_cents FROM wallets WHERE user_id=?').get(receiver.id);
      recordTransfer(db, { transactionId: Number(result.lastInsertRowid), senderId: req.user.sub, receiverId: receiver.id, amountCents: amount, senderBalanceAfter: Number(senderBalance.balance_cents), receiverBalanceAfter: Number(receiverBalance.balance_cents) });
      db.exec('COMMIT');
      audit.record(EVENTS.TRANSFER_CREATED, { userId: req.user.sub, ip: req.ip, metadata: { transactionId: Number(result.lastInsertRowid), amountCents: amount, recipientId: Number(receiver.id) } });
      res.status(201).json({ message: `Sent to ${receiver.name}.`, recipient: { name: receiver.name, username: receiver.username }, transactionId: Number(result.lastInsertRowid) });
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      if (e instanceof ApiError) { audit.record(EVENTS.TRANSFER_REJECTED, { userId: req.user.sub, ip: req.ip, metadata: { reason: e.code } }); throw e; }
      if (idempotency.isDuplicateError(e)) {
        const duplicate = idempotency.lookup(req.user.sub, key);
        return res.status(200).json({ message: 'This transfer was already completed.', transactionId: duplicate?.transactionId, duplicate: true });
      }
      throw e;
    }
  }));
}

module.exports = { registerTransferRoutes };
