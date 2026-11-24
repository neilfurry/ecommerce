/**
 * Shared Jest settings for the NestJS apps (api, worker).
 *
 * NestJS 12 ships its packages as ES modules only. The apps are CommonJS and load Nest at
 * runtime through Node's require(esm) (Node 22.12+). Jest's module loader cannot do that
 * before Node 24.9, so SWC compiles both our TypeScript and Nest's ESM files to CommonJS.
 * See docs/adr/0006-nestjs-12-esm-and-commonjs-apps.md.
 */
const path = require('node:path');

const tsTransform = [
  '@swc/jest',
  {
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: 'es2023',
      keepClassNames: true,
    },
    module: { type: 'commonjs' },
    sourceMaps: 'inline',
  },
];

const jsTransform = [
  '@swc/jest',
  {
    jsc: { parser: { syntax: 'ecmascript' }, target: 'es2023', keepClassNames: true },
    module: { type: 'commonjs' },
  },
];

/** @returns {import('jest').Config} */
module.exports = function nestJestPreset() {
  const packagesDir = path.resolve(__dirname, 'packages');
  return {
    testEnvironment: 'node',
    moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
    transform: {
      '^.+\\.ts$': tsTransform,
      '^.+\\.m?js$': jsTransform,
    },
    // Transform ESM-only dependencies (@nestjs/*); leave everything else untouched.
    transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm|@nestjs)/)'],
    // Run shared workspace packages from source so tests never use stale builds.
    moduleNameMapper: {
      '^@marketplace/(types|validation|config)$': `${packagesDir}/$1/src`,
      // NodeNext-style relative imports ("./client.js") that point at .ts sources, as used by
      // the generated Prisma client.
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
  };
};
