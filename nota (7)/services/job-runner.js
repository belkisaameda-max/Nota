class InlineJobRunner {
  constructor() { this.handlers = new Map(); this.running = false; }
  register(name, handler) { this.handlers.set(name, handler); return this; }
  async run(name, payload = {}) {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Unknown job: ${name}`);
    return handler(payload);
  }
  async start() { this.running = true; }
  async stop() { this.running = false; }
}

class QueueJobRunner {
  constructor({ enqueue }) { this.enqueue = enqueue; }
  register() { return this; }
  async run(name, payload = {}) { return this.enqueue({ name, payload }); }
  async start() {}
  async stop() {}
}

module.exports = { InlineJobRunner, QueueJobRunner };
