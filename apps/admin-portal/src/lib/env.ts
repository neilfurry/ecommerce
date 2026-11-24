/**
 * Developer tools appear in development builds, or when VITE_DEV_TOOLS_ENABLED=true.
 * The API independently refuses /dev/* unless DEV_TOOLS_ENABLED=true (never in production).
 */
export const DEV_TOOLS_UI_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS_ENABLED === 'true';

export const MAILPIT_URL = import.meta.env.VITE_MAILPIT_URL || 'http://localhost:8025';
