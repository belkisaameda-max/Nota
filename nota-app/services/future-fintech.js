'use strict';

/**
 * Nota future-fintech boundary
 * =================================================================
 * Nothing in this file is implemented, connected, or reachable from
 * server.js. It exists only to document the shape of a possible
 * future regulated real-money integration, per ARCHITECTURE.md.
 *
 * Every method below fails closed: calling any of them throws
 * immediately. That is intentional. This module must never be able
 * to move real money, touch real bank accounts, or silently become
 * load-bearing just because a method has a plausible-looking body.
 *
 * Future work that wants to build a real-money product must:
 *   1. Select and contract with licensed providers for each role.
 *   2. Create a separate real-money ledger, isolated from the
 *      test-credit wallet/ledger in server.js.
 *   3. Implement real authorization, reconciliation, compliance,
 *      and audit controls before any of these methods do anything.
 *   4. Replace this file (or the relevant class) with a real
 *      implementation behind these same disabled contracts, only
 *      after that work is done and reviewed.
 * =================================================================
 */

class NotImplementedFintechBoundary extends Error {
  constructor(providerName, method) {
    super(
      `${providerName}.${method}() is a disabled future-fintech interface. ` +
      'Nota v0.1 only operates a local test-credit wallet and must never ' +
      'reach a real-money provider. See ARCHITECTURE.md.'
    );
    this.name = 'NotImplementedFintechBoundary';
    this.provider = providerName;
    this.method = method;
  }
}

function fail(providerName, method) {
  throw new NotImplementedFintechBoundary(providerName, method);
}

/**
 * Moves real money between two authorized, licensed-provider-held
 * accounts. Conceptual counterpart to the test-wallet transfer in
 * server.js — never to be merged with it.
 */
class PaymentProvider {
  async authorizePayment(_request) { fail('PaymentProvider', 'authorizePayment'); }
  async capturePayment(_authorizationId) { fail('PaymentProvider', 'capturePayment'); }
  async reversePayment(_paymentId, _reason) { fail('PaymentProvider', 'reversePayment'); }
  async getPaymentStatus(_paymentId) { fail('PaymentProvider', 'getPaymentStatus'); }
}

/**
 * Links and verifies external real bank accounts for deposits and
 * withdrawals. Nota currently has no deposit or withdrawal path
 * of any kind.
 */
class BankAccountProvider {
  async linkAccount(_userId, _accountToken) { fail('BankAccountProvider', 'linkAccount'); }
  async verifyMicroDeposits(_linkId, _amounts) { fail('BankAccountProvider', 'verifyMicroDeposits'); }
  async initiateDeposit(_linkId, _amountCents) { fail('BankAccountProvider', 'initiateDeposit'); }
  async initiateWithdrawal(_linkId, _amountCents) { fail('BankAccountProvider', 'initiateWithdrawal'); }
  async unlinkAccount(_linkId) { fail('BankAccountProvider', 'unlinkAccount'); }
}

/**
 * Converts between currencies at a real, provider-quoted rate.
 * Nota has no exchange service and generates no fake real-money
 * rates anywhere in the app. A future FX record would need:
 *   sourceCurrency, targetCurrency, sourceAmountCents,
 *   targetAmountCents, rate, feeCents, provider, quotedAt.
 */
class CurrencyExchangeProvider {
  async getQuote(_sourceCurrency, _targetCurrency, _sourceAmountCents) {
    fail('CurrencyExchangeProvider', 'getQuote');
  }
  async executeExchange(_quoteId) { fail('CurrencyExchangeProvider', 'executeExchange'); }
}

/**
 * Real-identity KYC verification. The current Nota user account
 * is a test-only application account and performs no identity
 * verification of any kind.
 */
class IdentityVerificationProvider {
  async startVerification(_userId, _documents) { fail('IdentityVerificationProvider', 'startVerification'); }
  async getVerificationStatus(_verificationId) { fail('IdentityVerificationProvider', 'getVerificationStatus'); }
}

/**
 * Real-money fraud and risk scoring. Nota's test wallet has basic
 * application-layer validation only (ownership, balance, recipient,
 * amount, idempotency) and no fraud detection of any kind.
 */
class FraudDetectionProvider {
  async scoreTransaction(_transactionDetails) { fail('FraudDetectionProvider', 'scoreTransaction'); }
  async reportConfirmedFraud(_transactionId, _details) { fail('FraudDetectionProvider', 'reportConfirmedFraud'); }
}

module.exports = {
  NotImplementedFintechBoundary,
  PaymentProvider,
  BankAccountProvider,
  CurrencyExchangeProvider,
  IdentityVerificationProvider,
  FraudDetectionProvider,
};
