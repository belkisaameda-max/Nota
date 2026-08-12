'use strict';

const crypto = require('crypto');

class SandboxPaymentProvider {
  constructor() {
    this.name = 'nota-sandbox';
    this.mode = 'sandbox';
  }

  createPayment({ amountCents, currency = 'EUR', outcome = 'pending' }) {
    const providerIntentId = `sandbox_pi_${crypto.randomUUID()}`;
    const status = ['pending', 'succeeded', 'failed', 'cancelled'].includes(outcome) ? outcome : 'pending';
    return { providerIntentId, status, amountCents, currency };
  }

  refundPayment({ providerIntentId, amountCents }) {
    return { providerRefundId: `sandbox_re_${crypto.randomUUID()}`, status: 'succeeded', amountCents, providerIntentId };
  }

  verifyWebhook({ payload, signature, secret }) {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const provided = String(signature || '');
    return provided.length === expected.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  }

  parseWebhook(payload) {
    const event = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return { id: String(event.id || ''), type: String(event.type || ''), paymentIntentId: String(event.paymentIntentId || ''), status: String(event.status || '') };
  }
}

module.exports = { SandboxPaymentProvider };
