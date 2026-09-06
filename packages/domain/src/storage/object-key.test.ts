// packages/domain/src/storage/object-key.test.ts
// docs/05 §14.1（オブジェクトキー）。T-05-04。
import { describe, expect, it } from 'vitest';
import {
  buildSkillSheetDownloadFileName,
  buildSkillSheetObjectKey,
  InvalidObjectKeyPartError,
  isTenantScopedObjectKey,
  objectKeyExtensionOf,
  parseSkillSheetObjectKey,
  tenantIdFromObjectKey,
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

describe('🔴 tenantIdFromObjectKey（スキャン結果の引き当て。T-05-05）', () => {
  it('t/{tenantId}/ 配下のキーからテナント ID を取り出す', () => {
    expect(tenantIdFromObjectKey(`t/${TENANT}/skill-sheets/${ENGINEER}/1/${OBJECT}.xlsx`)).toBe(
      TENANT,
    );
  });

  it.each([
    ['バケット直下', `${OBJECT}.xlsx`],
    ['別のプレフィックス', `exports/${TENANT}/dump.zip`],
    ['テナント ID が UUID でない', 't/all/skill-sheets/x/1/a.xlsx'],
    ['相対参照を含む', `t/${TENANT}/../${TENANT}/a.xlsx`],
    ['空文字', ''],
  ])('🔴 %s は null（推測で埋めない）', (_label, key) => {
    expect(tenantIdFromObjectKey(key)).toBeNull();
  });

  it('🔴 isTenantScopedObjectKey と判定が一致する（門番を 2 実装にしない）', () => {
    const keys = [
      `t/${TENANT}/skill-sheets/${ENGINEER}/1/${OBJECT}.xlsx`,
      `${OBJECT}.xlsx`,
      `exports/${TENANT}/dump.zip`,
      't/all/skill-sheets/x/1/a.xlsx',
      `t/${TENANT}//a.xlsx`,
    ];
    for (const key of keys) {
      expect(tenantIdFromObjectKey(key) !== null).toBe(isTenantScopedObjectKey(key));
    }
  });
});

describe('🔴 parseSkillSheetObjectKey（#19 の申告キーの照合。T-05-06）', () => {
  it('組み立てたキーを元の構成要素に戻せる（往復する）', () => {
    const input = {
      tenantId: TENANT,
      engineerId: ENGINEER,
      version: 12,
      objectId: OBJECT,
      extension: 'pdf',
    };
    expect(parseSkillSheetObjectKey(buildSkillSheetObjectKey(input))).toEqual(input);
  });

  it.each([
    ['他の用途のプレフィックス', `t/${TENANT}/contracts/${ENGINEER}/1/${OBJECT}.pdf`],
    ['一時領域', `t/${TENANT}/tmp/${ENGINEER}/1/${OBJECT}.pdf`],
    ['セグメントが足りない', `t/${TENANT}/skill-sheets/${ENGINEER}/${OBJECT}.pdf`],
    ['セグメントが多い', `t/${TENANT}/skill-sheets/${ENGINEER}/1/x/${OBJECT}.pdf`],
    ['エンジニア ID が UUID でない', `t/${TENANT}/skill-sheets/all/1/${OBJECT}.pdf`],
    ['版が 0', `t/${TENANT}/skill-sheets/${ENGINEER}/0/${OBJECT}.pdf`],
    ['版が先頭ゼロ', `t/${TENANT}/skill-sheets/${ENGINEER}/01/${OBJECT}.pdf`],
    ['版が数値でない', `t/${TENANT}/skill-sheets/${ENGINEER}/latest/${OBJECT}.pdf`],
    ['オブジェクト ID が UUID でない', `t/${TENANT}/skill-sheets/${ENGINEER}/1/report.pdf`],
    ['拡張子が無い', `t/${TENANT}/skill-sheets/${ENGINEER}/1/${OBJECT}`],
    ['拡張子が大文字（組み立て側では作れない形）', `t/${TENANT}/skill-sheets/${ENGINEER}/1/${OBJECT}.PDF`],
    ['相対参照を含む', `t/${TENANT}/skill-sheets/${ENGINEER}/1/../${OBJECT}.pdf`],
    ['テナントプレフィックスの外', `skill-sheets/${ENGINEER}/1/${OBJECT}.pdf`],
    ['空文字', ''],
  ])('🔴 %s は null（推測で補わない）', (_label, key) => {
    expect(parseSkillSheetObjectKey(key)).toBeNull();
  });

  it('🔴 別テナント・別エンジニアのキーも「形としては」通る（照合は呼び出し側の責務）', () => {
    // ここが `null` を返さないことを明示しておく。**ctx との一致を確かめるのは
    // `confirmSkillSheetUpload` 側**であり、この関数は形式しか知りようがない。
    const other = '01930000-0000-7000-8000-0000000000ff';
    const parsed = parseSkillSheetObjectKey(
      `t/${other}/skill-sheets/${ENGINEER}/1/${OBJECT}.xlsx`,
    );
    expect(parsed?.tenantId).toBe(other);
  });
});

/**
 * 🔴 T-05-07: ダウンロード名（docs/05 §14.1 の ⚠️ の決着）。
 *    **原本のファイル名を保存しない**ことを選んだので、名前はキーだけから決まる。
 */
describe('buildSkillSheetDownloadFileName（docs/05 §14.1 / T-05-07）', () => {
  it('版番号と拡張子だけの名前になる', () => {
    expect(
      buildSkillSheetDownloadFileName(`t/${TENANT}/skill-sheets/${ENGINEER}/3/${OBJECT}.xlsx`),
    ).toBe('skill-sheet-v3.xlsx');
  });

  it('🔴 個人を特定できる要素（氏名・テナント ID・エンジニア ID・UUID）を 1 つも含まない', () => {
    const name = buildSkillSheetDownloadFileName(
      `t/${TENANT}/skill-sheets/${ENGINEER}/12/${OBJECT}.pdf`,
    );
    expect(name).toBe('skill-sheet-v12.pdf');
    expect(name).not.toContain(TENANT);
    expect(name).not.toContain(ENGINEER);
    expect(name).not.toContain(OBJECT);
  });

  it('🔴 ASCII の安全な形だけになる（`Content-Disposition` に入れても注入が起きない）', () => {
    for (const version of [1, 2, 99]) {
      const name = buildSkillSheetDownloadFileName(
        `t/${TENANT}/skill-sheets/${ENGINEER}/${version}/${OBJECT}.docx`,
      );
      expect(name).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
    }
  });

  it('🔴 同じキーからは必ず同じ名前になる（DB を読まないのでずれようがない）', () => {
    const key = `t/${TENANT}/skill-sheets/${ENGINEER}/7/${OBJECT}.doc`;
    expect(buildSkillSheetDownloadFileName(key)).toBe(buildSkillSheetDownloadFileName(key));
  });

  it.each([
    ['他の用途のプレフィックス', `t/${TENANT}/contracts/${ENGINEER}/1/${OBJECT}.pdf`],
    ['形が壊れている', `t/${TENANT}/skill-sheets/${ENGINEER}/1/${OBJECT}`],
    ['空文字', ''],
  ])('🔴 %s は null（推測で名前を作らない）', (_label, key) => {
    expect(buildSkillSheetDownloadFileName(key)).toBeNull();
  });
});
