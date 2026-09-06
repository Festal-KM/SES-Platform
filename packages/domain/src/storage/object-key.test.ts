// packages/domain/src/storage/object-key.test.ts
// docs/05 §14.1（オブジェクトキー）。T-05-04。
import { describe, expect, it } from 'vitest';
import {
  buildSkillSheetObjectKey,
  InvalidObjectKeyPartError,
  isTenantScopedObjectKey,
  objectKeyExtensionOf,
} from './object-key.js';

const TENANT = '01930000-0000-7000-8000-000000000001';
const ENGINEER = '01930000-0000-7000-8000-0000000000e1';
const OBJECT = '01930000-0000-7000-8000-0000000000a1';

describe('buildSkillSheetObjectKey（docs/05 §14.1）', () => {
  it('🔴 1 バケット + テナント別プレフィックスの形になる', () => {
    expect(
      buildSkillSheetObjectKey({
        tenantId: TENANT,
        engineerId: ENGINEER,
        version: 3,
        objectId: OBJECT,
        extension: 'xlsx',
      }),
    ).toBe(`t/${TENANT}/skill-sheets/${ENGINEER}/3/${OBJECT}.xlsx`);
  });

  it('🔴 同じ入力からは同じキーになる（採番は呼び出し側。ここに乱数も時刻も無い）', () => {
    const input = {
      tenantId: TENANT,
      engineerId: ENGINEER,
      version: 1,
      objectId: OBJECT,
      extension: 'pdf',
    } as const;
    expect(buildSkillSheetObjectKey(input)).toBe(buildSkillSheetObjectKey(input));
  });

  it.each([
    ['tenantId', { tenantId: `${TENANT}/../other` }],
    ['engineerId', { engineerId: 'not-a-uuid' }],
    ['objectId', { objectId: '' }],
  ])('🔴 %s が UUID でなければ組み立てない（プレフィックスの外へ出られない）', (_label, patch) => {
    expect(() =>
      buildSkillSheetObjectKey({
        tenantId: TENANT,
        engineerId: ENGINEER,
        version: 1,
        objectId: OBJECT,
        extension: 'xlsx',
        ...patch,
      }),
    ).toThrow(InvalidObjectKeyPartError);
  });

  it.each([0, -1, 1.5])('🔴 version が 1 以上の整数でなければ組み立てない（%s）', (version) => {
    expect(() =>
      buildSkillSheetObjectKey({
        tenantId: TENANT,
        engineerId: ENGINEER,
        version,
        objectId: OBJECT,
        extension: 'xlsx',
      }),
    ).toThrow(InvalidObjectKeyPartError);
  });

  it.each(['../evil', 'x/y', 'tar.gz', ''])(
    '🔴 拡張子に使えない文字が入っていたら組み立てない（%s）',
    (extension) => {
      expect(() =>
        buildSkillSheetObjectKey({
          tenantId: TENANT,
          engineerId: ENGINEER,
          version: 1,
          objectId: OBJECT,
          extension,
        }),
      ).toThrow(InvalidObjectKeyPartError);
    },
  );

  it('🔴 例外メッセージに値そのものを載せない（ファイル名に氏名が入りうる）', () => {
    try {
      buildSkillSheetObjectKey({
        tenantId: TENANT,
        engineerId: '山田太郎-skillsheet',
        version: 1,
        objectId: OBJECT,
        extension: 'xlsx',
      });
      expect.unreachable('例外が投げられていない');
    } catch (error) {
      expect((error as Error).message).not.toContain('山田太郎');
    }
  });
});

describe('objectKeyExtensionOf', () => {
  it.each([
    ['skillsheet.xlsx', 'xlsx'],
    ['SKILLSHEET.XLSX', 'xlsx'],
    ['山田 太郎 経歴書.pdf', 'pdf'],
    ['archive.tar.gz', 'gz'],
  ])('%s → %s', (fileName, expected) => {
    expect(objectKeyExtensionOf(fileName)).toBe(expected);
  });

  it.each(['noextension', '.hidden', 'trailing.', 'weird.タブ', 'too.longextensionname12345'])(
    '🔴 拡張子として使えない形は null（%s）',
    (fileName) => {
      expect(objectKeyExtensionOf(fileName)).toBeNull();
    },
  );
});

describe('🔴 isTenantScopedObjectKey（署名する前の門番）', () => {
  it('テナントプレフィックス配下のキーだけを通す', () => {
    expect(isTenantScopedObjectKey(`t/${TENANT}/skill-sheets/${ENGINEER}/1/${OBJECT}.xlsx`)).toBe(
      true,
    );
  });

  it.each([
    ['バケット直下', `${OBJECT}.xlsx`],
    ['別のプレフィックス', `exports/${TENANT}/dump.zip`],
    ['テナント ID が UUID でない', 't/all/skill-sheets/x/1/a.xlsx'],
    ['相対参照を含む', `t/${TENANT}/../${TENANT}/a.xlsx`],
    ['空セグメントを含む', `t/${TENANT}//a.xlsx`],
    ['プレフィックスだけ', `t/${TENANT}`],
  ])('🔴 %s は通さない', (_label, key) => {
    expect(isTenantScopedObjectKey(key)).toBe(false);
  });
});
