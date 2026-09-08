// packages/domain/src/gate/hash.test.ts
// 🔴 `gateHashSource`（docs/05 §11.5 の「正規化された連結」）の規約を固定する。T-07-08。
//
// ここで守るのは 2 つだけである:
//   ① 内容が変われば連結も変わる（＝ 承認が無効になる。`F-021` / §11.5 手順 2・3）
//   ② 同じ内容なら常に同じ連結になる（＝ 同じ `jobId` になり、ゲートが多重化しない。§9.3）
import { describe, expect, it } from 'vitest';
import {
  gateHashSource,
  GateHashInputError,
  type GateHashSnapshot,
  type ProposalGateHashInput,
} from './hash.js';

const SNAPSHOT: GateHashSnapshot = {
  displayName: '山田 太郎',
  affiliationLabel: '株式会社サンプル',
  skills: [
    { skillId: 'skill-b', label: 'React', years: 3, level: 4 },
    { skillId: 'skill-a', label: 'TypeScript', years: 5.25, level: null },
  ],
  unitPriceMin: '600000.00',
  unitPriceMax: '700000.00',
  availableFrom: '2026-10-01',
  attachment: { skillSheetId: 'sheet-1', objectKey: 't/tenant/e/eng/v3.xlsx', version: 3 },
};

const PROPOSAL: ProposalGateHashInput = {
  targetType: 'PROPOSAL',
  subject: 'ご提案',
  body: '本文です。',
  recipientCompanyName: '架空エンド株式会社',
  recipientEmail: 'recipient@example.test',
  offeredUnitPrice: '800000.00',
  offeredStartDate: '2026-11-01',
  workStyle: 'REMOTE',
  snapshot: SNAPSHOT,
};

describe('gateHashSource（§11.5 の正規化）', () => {
  it('同じ内容なら何度呼んでも同じ連結になる', () => {
    expect(gateHashSource(PROPOSAL)).toBe(gateHashSource({ ...PROPOSAL }));
  });

  it('🔴 スキルの並びが違っても同じ連結になる（凍結 JSON の並びに依存しない）', () => {
    const reordered: ProposalGateHashInput = {
      ...PROPOSAL,
      snapshot: { ...SNAPSHOT, skills: [...SNAPSHOT.skills].reverse() },
    };
    expect(gateHashSource(reordered)).toBe(gateHashSource(PROPOSAL));
  });

  it('🔴 本文が 1 文字変われば連結が変わる', () => {
    expect(gateHashSource({ ...PROPOSAL, body: '本文です．' })).not.toBe(gateHashSource(PROPOSAL));
  });

  it.each([
    ['subject', { subject: '別の件名' }],
    ['recipientCompanyName', { recipientCompanyName: '別の会社' }],
    ['recipientEmail', { recipientEmail: 'other@example.test' }],
    ['offeredUnitPrice', { offeredUnitPrice: '810000.00' }],
    ['offeredStartDate', { offeredStartDate: '2026-12-01' }],
    ['workStyle', { workStyle: 'ONSITE' }],
  ])('🔴 %s が変われば連結が変わる（提案先も材料である）', (_label, patch) => {
    expect(gateHashSource({ ...PROPOSAL, ...patch })).not.toBe(gateHashSource(PROPOSAL));
  });

  it.each([
    ['氏名', { displayName: '山田 次郎' }],
    ['所属', { affiliationLabel: '別の会社' }],
    ['単価下限', { unitPriceMin: '650000.00' }],
    ['稼働可能時期', { availableFrom: '2026-11-01' }],
  ])('🔴 凍結コピーの %s が変われば連結が変わる', (_label, patch) => {
    expect(gateHashSource({ ...PROPOSAL, snapshot: { ...SNAPSHOT, ...patch } })).not.toBe(
      gateHashSource(PROPOSAL),
    );
  });

  it('🔴 添付の版が変われば連結が変わる（§11.5「添付の objectKey + versionId」）', () => {
    const other: GateHashSnapshot = {
      ...SNAPSHOT,
      attachment: { skillSheetId: 'sheet-2', objectKey: 't/tenant/e/eng/v4.xlsx', version: 4 },
    };
    expect(gateHashSource({ ...PROPOSAL, snapshot: other })).not.toBe(gateHashSource(PROPOSAL));
  });

  it('🔴 添付の有無が連結に現れる', () => {
    const without: GateHashSnapshot = { ...SNAPSHOT, attachment: null };
    expect(gateHashSource({ ...PROPOSAL, snapshot: without })).not.toBe(gateHashSource(PROPOSAL));
  });

  it('🔴 凍結コピーが無い提案と、空の凍結コピーを持つ提案を区別する', () => {
    const empty: GateHashSnapshot = {
      displayName: '',
      affiliationLabel: null,
      skills: [],
      unitPriceMin: null,
      unitPriceMax: null,
      availableFrom: null,
      attachment: null,
    };
    expect(gateHashSource({ ...PROPOSAL, snapshot: null })).not.toBe(
      gateHashSource({ ...PROPOSAL, snapshot: empty }),
    );
  });

  it('🔴 null と空文字を区別する（「未設定」と「空にした」は別の内容である）', () => {
    expect(gateHashSource({ ...PROPOSAL, body: null })).not.toBe(
      gateHashSource({ ...PROPOSAL, body: '' }),
    );
  });

  it('🔴 区切り文字を含む値で境界が動かない（衝突を作らない）', () => {
    const left = gateHashSource({ ...PROPOSAL, subject: 'A\nbody=5:XXXXX', body: 'B' });
    const right = gateHashSource({ ...PROPOSAL, subject: 'A', body: 'body=5:XXXXX\nB' });
    expect(left).not.toBe(right);
  });

  it('スキルの年数は 1/10 年に丸めて綴じる（0.04 の差は同じ、0.1 の差は別）', () => {
    const base = (value: number): string =>
      gateHashSource({
        ...PROPOSAL,
        snapshot: { ...SNAPSHOT, skills: [{ skillId: 's', label: 'S', years: value, level: null }] },
      });
    expect(base(3.02)).toBe(base(3.0));
    expect(base(3.1)).not.toBe(base(3.0));
  });

  it.each([
    ['負の年数', { skillId: 's', label: 'S', years: -1, level: null }],
    ['NaN の年数', { skillId: 's', label: 'S', years: Number.NaN, level: null }],
    ['非整数のレベル', { skillId: 's', label: 'S', years: 1, level: 1.5 }],
  ])('🔴 %s は握り潰さず GateHashInputError にする', (_label, skill) => {
    expect(() =>
      gateHashSource({ ...PROPOSAL, snapshot: { ...SNAPSHOT, skills: [skill] } }),
    ).toThrow(GateHashInputError);
  });

  it('版の識別子が連結の先頭にある（書式を変えたら版を上げるための目印）', () => {
    expect(gateHashSource(PROPOSAL).startsWith('gate-content/v1\n')).toBe(true);
  });
});
