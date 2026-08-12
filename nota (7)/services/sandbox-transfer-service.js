'use strict';

const crypto = require('crypto');
const { ApiError } = require('../lib/errors');

function createSandboxTransferService({ db, risk, audit }) {
  function create({ userId, recipientId, amountCents, idempotencyKey, metadata = {} }) {
    const existing = db.prepare('SELECT * FROM sandbox_transfers WHERE user_id=? AND idempotency_key=?').get(Number(userId), idempotencyKey);
    if (existing) return { transfer: existing, duplicate: true };
    if (Number(userId) === Number(recipientId)) throw ApiError.badRequest('Choose a different recipient.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const wallet = db.prepare('SELECT balance_cents FROM wallets WHERE user_id=?').get(Number(userId));
      if (!wallet || Number(wallet.balance_cents) < amountCents) throw ApiError.conflict('Your test-credit balance is too low.', 'INSUFFICIENT_FUNDS');
      const recipient = db.prepare('SELECT id FROM users WHERE id=? AND account_status=\'active\'').get(Number(recipientId));
      if (!recipient) throw ApiError.notFound('Recipient not found.');
      const riskResult = risk.evaluate({ userId, evaluationType: 'transfer', subjectType: 'sandbox_transfer', subjectId: idempotencyKey, idempotencyKey: `sandbox-transfer:${userId}:${idempotencyKey}`, scenario: metadata.demoRiskScenario || 'LOW_RISK', signals: { amountCents } });
      const status = riskResult.evaluation.decision === 'review' ? 'under_review' : 'succeeded';
      const id = `st_${crypto.randomUUID()}`;
      const providerTransferId = `sandbox_tr_${crypto.randomUUID()}`;
      db.prepare('INSERT INTO sandbox_transfers(id,user_id,recipient_id,amount_cents,currency,status,idempotency_key,provider_transfer_id,metadata) VALUES(?,?,?,?,?,?,?,?,?)').run(id, Number(userId), Number(recipientId), amountCents, 'EUR', status, idempotencyKey, providerTransferId, JSON.stringify({ demoOnly: true }));
      if (status === 'succeeded') {
        db.prepare('UPDATE wallets SET balance_cents=balance_cents-?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(amountCents, Number(userId));
        db.prepare('UPDATE wallets SET balance_cents=balance_cents+?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(amountCents, Number(recipientId));
      }
      db.exec('COMMIT');
      audit.record('sandbox.transfer_created', { userId, metadata: { transferId: id, recipientId, amountCents, status } });
      return { transfer: db.prepare('SELECT * FROM sandbox_transfers WHERE id=?').get(id), duplicate: false };
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  }

  function listForUser(userId, limit = 50) {
    return db.prepare('SELECT t.*, u.username AS recipient_username FROM sandbox_transfers t JOIN users u ON u.id=t.recipient_id WHERE t.user_id=? OR t.recipient_id=? ORDER BY t.created_at DESC, t.id DESC LIMIT ?').all(Number(userId), Number(userId), limit);
  }

  return { create, listForUser };
}

module.exports = { createSandboxTransferService };
