let accessToken = null;
let refreshPromise = null;

const rawApiUrl = (import.meta.env?.VITE_API_URL || '').trim().replace(/\/+$/, '');

/**
 * Resolves a request path against VITE_API_URL if configured.
 * Relative paths fall back to the same origin (compatible with Vite local dev proxying).
 * Prevents duplicate '/api' segments when both VITE_API_URL and path contain '/api'.
 *
 * @param {string} path
 * @returns {string}
 */
export function resolveUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // If VITE_API_URL is empty or relative dev proxy ('/api' or '/'), keep path relative
  if (!rawApiUrl || rawApiUrl === '/api' || rawApiUrl === '/') {
    return cleanPath;
  }

  // Prevent '/api/api/...' if rawApiUrl ends with '/api' and cleanPath starts with '/api'
  if (rawApiUrl.endsWith('/api') && cleanPath.startsWith('/api')) {
    return `${rawApiUrl}${cleanPath.slice(4)}`;
  }

  return `${rawApiUrl}${cleanPath}`;
}

/**
 * Custom error class wrapping HTTP error status and structured error details.
 */
export class ApiError extends Error {
  constructor(status, message, details = null, code = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

/**
 * Returns active in-memory access token.
 *
 * @returns {string|null}
 */
export function getAccessToken() {
  return accessToken;
}

/**
 * Sets active in-memory access token.
 *
 * @param {string|null} token
 */
export function setAccessToken(token) {
  accessToken = token;
}

/**
 * Clears active in-memory access token.
 */
export function clearAccessToken() {
  accessToken = null;
}

/**
 * Performs a single-flight session refresh via HttpOnly cookie.
 * Multiple simultaneous calls share the exact same underlying promise.
 *
 * @returns {Promise<{ accessToken: string, user: object }>}
 */
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(resolveUrl('/api/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new ApiError(
            res.status,
            data.error || 'Session refresh failed',
            data.details
          );
        }

        const data = await res.json();
        setAccessToken(data.accessToken);
        return data;
      } catch (err) {
        clearAccessToken();
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('auth:logout'));
        }
        throw err;
      } finally {
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
}

/**
 * Universal authenticated fetch client.
 * Enforces credentials:'include', auto-injects Bearer token,
 * handles JSON encoding/decoding, and retries once on 401 via single-flight refresh.
 *
 * @param {string} path - URL path
 * @param {{
 *   method?: string,
 *   body?: any,
 *   formData?: FormData,
 *   token?: string,
 *   _isRetry?: boolean
 * }} [options={}]
 * @returns {Promise<any>}
 */
export async function request(path, options = {}) {
  const {
    method = 'GET',
    body,
    formData,
    token,
    _isRetry = false
  } = options;

  const headers = {};
  const effectiveToken = token || accessToken;

  if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`;
  }

  let requestBody = body;
  if (formData || (typeof FormData !== 'undefined' && body instanceof FormData)) {
    requestBody = formData || body;
  } else if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(resolveUrl(path), {
    method,
    headers,
    body: requestBody,
    credentials: 'include'
  });

  // Handle 401 on authenticated call: single-flight refresh and retry exactly once
  if (
    response.status === 401 &&
    !_isRetry &&
    effectiveToken &&
    !path.endsWith('/api/auth/login') &&
    !path.endsWith('/api/auth/refresh')
  ) {
    const refreshData = await refreshSession();
    return request(path, {
      ...options,
      token: refreshData.accessToken,
      _isRetry: true
    });
  }

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.error || response.statusText || 'Request failed',
      data.details,
      data.code
    );
  }

  return data;
}

/**
 * Universal authenticated fetch client returning raw Blob data.
 * Enforces credentials:'include', auto-injects Bearer token,
 * handles 401 via single-flight refresh, and parses errors as JSON into ApiError including `code`.
 *
 * @param {string} path - URL path
 * @param {{
 *   method?: string,
 *   body?: any,
 *   formData?: FormData,
 *   token?: string,
 *   _isRetry?: boolean
 * }} [options={}]
 * @returns {Promise<{ blob: Blob, headers: Headers, status: number }>}
 */
export async function requestBlob(path, options = {}) {
  const {
    method = 'GET',
    body,
    formData,
    token,
    _isRetry = false
  } = options;

  const headers = {};
  const effectiveToken = token || accessToken;

  if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`;
  }

  let requestBody = body;
  if (formData || (typeof FormData !== 'undefined' && body instanceof FormData)) {
    requestBody = formData || body;
  } else if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(resolveUrl(path), {
    method,
    headers,
    body: requestBody,
    credentials: 'include'
  });

  // Handle 401 on authenticated call: single-flight refresh and retry exactly once
  if (
    response.status === 401 &&
    !_isRetry &&
    effectiveToken &&
    !path.endsWith('/api/auth/login') &&
    !path.endsWith('/api/auth/refresh')
  ) {
    const refreshData = await refreshSession();
    return requestBlob(path, {
      ...options,
      token: refreshData.accessToken,
      _isRetry: true
    });
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      errorData.error || response.statusText || 'Request failed',
      errorData.details,
      errorData.code
    );
  }

  const blob = await response.blob();
  return {
    blob,
    headers: response.headers,
    status: response.status
  };
}
