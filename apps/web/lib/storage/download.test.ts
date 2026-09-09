// apps/web/lib/storage/download.test.ts
// 🔴 共有の分類（`classifyFileShare`）の規則を固定する。T-07-09（docs/05 §11.11 ⑥）。
//
// この 1 ビット（`OWNER_SCOPE` / `EXTERNAL`）が、**品質ゲートを要求するかどうか**を決める
// （`issueDownloadUrl` の前提条件③ / `F-020 AC-1`）。分類を間違えると、
//   - 過剰に `EXTERNAL` … 自社のファイルを自分で落とせなくなる（業務が止まる）
//   - 過小に `OWNER_SCOPE` … **検査していないファイルが境界の外へ出る**（`BR-15` が空回りする）
// のどちらかになるので、境界の組み合わせを網羅して固定する。
import { describe, expect, it } from 'vitest';
import { classifyFileShare } from './download';

const GATE = { gateTargetType: 'SKILL_SHEET_SHARE', gateTargetId: 'sheet-1' } as const;

describe('classifyFileShare（docs/05 §11.11 ⑥）', () => {
  it('ホストが自社所有のファイルを扱う（どちらも null）＝ 境界の中', () => {
    expect(
      classifyFileShare({ ownerPartnerCompanyId: null, requesterPartnerCompanyId: null, ...GATE }),
    ).toEqual({ kind: 'OWNER_SCOPE' });
  });

  it('パートナーが自社所有のファイルを扱う（同じ会社）＝ 境界の中', () => {
    expect(
      classifyFileShare({
        ownerPartnerCompanyId: 'partner-a',
        requesterPartnerCompanyId: 'partner-a',
        ...GATE,
      }),
    ).toEqual({ kind: 'OWNER_SCOPE' });
  });

  it('🔴 ホストがパートナー所有のファイルを扱う ＝ 境界の外（ゲートが要る）', () => {
    expect(
      classifyFileShare({
        ownerPartnerCompanyId: 'partner-a',
        requesterPartnerCompanyId: null,
        ...GATE,
      }),
    ).toEqual({ kind: 'EXTERNAL', gateTargetType: 'SKILL_SHEET_SHARE', gateTargetId: 'sheet-1' });
  });

  it('🔴 パートナーがホスト所有のファイルを扱う ＝ 境界の外（ゲートが要る）', () => {
    expect(
      classifyFileShare({
        ownerPartnerCompanyId: null,
        requesterPartnerCompanyId: 'partner-a',
        ...GATE,
      }),
    ).toMatchObject({ kind: 'EXTERNAL' });
  });

  it('🔴 別のパートナー所有のファイル ＝ 境界の外（パートナー間の相互参照。`CLAUDE.md` §3.1）', () => {
    expect(
      classifyFileShare({
        ownerPartnerCompanyId: 'partner-a',
        requesterPartnerCompanyId: 'partner-b',
        ...GATE,
      }),
    ).toMatchObject({ kind: 'EXTERNAL' });
  });

  it('🔴 ゲート結果の所在をそのまま運ぶ（発行側が対象を組み立て直さない）', () => {
    expect(
      classifyFileShare({
        ownerPartnerCompanyId: 'partner-a',
        requesterPartnerCompanyId: null,
        gateTargetType: 'SKILL_SHEET_SHARE',
        gateTargetId: 'sheet-42',
      }),
    ).toEqual({
      kind: 'EXTERNAL',
      gateTargetType: 'SKILL_SHEET_SHARE',
      gateTargetId: 'sheet-42',
    });
  });
});
