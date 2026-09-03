const configuredApiBase = String(import.meta.env.VITE_API_BASE_URL || '').trim();

export const API = (configuredApiBase || (import.meta.env.DEV ? 'http://localhost:4003' : ''))
  .replace(/\/+$/, '');
