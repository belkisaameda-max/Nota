'use strict';

/** Trim and length-limit a string value. */
function clean(value, maxLen) {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : '';
}

function emailOK(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function usernameOK(value) {
  return /^[a-zA-Z0-9_]{3,24}$/.test(value);
}

/**
 * Parse a positive amount (max 1_000_000) into integer cents.
 * Returns null when invalid.
 */
function centsFrom(value) {
  const n = Number(value);
  const c = Math.round(n * 100);
  return Number.isFinite(n) && n > 0 && n <= 1000000 && Math.abs(n * 100 - c) < 1e-7
    ? c
    : null;
}

/**
 * Clamp a requested page size into a safe range.
 * Returns a positive integer between 1 and `max`.
 */
function limitFrom(value, def = 20, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(Math.floor(n), max);
}

module.exports = { clean, emailOK, usernameOK, centsFrom, limitFrom };
