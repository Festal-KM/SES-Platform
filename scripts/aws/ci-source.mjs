import { isExcludedSource } from './source-files.mjs';
export function includeCiSource(file) {
  if (isExcludedSource(file) || file.includes('..') || file.startsWith('/')) return false;
  return /^(apps|packages|scripts|docker|prompts|seed|tests|infra\/aws)\//.test(file)
    || ['docker-compose.yml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.tests.json', 'tsconfig.e2e.json', '.env.example', '.dockerignore', '.gitignore', 'Dockerfile', 'Dockerfile.aws', 'eslint.config.mjs', 'playwright.config.ts', 'vitest.config.ts', 'vitest.isolation.config.ts', 'vitest.smoke.config.ts', 'vitest.perf.config.ts'].includes(file);
}
