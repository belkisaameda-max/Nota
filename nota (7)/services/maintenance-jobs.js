function registerMaintenanceJobs(jobs, { db, audit }) {
  jobs.register('cleanup-auth', () => {
    const sessions = db.prepare("DELETE FROM sessions WHERE revoked_at IS NOT NULL OR expires_at < datetime('now')").run();
    const tokens = db.prepare("DELETE FROM used_refresh_tokens WHERE rotated_at < datetime('now','-30 days')").run();
    audit?.record('maintenance.auth_cleanup', { metadata: { sessions: Number(sessions.changes), tokens: Number(tokens.changes) } });
    return { sessions: Number(sessions.changes), tokens: Number(tokens.changes) };
  });
  jobs.register('cleanup-webhooks', () => {
    const payments = db.prepare("DELETE FROM payment_webhook_events WHERE processed_at IS NOT NULL AND created_at < datetime('now','-90 days')").run();
    const kyc = db.prepare("DELETE FROM kyc_webhook_events WHERE processed_at IS NOT NULL AND created_at < datetime('now','-90 days')").run();
    return { payments: Number(payments.changes), kyc: Number(kyc.changes) };
  });
}

module.exports = { registerMaintenanceJobs };
