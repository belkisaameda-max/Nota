'use strict';

class DemoIdentityProvider {
  constructor() { this.name = 'demo-kyc'; this.checks = new Map(); }
  createCheck({ userId, outcome = 'verified' }) {
    const providerCheckId = `demo_check_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const normalized = ['verified', 'rejected', 'needs_review', 'pending'].includes(outcome) ? outcome : 'verified';
    const riskScore = normalized === 'verified' ? 8 : normalized === 'needs_review' ? 62 : normalized === 'rejected' ? 94 : null;
    const check = { providerCheckId, status: normalized, riskScore, sanctionsResult: normalized === 'rejected' ? 'match' : 'clear', documentResult: normalized === 'rejected' ? 'rejected' : 'verified' };
    this.checks.set(providerCheckId, check);
    return check;
  }
  getCheck(providerCheckId) { return this.checks.get(providerCheckId) || null; }
  verifyWebhook(raw, signature, secret) {
    const crypto = require('node:crypto');
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    return typeof signature === 'string' && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
}
module.exports = { DemoIdentityProvider };
