// packages/db/src/search/engineer-share-search.test.ts
// `GET /api/engineer-shares`（#29。`S-015`）の**検索条件 → 述語**（`engineerShareSearchWhere`）。T-11-11。
//
// 🔴 ここで固定するのは 4 点である（docs/05 §6.4「#29 の改訂」の「母集団と検索の評価」）:
//   ①条件が無ければ `{}`（= 母集団そのもの。RLS C3 の自社行）
//   ②🔴 フリーワードは**氏名の 1 列だけ**を見る（`#15` の `preferenceNote` を見ない。PII 列も見ない）
//   ③🔴 稼働可能時期は**絞り込み**（`available_from <= 日付`。ソフト条件〔バケット〕ではない）で、
//     `#15` の `onlyInTime` を立てたときの述語と**同じ形**である
//   ④共有状態・分離キー・スキル・単価・勤務地の述語を持たない
//
// 🔴 実データでの母集団（他社の行が `q` に一致しても 0 件）は `tests/isolation/engineer-shares.test.ts` が固定する。
import { describe, expect, it } from 'vitest';
import {
  ENGINEER_SKILL_MODE_DEFAULT,
  engineerSearchPlan,
  engineerShareSearchWhere,
} from './engineers.js';

describe('engineerShareSearchWhere（S-015 の検索条件 → 述語）', () => {
  it('条件が無ければ `{}`（母集団そのもの）', () => {
    expect(engineerShareSearchWhere({})).toEqual({});
  });

  it('🔴 フリーワードは氏名（`displayName`）の 1 列だけを見る', () => {
    const where = engineerShareSearchWhere({ q: '合成' });
    expect(where).toEqual({
      AND: [{ OR: [{ displayName: { contains: '合成', mode: 'insensitive' } }] }],
    });
    const json = JSON.stringify(where);
    // `#15` が見る希望条件も、画面が出さない PII も対象にしない。
    for (const column of [
      'preferenceNote',
      'contactEmail',
      'contactPhone',
      'birthDate',
      'affiliationLabel',
      'city',
    ]) {
      expect(json).not.toContain(column);
    }
  });

  it('🔴 稼働可能時期は絞り込み（`available_from <= 日付`）で、NULL の行を拾わない', () => {
    const where = engineerShareSearchWhere({ availableBy: '2026-10-31' });
    expect(where).toEqual({ AND: [{ availableFrom: { lte: new Date('2026-10-31T00:00:00.000Z') } }] });
    // 「NULL は不適合」= 述語に `availableFrom: null` の枝が無い（`OR` で拾い直さない）。
    expect(JSON.stringify(where)).not.toContain('"availableFrom":null');
  });

  it('🔴 `#15` で `onlyInTime` を立てたときと同じ述語である（判定を 2 本にしない）', () => {
    const fromShare = engineerShareSearchWhere({ availableBy: '2026-10-31' }).AND?.[0];
    const fromLedger = engineerSearchPlan({
      skillMode: ENGINEER_SKILL_MODE_DEFAULT,
      availableBy: '2026-10-31',
      onlyInTime: true,
      onlyCommutable: false,
    }).where.AND?.[0];
    expect(fromShare).toEqual(fromLedger);
  });

  it('2 条件は AND で重なる', () => {
    const where = engineerShareSearchWhere({ q: '太郎', availableBy: '2026-10-31' });
    expect(where.AND).toHaveLength(2);
  });

  it('🔴 共有状態・分離キー・探索条件（スキル / 単価 / 勤務地）の述語を持たない', () => {
    const json = JSON.stringify(engineerShareSearchWhere({ q: '合成', availableBy: '2026-10-31' }));
    for (const forbidden of [
      'engineerShares',
      'revokedAt',
      'tenantId',
      'partnerCompanyId',
      'ownerPartnerCompanyId',
      'engineerSkills',
      'unitPrice',
      'prefecture',
      'remoteMode',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});
