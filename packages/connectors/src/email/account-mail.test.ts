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
