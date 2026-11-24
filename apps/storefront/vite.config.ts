import { defineConfig } from 'vitest/config';
import { createAppConfig } from '../../vite.shared.mts';

export default defineConfig(({ mode }) => createAppConfig({ port: 5173, mode }));
