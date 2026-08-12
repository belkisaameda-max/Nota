function registerHealthRoutes(app, { db, config }) {
  app.get('/health/live', (_req, res) => res.json({ ok: true, service: 'nota' }));
  app.get('/health/ready', (_req, res) => {
    try {
      db.prepare('SELECT 1 AS ok').get();
      res.json({ ok: true, service: 'nota', database: 'ok', environment: config.env });
    } catch {
      res.status(503).json({ ok: false, service: 'nota', database: 'unavailable' });
    }
  });
}

module.exports = { registerHealthRoutes };
