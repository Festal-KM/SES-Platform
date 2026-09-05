'use client';

// tests/static/__fixtures__/client-db-boundary/alias-reaches-db.tsx
// `@/` エイリアス経由で `@ses/db` へ到達できてしまう壊れた形（`client-db-boundary.test.ts` の
// `resolveAliasModule` が走査を継続することを確認するための固定具）。
import { readSendingDomainSettings } from '@/lib/settings/sending-domains';

export const x = readSendingDomainSettings;
