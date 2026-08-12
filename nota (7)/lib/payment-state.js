'use strict';

const STATES = Object.freeze({
  CREATED: 'created',
  PENDING: 'pending',
  AUTHORIZED: 'authorized',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
});

const TERMINAL = new Set([STATES.SUCCEEDED, STATES.FAILED, STATES.CANCELLED, STATES.REFUNDED]);
const TRANSITIONS = Object.freeze({
  created: new Set(['pending', 'cancelled']),
  pending: new Set(['authorized', 'succeeded', 'failed', 'cancelled']),
  authorized: new Set(['succeeded', 'failed', 'cancelled']),
  succeeded: new Set(['refunded']),
  failed: new Set(),
  cancelled: new Set(),
  refunded: new Set(),
});

function canTransition(from, to) {
  return from === to || Boolean(TRANSITIONS[from]?.has(to));
}
function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const error = new Error(`Invalid payment state transition: ${from} -> ${to}`);
    error.code = 'INVALID_PAYMENT_TRANSITION';
    error.status = 409;
    error.expose = true;
    throw error;
  }
}
function isTerminal(status) { return TERMINAL.has(status); }

module.exports = { STATES, canTransition, assertTransition, isTerminal };
