// packages/connectors/src/email/account-mail.test.ts
// 🔴 `dedupeKey` の**組み立てと分解が往復する**ことを固定する（docs/05 §9.4 / §8.3）。T-04-05。
//
// なぜ重要か: 保留（`HELD_*`）からの復帰は、`EmailDispatch` の行に残る `dedupeKey` だけを
// 手がかりに「どの招待か」を決める（平文トークンも payload も残っていない）。
// **分解が組み立てとずれると、別人の招待のトークンを差し替える**ことになる。
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_MAIL_KINDS,
  accountMailDedupeKey,
  buildAccountMailLink,
  parseAccountMailDedupeKey,
} from './account-mail.js';

const TARGET_ID = '01930000-0000-7000-8000-000000000191';
const PREFIX = '0123456789abcdef';

describe('accountMailDedupeKey（docs/05 §9.4）', () => {
  it('`{kind}:{targetId}:{tokenHashPrefix}` の形である', () => {
    expect(accountMailDedupeKey({ kind: 'INVITATION', targetId: TARGET_ID, tokenHashPrefix: PREFIX }))
      .toBe(`INVITATION:${TARGET_ID}:${PREFIX}`);
  });

  it('🔴 トークンが変われば別の鍵になる（再発行が「重複」として弾かれない）', () => {
    const first = accountMailDedupeKey({ kind: 'INVITATION', targetId: TARGET_ID, tokenHashPrefix: 'a' });
    const second = accountMailDedupeKey({ kind: 'INVITATION', targetId: TARGET_ID, tokenHashPrefix: 'b' });
    expect(first).not.toBe(second);
  });
});

describe('🔴 parseAccountMailDedupeKey（保留からの復帰の唯一の手がかり）', () => {
  it.each(ACCOUNT_MAIL_KINDS)('%s は往復する', (kind) => {
    const key = accountMailDedupeKey({ kind, targetId: TARGET_ID, tokenHashPrefix: PREFIX });
    expect(parseAccountMailDedupeKey(key)).toEqual({ kind, targetId: TARGET_ID });
  });

  it.each([
    ['区切りが足りない', `INVITATION:${TARGET_ID}`],
    ['区切りが多い', `INVITATION:${TARGET_ID}:${PREFIX}:extra`],
    ['未知の kind', `UNKNOWN:${TARGET_ID}:${PREFIX}`],
    ['targetId が空', `INVITATION::${PREFIX}`],
    ['空文字', ''],
  ])('🔴 %s は null（推測して埋めない）', (_label, key) => {
    expect(parseAccountMailDedupeKey(key)).toBeNull();
  });

  it('🔴 運用メールの dedupeKey（`{templateKey}:{targetId}:{recipientHash}`）を招待と誤認しない', () => {
    // `packages/db` の `emailDispatchDedupeKey` が作る形。3 分割は同じだが `kind` が一致しない。
    expect(parseAccountMailDedupeKey(`TENANT_CLOSING_NOTICE:${TARGET_ID}:${PREFIX}`)).toBeNull();
  });
});

// 🔴 T-04-08: メール本文のリンク（`apps/worker`）と `sandbox` の招待リンク（`apps/web`）は
//    この 1 つの関数から出る。**`apps/web` の実ルートと一致していること**をここで固定する ——
//    ずれると「渡したリンクを開いたら 404」になり、`F-007 AC-4` が静かに壊れる。
describe('🔴 buildAccountMailLink（平文トークンの唯一の出口 / T-04-08）', () => {
  const APP_URL = 'https://app.example.co.jp';

  it('招待は `/invite/{token}`（`app/(main)/(auth)/invite/[token]/page.tsx` と一致）', () => {
    expect(buildAccountMailLink(APP_URL, 'INVITATION', 'tok')).toBe(`${APP_URL}/invite/tok`);
  });

  it('パスワード再設定は `?token=`（`password-reset/confirm/page.tsx` はクエリで受ける）', () => {
    expect(buildAccountMailLink(APP_URL, 'PASSWORD_RESET', 'tok')).toBe(
      `${APP_URL}/password-reset/confirm?token=tok`,
    );
  });

  it('🔴 トークンはエンコードされる（パス区切り・クエリ区切りに化けない）', () => {
    expect(buildAccountMailLink(APP_URL, 'INVITATION', 'a/b?c')).toBe(`${APP_URL}/invite/a%2Fb%3Fc`);
    expect(buildAccountMailLink(APP_URL, 'PASSWORD_RESET', 'a/b?c')).toBe(
      `${APP_URL}/password-reset/confirm?token=a%2Fb%3Fc`,
    );
  });

  it('APP_URL のパス・末尾スラッシュに依らず絶対 URL になる', () => {
    expect(buildAccountMailLink('https://app.example.co.jp/', 'INVITATION', 'tok')).toBe(
      `${APP_URL}/invite/tok`,
    );
  });
});
