/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** "true" shows the Developer tools pages in a production build (never in real production). */
  readonly VITE_DEV_TOOLS_ENABLED?: string;
  readonly VITE_MAILPIT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
