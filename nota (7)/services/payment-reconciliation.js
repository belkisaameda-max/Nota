'use strict';

function reconcilePayments({ db, provider }) {
  const rows = db.prepare("SELECT * FROM payment_intents WHERE provider=? AND status NOT IN ('refunded','failed','cancelled') ORDER BY created_at ASC").all(provider.name);
  const mismatches = [];
  for (const intent of rows) {
    let remote;
    try { remote = provider.getPaymentStatus(intent.provider_intent_id); } catch (error) { mismatches.push({ paymentIntentId: intent.id, reason: 'provider_lookup_failed', detail: error.code || error.message }); continue; }
    if (remote.status !== intent.status && !(intent.status === 'created' && remote.status === 'pending')) {
      mismatches.push({ paymentIntentId: intent.id, localStatus: intent.status, providerStatus: remote.status });
    }
  }
  return { provider: provider.name, checked: rows.length, mismatches };
}

module.exports = { reconcilePayments };
