'use strict';

const crypto = require('crypto');
const { STATES, assertTransition } = require('../lib/payment-state');

function json(value) { return JSON.stringify(value || {}); }
function parse(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }

function createPaymentService({ db, provider, audit }) {
  function getIntent(id) { return db.prepare('SELECT * FROM payment_intents WHERE id=?').get(id); }

  function recordStatus(intentId, fromStatus, toStatus, source, reference = '') {
    assertTransition(fromStatus, toStatus);
    if (fromStatus === toStatus) return;
    db.prepare('INSERT INTO payment_status_history(payment_intent_id,from_status,to_status,source,reference) VALUES(?,?,?,?,?)').run(intentId, fromStatus, toStatus, source, reference);
    db.prepare('UPDATE payment_intents SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(toStatus, intentId);
  }

  function createIntent({ userId, amountCents, currency = 'EUR', idempotencyKey, metadata = {} }) {
    const existing = db.prepare('SELECT * FROM payment_intents WHERE user_id=? AND idempotency_key=?').get(userId, idempotencyKey);
    if (existing) return { intent: existing, duplicate: true };
    const id = `pi_${crypto.randomUUID()}`;
    const providerIntent = provider.createPaymentIntent({ amountCents, currency, idempotencyKey, outcome: metadata.requestedOutcome });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO payment_intents(id,user_id,provider,provider_intent_id,amount_cents,currency,status,idempotency_key,metadata) VALUES(?,?,?,?,?,?,?,?,?)').run(id, userId, provider.name, providerIntent.providerIntentId, amountCents, currency, STATES.PENDING, idempotencyKey, json(metadata));
      db.prepare('INSERT INTO payment_status_history(payment_intent_id,to_status,source,reference) VALUES(?,?,?,?)').run(id, STATES.CREATED, 'api', 'created');
      db.prepare('INSERT INTO payment_status_history(payment_intent_id,from_status,to_status,source,reference) VALUES(?,?,?,?,?)').run(id, STATES.CREATED, STATES.PENDING, 'api', 'provider-created');
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    if (providerIntent.status !== STATES.CREATED) applyProviderStatus(id, providerIntent.status, 'provider', providerIntent.providerIntentId);
    return { intent: getIntent(id), duplicate: false };
  }

  function applyProviderStatus(id, status, source = 'webhook', reference = '') {
    const intent = getIntent(id);
    if (!intent) throw Object.assign(new Error('Payment intent not found'), { status: 404, expose: true });
    const next = status === 'succeeded' ? STATES.SUCCEEDED : status;
    if (!['pending','authorized','succeeded','failed','cancelled','refunded'].includes(next)) throw new Error('Unknown provider payment status');
    if (intent.status === next) return { intent, changed: false };
    if (typeof provider.setPaymentStatus === 'function') provider.setPaymentStatus(intent.provider_intent_id, next);
    db.exec('BEGIN IMMEDIATE');
    try {
      recordStatus(id, intent.status, next, source, reference);
      if (next === STATES.SUCCEEDED && !intent.credited_at) {
        db.prepare('UPDATE wallets SET balance_cents=balance_cents+?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(Number(intent.amount_cents), Number(intent.user_id));
        db.prepare('UPDATE payment_intents SET credited_at=CURRENT_TIMESTAMP WHERE id=? AND credited_at IS NULL').run(id);
      }
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    return { intent: getIntent(id), changed: true };
  }

  function refund({ userId, intentId, amountCents, reason = '' }) {
    const intent = getIntent(intentId);
    if (!intent || Number(intent.user_id) !== Number(userId)) throw Object.assign(new Error('Payment intent not found'), { status: 404, expose: true });
    const refund = provider.refundPayment({ providerIntentId: intent.provider_intent_id, amountCents });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO payment_refunds(id,payment_intent_id,provider,provider_refund_id,amount_cents,status,reason) VALUES(?,?,?,?,?,?,?)').run(`re_${crypto.randomUUID()}`, intentId, provider.name, refund.providerRefundId, refund.amountCents, refund.status, reason);
      if (refund.status === 'succeeded') recordStatus(intentId, intent.status, STATES.REFUNDED, 'refund', refund.providerRefundId);
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    audit?.record('payment.refunded', { userId, metadata: { intentId, amountCents: refund.amountCents } });
    return { refund, intent: getIntent(intentId) };
  }

  return { getIntent, createIntent, applyProviderStatus, refund, recordStatus };
}

module.exports = { createPaymentService, parse };
