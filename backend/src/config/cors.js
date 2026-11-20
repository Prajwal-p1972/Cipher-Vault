import { env } from './env.js';

/**
 * Extracts a clean URL from a string that may contain markdown formatting, quotes, or extra whitespace.
 * e.g. "[https://example.com](https://example.com)" -> "https://example.com"
 *
 * @param {string} str
 * @returns {string}
 */
export function extractCleanUrl(str) {
  if (!str) return '';
  const match = str.match(/https?:\/\/[^\s)\]'"]+/);
  return match ? match[0] : str.trim();
}

/**
 * Validates whether an incoming HTTP/WebSocket origin is permitted.
 * Whitelists configured CLIENT_ORIGIN (supporting comma-separated origins and wildcard patterns),
 * local development ports (localhost:3000, 127.0.0.1:3000), Cloudflare Tunnel subdomains
 * (*.trycloudflare.com), and Vercel cloud deployments (*.vercel.app).
 *
 * @param {string|null|undefined} origin
 * @returns {boolean}
 */
export function isAllowedOrigin(origin) {
  // Allow requests with no origin (e.g. mobile apps, curl, server-side tools, same-origin)
  if (!origin) {
    return true;
  }

  // Parse comma-separated origins configured via CLIENT_ORIGIN
  const rawOrigins = (env.CLIENT_ORIGIN || '')
    .split(',')
    .map((s) => extractCleanUrl(s.trim()))
    .filter(Boolean);

  for (const allowed of rawOrigins) {
    if (allowed === origin) {
      return true;
    }
    // Wildcard matching e.g. https://*.vercel.app or https://*-team.vercel.app
    if (allowed.includes('*')) {
      const regexPattern = '^' + allowed
        .replace(/[-[\]/{}()+?.\\^$|]/g, '\\$&')
        .replace(/\\\*/g, '.*') + '$';
      try {
        if (new RegExp(regexPattern, 'i').test(origin)) {
          return true;
        }
      } catch (_) {}
    }
  }

  // Exact matches for local development
  if (
    origin === 'http://localhost:3000' ||
    origin === 'http://127.0.0.1:3000' ||
    origin === 'http://localhost:5000' ||
    origin === 'http://127.0.0.1:5000'
  ) {
    return true;
  }

  try {
    const url = new URL(origin);
    // Allow local hosts with any port in development
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return true;
    }
    // Allow Cloudflare Tunnel subdomains
    if (url.hostname.endsWith('.trycloudflare.com')) {
      return true;
    }
    // Allow Vercel deployment subdomains (preview and production)
    if (url.hostname === 'vercel.app' || url.hostname.endsWith('.vercel.app')) {
      return true;
    }
  } catch (_) {
    return false;
  }

  return false;
}
