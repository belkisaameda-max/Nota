'use strict';

const crypto = require('crypto');
const { PaymentProvider } = require('./payment-provider');

class DemoPaymentProvider extends PaymentProvider {
  constructor() { super('demo'); this.intents = new Map(); this.events = new Map(); }

  createPaymentIntent({ amountCents, currency = 'EUR', idempotencyKey, outcome = 'succeeded' }) {
    const existing = [...this.intents.values()].find((v) => v.idempotencyKey === idempotencyKey);
    if (existing) return existing;
    const id = `demo_pi_${crypto.randomUUID()}`;
    const status = ['succeeded', 'failed', 'cancelled'].includes(outcome) ? outcome : 'pending';
    const intent = { provider: this.name, providerIntentId: id, amountCents: Number(amountCents), currency, idempotencyKey, status };
    this.intents.set(id, intent);
    return intent;
  }

  setPaymentStatus(providerIntentId, status) {
    const intent = this.getPaymentStatus(providerIntentId);
    intent.status = status;
    return intent;
  }

  getPaymentStatus(providerIntentId) {
    const intent = this.intents.get(providerIntentId);
    if (!intent) throw Object.assign(new Error('Demo payment intent not found'), { code: 'PROVIDER_NOT_FOUND', status: 404, expose: true });
    return intent;
  }

  refundPayment({ providerIntentId, amountCents }) {
    const intent = this.getPaymentStatus(providerIntentId);
    if (intent.status !== 'succeeded') throw Object.assign(new Error('Only succeeded demo payments can be refunded'), { code: 'REFUND_NOT_ALLOWED', status: 409, expose: true });
    return { provider: this.name, providerRefundId: `demo_re_${crypto.randomUUID()}`, providerIntentId, amountCents: Number(amountCents || intent.amountCents), status: 'succeeded' };
  }

  createPayout({ amountCents, currency = 'EUR', idempotencyKey }) {
    return { provider: this.name, providerPayoutId: `demo_po_${crypto.randomUUID()}`, amountCents: Number(amountCents), currency, idempotencyKey, status: 'succeeded' };
  }

  verifyWebhook({ payload, signature, secret }) {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return typeof signature === 'string' && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  parseWebhook(payload) { return JSON.parse(payload); }

  emitWebhook(providerIntentId, status) {
    const event = { id: `demo_evt_${crypto.randomUUID()}`, type: `payment.${status}`, paymentIntentId: providerIntentId, status };
    this.events.set(event.id, event);
    return event;
  }

  signWebhook(event, secret) {
    const payload = JSON.stringify(event);
    return { payload, signature: crypto.createHmac('sha256', secret).update(payload).digest('hex') };
  }
}

module.exports = { DemoPaymentProvider };
