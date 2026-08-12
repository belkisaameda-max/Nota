'use strict';

class RiskProvider {
  constructor(name = 'demo-risk') { this.name = name; }
  evaluate() { throw new Error('Risk provider evaluate() must be implemented'); }
}

class DemoRiskProvider extends RiskProvider {
  constructor() { super('demo-risk'); }
  evaluate({ scenario = 'LOW_RISK', signals = {} } = {}) {
    const key = String(scenario).toUpperCase();
    const presets = {
      LOW_RISK: { score: 10, decision: 'allow', reasons: [] },
      MEDIUM_RISK: { score: 45, decision: 'review', reasons: ['MEDIUM_PROVIDER_SIGNAL'] },
      HIGH_RISK: { score: 82, decision: 'review', reasons: ['HIGH_PROVIDER_SIGNAL'] },
      BLOCKED: { score: 100, decision: 'deny', reasons: ['BLOCKED_PROVIDER_SIGNAL'] },
    };
    const result = presets[key] || presets.LOW_RISK;
    return { ...result, provider: this.name, signals: Object.keys(signals).slice(0, 12) };
  }
}

module.exports = { RiskProvider, DemoRiskProvider }; 
