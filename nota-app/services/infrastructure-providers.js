class PostgresProvider {
  constructor({ pool }) { this.pool = pool; this.name = 'postgres'; }
  async query(text, values = []) { return this.pool.query(text, values); }
  async close() { if (typeof this.pool.end === 'function') await this.pool.end(); }
}

class RedisProvider {
  constructor({ client }) { this.client = client; this.name = 'redis'; }
  async get(key) { return this.client.get(key); }
  async set(key, value, options) { return this.client.set(key, value, options); }
  async del(key) { return this.client.del(key); }
  async close() { if (typeof this.client.quit === 'function') await this.client.quit(); }
}

module.exports = { PostgresProvider, RedisProvider };
