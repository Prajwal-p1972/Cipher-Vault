/**
 * Frontend runtime configuration.
 * Local AI requests must target the receiver's local machine directly without proxying.
 */
export const AI_URL = import.meta.env.VITE_LOCAL_AI_URL || 'http://127.0.0.1:8000';
