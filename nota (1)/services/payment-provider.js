'use strict';

class PaymentProvider {
  constructor(name) { this.name = name; }
  createPaymentIntent() { throw new Error('Provider must implement createPaymentIntent'); }
  getPaymentStatus() { throw new Error('Provider must implement getPaymentStatus'); }
  refundPayment() { throw new Error('Provider must implement refundPayment'); }
  createPayout() { throw new Error('Provider must implement createPayout'); }
  verifyWebhook() { throw new Error('Provider must implement verifyWebhook'); }
  parseWebhook() { throw new Error('Provider must implement parseWebhook'); }
}

function assertProvider(provider) {
  if (!(provider instanceof PaymentProvider)) throw new TypeError('Invalid payment provider');
  return provider;
}

module.exports = { PaymentProvider, assertProvider };
