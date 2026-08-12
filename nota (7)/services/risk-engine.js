'use strict';
const crypto = require('crypto');
const { ApiError } = require('../lib/errors');

function band(score) { return score < 30 ? 'low' : score < 70 ? 'medium' : 'high'; }
function json(value) { return JSON.stringify(value || {}); }

function createRiskEngine({ db, provider, audit }) {
  function velocity(userId, type, minutes = 10) {
    const since = new Date(Date.now() - minutes * 60000).toISOString();
    if (type === 'transfer') return Number(db.prepare("SELECT COUNT(*) count FROM transactions WHERE sender_id=? AND created_at >= ?").get(Number(userId), since).count);
    if (type === 'payment') return Number(db.prepare("SELECT COUNT(*) count FROM payment_intents WHERE user_id=? AND created_at >= ?").get(Number(userId), since).count);
    return 0;
  }

  function evaluate({ userId, evaluationType, subjectType, subjectId, paymentIntentId = null, transactionId = null, idempotencyKey, scenario = 'LOW_RISK', signals = {} }) {
    if (!idempotencyKey) throw ApiError.badRequest('Risk evaluation idempotency key is required.', 'RISK_IDEMPOTENCY_REQUIRED');
    const prior = db.prepare('SELECT * FROM risk_evaluations WHERE provider=? AND idempotency_key=?').get(provider.name, idempotencyKey);
    if (prior) return { evaluation: prior, duplicate: true };
    const velocityCount = velocity(userId, evaluationType === 'transfer' ? 'transfer' : evaluationType === 'payment' ? 'payment' : 'none');
    const enriched = { ...signals, velocityCount };
    const result = provider.evaluate({ scenario, signals: enriched });
    const reasons = [...result.reasons];
    if (velocityCount >= 5) { reasons.push('VELOCITY_LIMIT'); result.score = Math.max(result.score, 78); result.decision = 'review'; }
    const score = Math.max(0, Math.min(100, Number(result.score)));
    const decision = result.decision === 'deny' ? 'deny' : result.decision === 'review' || score >= 70 ? 'review' : 'allow';
    const id = `risk_${crypto.randomUUID()}`;
    const evaluation = { id, provider: provider.name, evaluationType, subjectType, subjectId: String(subjectId), userId, paymentIntentId, transactionId, score, band: band(score), decision, reasonCodes: reasons, createdAt: new Date().toISOString() };
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO risk_evaluations(id,provider,evaluation_type,subject_type,subject_id,user_id,payment_intent_id,transaction_id,score,band,decision,reason_codes,idempotency_key,metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, provider.name, evaluationType, subjectType, String(subjectId), userId == null ? null : Number(userId), paymentIntentId, transactionId, score, band(score), decision, JSON.stringify(reasons), idempotencyKey, json({ signals: enriched }));
      if (decision !== 'allow' && userId != null) {
        const severity = score >= 90 ? 'critical' : score >= 70 ? 'high' : 'medium';
        db.prepare('INSERT INTO risk_cases(id,user_id,evaluation_id,payment_intent_id,transaction_id,severity,status,reason_codes) VALUES(?,?,?,?,?,?,?,?)').run(`case_${crypto.randomUUID()}`, Number(userId), id, paymentIntentId, transactionId, severity, 'open', JSON.stringify(reasons));
      }
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    audit?.record(`risk.decision_${decision}`, { userId, metadata: { evaluationId: id, evaluationType, decision, score, reasonCodes: reasons } });
    return { evaluation: db.prepare('SELECT * FROM risk_evaluations WHERE id=?').get(id), duplicate: false };
  }

  return { evaluate, velocity };
}
module.exports = { createRiskEngine, band }; 
