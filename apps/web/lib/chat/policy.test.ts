// apps/web/lib/chat/policy.test.ts
// `S-031` の権限（`docs/04` §S-031「権限差分」/ `CLAUDE.md` §10.1）。
import { describe, expect, it } from 'vitest';
import { TENANT_ROLES, type TenantRole } from '@ses/db';
import { CHAT_POST_ROLES, canPostChatMessage } from './policy';

describe('canPostChatMessage', () => {
  it('🔴 `VIEWER` は投稿できない（`docs/04` §S-031 / `CLAUDE.md` §10.1）', () => {
    expect(canPostChatMessage('VIEWER')).toBe(false);
  });

  it('ホストの実務ロールと取引先の実務ロールは投稿できる（取引先は主利用者である。`CLAUDE.md` §1.2）', () => {
    for (const role of ['OWNER', 'ADMIN', 'SALES', 'PARTNER_ADMIN', 'PARTNER_SALES'] as const) {
      expect(canPostChatMessage(role), role).toBe(true);
    }
  });

  it('🔴 許可側の列挙である（ロールが増えても自動では通らない）', () => {
    // 🔴 `role !== 'VIEWER'` と書いていたら、`PARTNER_VIEWER`（`T-16-12`。`CLAUDE.md` §10.1 で
    //    「チャットの投稿は一切不可」）が追加された瞬間に**投稿できてしまう**
    //    （`apps/web/lib/home/capabilities.ts` が踏んだ穴）。許可側の列挙はその経路を塞ぐ。
    const unknownRole = 'PARTNER_VIEWER' as TenantRole;
    expect(canPostChatMessage(unknownRole)).toBe(false);
  });

  it('対照: 列挙が `TENANT_ROLES` の部分集合であり、`VIEWER` だけを除いている', () => {
    const roles: readonly TenantRole[] = TENANT_ROLES;
    expect(CHAT_POST_ROLES.every((role) => roles.includes(role))).toBe(true);
    expect([...roles].filter((role) => !CHAT_POST_ROLES.includes(role))).toEqual(['VIEWER']);
  });
});
