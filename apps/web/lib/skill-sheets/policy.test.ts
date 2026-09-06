// apps/web/lib/skill-sheets/policy.test.ts
// 🔴 `F-011 AC-1`〜`AC-3` の判定規則（`BR-26`）。T-05-06。
//
// 🔴 `SCAN_STATUSES` を回して**全状態を数える**（`CLEAN` だけを個別に書くと、状態が増えたときに
//    新しい値が既定で「共有可」に落ちても気づけない）。
import { SCAN_STATUSES, type ScanStatus } from '@ses/domain';
import { describe, expect, it } from 'vitest';
import {
  canBecomeLatestSkillSheet,
  canManageSkillSheets,
  isScanSettled,
  isSkillSheetShareable,
  supportsAutoExtraction,
} from './policy';

describe('🔴 isSkillSheetShareable（`BR-26` / `F-011 AC-1`）', () => {
  it('CLEAN だけが共有可である（全状態を数える）', () => {
    const shareable = SCAN_STATUSES.filter((status) => isSkillSheetShareable(status));
    expect(shareable).toEqual(['CLEAN']);
  });

  it.each<ScanStatus>(['SCANNING', 'INFECTED', 'UNSCANNABLE', 'FAILED'])(
    '🔴 %s は共有できない（「たぶん大丈夫」で通さない）',
    (status) => {
      expect(isSkillSheetShareable(status)).toBe(false);
    },
  );
});

describe('🔴 canBecomeLatestSkillSheet（`F-011` 処理③）', () => {
  it('共有可否と同じ条件である（2 つの規則に割れていない）', () => {
    for (const status of SCAN_STATUSES) {
      expect(canBecomeLatestSkillSheet(status)).toBe(isSkillSheetShareable(status));
    }
  });
});

describe('🔴 isScanSettled（`F-011 AC-2`）', () => {
  it('SCANNING だけが未確定である', () => {
    const unsettled = SCAN_STATUSES.filter((status) => !isScanSettled(status));
    expect(unsettled).toEqual(['SCANNING']);
  });
});

describe('🔴 canManageSkillSheets（`docs/02` `F-011` 関連ロール / `docs/04` §S-008 権限差分）', () => {
  it.each(['OWNER', 'ADMIN', 'SALES', 'PARTNER_ADMIN', 'PARTNER_SALES'] as const)(
    '%s は版を操作できる（取引先も自社エンジニア分を登録する）',
    (role) => {
      expect(canManageSkillSheets(role)).toBe(true);
    },
  );

  it('🔴 `VIEWER` は操作できない（閲覧のみ。`F-012 AC-3` / `BR-31`）', () => {
    expect(canManageSkillSheets('VIEWER')).toBe(false);
  });
});

describe('supportsAutoExtraction（docs/03 `ui-design` 申し送り 8）', () => {
  it.each([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    // ⚠️ 画像 PDF かどうかは content-type からは分からない。形式としては対応扱いにし、
    //    画面の注記で「画像 PDF は手入力になる」ことを伝える。
    'application/pdf',
  ])('%s は自動読み取りの対象', (contentType) => {
    expect(supportsAutoExtraction(contentType)).toBe(true);
  });

  it.each(['image/png', 'image/jpeg'])('🔴 %s は自動読み取りに対応しない（受け付けはする）', (contentType) => {
    expect(supportsAutoExtraction(contentType)).toBe(false);
  });
});
