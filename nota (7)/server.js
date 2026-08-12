'use strict';

/** Nota — test-credit wallet server. Fictional credits only. */
const express = require('express');
const path = require('path');
const { requestIdMiddleware, log } = require('./lib/observability');
const { registerHealthRoutes } = require('./routes/health');
const { InlineJobRunner } = require('./services/job-runner');
const { registerMaintenanceJobs } = require('./services/maintenance-jobs');
const { loadConfig } = require('./lib/config');
const { openDatabase, seedDemoUsers } = require('./lib/db');
const { authMiddleware } = require('./lib/crypto-auth');
const { createSessionStore } = require('./lib/sessions');
const { createAuditLog } = require('./lib/audit');
const { createIdempotencyStore } = require('./lib/idempotency');
const { createRateLimiter } = require('./lib/rate-limit');
const { SqliteRateLimitStore } = require('./lib/rate-limit-store');
const { securityHeaders, notFoundApi, errorHandler } = require('./lib/security');
const { registerAuthRoutes, registerLogoutRoute } = require('./routes/auth');
const { registerAccountRoutes } = require('./routes/account');
const { registerTransferRoutes } = require('./routes/transfers');
const { registerPaymentRoutes, registerWebhookRoute } = require('./routes/payments');
const { DemoPaymentProvider } = require('./services/demo-payment-provider');
const { SandboxPaymentProvider } = require('./services/sandbox-payment-provider');
const { createSandboxTransferService } = require('./services/sandbox-transfer-service');
const { registerSandboxTransferRoutes } = require('./routes/sandbox-transfers');
const { createPaymentService } = require('./services/payment-service');
const { reconcilePayments } = require('./services/payment-reconciliation');
const { DemoIdentityProvider } = require('./services/identity-provider');
const { createIdentityService } = require('./services/identity-service');
const { registerIdentityRoutes, registerIdentityWebhookRoute, registerAccountStatusRoutes } = require('./routes/identity');
const { DemoRiskProvider } = require('./services/risk-provider');
const { createRiskEngine } = require('./services/risk-engine');
const { registerRiskRoutes } = require('./routes/risk');

const config = loadConfig();
const jobs = new InlineJobRunner();
const db = openDatabase(config.dbFile);
registerMaintenanceJobs(jobs, { db });
seedDemoUsers(db);
const app = express();
app.set('trust proxy', 1);
app.use(requestIdMiddleware);
app.use(securityHeaders);
app.use(express.json({
  limit: '20kb',
  verify: (req, _res, buffer) => {
    if (req.path === '/api/webhooks/payments' || req.path === '/api/webhooks/kyc') {
      req.rawBody = Buffer.from(buffer);
    }
  },
}));
app.use(express.static(path.join(__dirname, 'public')));
registerHealthRoutes(app, { db, config });

const audit = createAuditLog(db);
const sessions = createSessionStore(db, {
  accessTokenTtlSeconds: config.accessTokenTtlSeconds,
  refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
});
const auth = authMiddleware(config.jwtSecret, { sessions, isAdmin: (user) => {
  const row = db.prepare('SELECT username FROM users WHERE id=?').get(Number(user.sub));
  return Boolean(row && config.adminUsernames.has(String(row.username).toLowerCase()));
} });
const rateLimitStore = new SqliteRateLimitStore(db);
const idempotency = createIdempotencyStore(db);
const paymentProvider = config.paymentMode === 'sandbox' && !config.isTest ? new SandboxPaymentProvider() : new DemoPaymentProvider();
const paymentService = createPaymentService({ db, provider: paymentProvider, audit });
const reconcile = () => reconcilePayments({ db, provider: paymentProvider });
const identityProvider = new DemoIdentityProvider();
const identityService = createIdentityService({ db, provider: identityProvider, audit });
const riskProvider = new DemoRiskProvider();
const risk = createRiskEngine({ db, provider: riskProvider, audit });
const sandboxTransfers = createSandboxTransferService({ db, risk, audit });
const authLimiter = createRateLimiter({ store: rateLimitStore, windowMs: 15 * 60 * 1000, max: config.rateLimitAuthMax, message: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
const transferLimiter = createRateLimiter({ store: rateLimitStore, windowMs: 60 * 1000, max: config.rateLimitTransferMax, message: 'Too many transfers. Please wait a moment and try again.' });

app.use('/api/auth', authLimiter);
app.use('/api/transfers', transferLimiter);
registerAuthRoutes(app, { db, jwtSecret: config.jwtSecret, sessions, audit, accessTokenTtlSeconds: config.accessTokenTtlSeconds });
registerLogoutRoute(app, { auth, sessions, audit });
registerAccountRoutes(app, { db, auth, audit });
registerTransferRoutes(app, { db, auth, audit, idempotency, risk });
registerSandboxTransferRoutes(app, { db, auth, audit, service: sandboxTransfers });
registerPaymentRoutes(app, { db, auth, audit, paymentService, reconcile, risk });
registerWebhookRoute(app, { db, provider: paymentProvider, paymentService, webhookSecret: config.webhookSecret, audit });
registerIdentityRoutes(app, { db, auth, audit, identityService });
registerIdentityWebhookRoute(app, { db, provider: identityProvider, identityService, webhookSecret: config.webhookSecret, audit });
registerAccountStatusRoutes(app, { db, auth, audit });
registerRiskRoutes(app, { db, auth, risk, audit });
app.use('/api', notFoundApi);
app.use(errorHandler);

let httpServer;
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  httpServer = app.listen(port, () => log('info', 'server.started', { port, environment: config.nodeEnv }));
  jobs.start().catch((error) => log('error', 'jobs.start_failed', { error: error.message }));
  const shutdown = async (signal) => {
    log('info', 'server.shutdown_started', { signal });
    await jobs.stop();
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    if (db && typeof db.close === 'function') db.close();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = { app, db, config, sessions, audit, jobs };
