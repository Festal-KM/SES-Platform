'use client';

// tests/static/__fixtures__/client-db-boundary/alias-unresolvable.tsx
// `@/` エイリアス（apps/web/tsconfig.json の `paths`）が実ファイルへ解決できないケース。
// `client-db-boundary.test.ts` はこれを黙って無視せず、解決不能として fail する。
import { Nope } from '@/__this_does_not_exist__';

export const x = Nope;
