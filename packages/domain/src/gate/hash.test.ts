// packages/domain/src/gate/hash.test.ts
// 🔴 `gateHashSource`（docs/05 §11.5 の「正規化された連結」）の規約を固定する。T-07-08。
//
// ここで守るのは 2 つだけである:
//   ① 内容が変われば連結も変わる（＝ 承認が無効になる。`F-021` / §11.5 手順 2・3）
//   ② 同じ内容なら常に同じ連結になる（＝ 同じ `jobId` になり、ゲートが多重化しない。§9.3）
import { describe, expect, it } from 'vitest';
import {
  GATE_HASH_ALGORITHM_VERSION,
  gateHashSource,
  GateHashInputError,
  type GateHashSnapshot,
  type ProjectPublishGateHashInput,
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
    expect(gateHashSource(PROPOSAL).startsWith(`gate-content/${GATE_HASH_ALGORITHM_VERSION}\n`)).toBe(true);
  });
});

// ===========================================================================
// 🔴 案件の公開（`PROJECT_PUBLISH`）。T-07-09（docs/05 §11.11 ①）
// ===========================================================================
//
// 🔴 ここで固定するのは「**内容は公開文だけではない**」という 1 点である。案件の公開の合否は
//    「その公開範囲で出してはならない語」との照合で決まる（`F-014 AC-3`）ので、公開先の集合と
//    取引先の社名が変われば、同じ公開文でも合否が変わりうる。材料に入っていないと、
//    `(target_type, target_id, content_hash)` のキャッシュ（`P-A-09`）が
//    **検査していない相手への公開を成立させる。**
describe('gateHashSource（PROJECT_PUBLISH）', () => {
  const PUBLISH: ProjectPublishGateHashInput = {
    targetType: 'PROJECT_PUBLISH',
    name: '基幹システム刷新',
    requirementTexts: ['金融系の経験', 'チームリード経験があれば尚可'],
    publicSummary: '大手金融の基幹刷新。React / TypeScript。',
    endClientName: '株式会社エンド',
    internalUnitPrice: '900000.00',
    audiencePartnerCompanyIds: ['partner-b', 'partner-a'],
    partnerCompanies: [
      { partnerCompanyId: 'partner-b', name: 'ビー商事' },
      { partnerCompanyId: 'partner-a', name: 'エー株式会社' },
      { partnerCompanyId: 'partner-c', name: 'シー技研' },
    ],
  };

  it('同じ内容なら常に同じ連結になる（並び順に依存しない）', () => {
    expect(
      gateHashSource({
        ...PUBLISH,
        audiencePartnerCompanyIds: ['partner-a', 'partner-b'],
        partnerCompanies: [...PUBLISH.partnerCompanies].reverse(),
      }),
    ).toBe(gateHashSource(PUBLISH));
  });

  it('🔴 公開先を 1 社増やすと別の連結になる（同じ公開文でも再検査が要る）', () => {
    expect(
      gateHashSource({
        ...PUBLISH,
        audiencePartnerCompanyIds: [...PUBLISH.audiencePartnerCompanyIds, 'partner-c'],
      }),
    ).not.toBe(gateHashSource(PUBLISH));
  });

  it('🔴 取引先が増える / 社名が変わると別の連結になる（「他社名」の集合が変わる）', () => {
    expect(
      gateHashSource({
        ...PUBLISH,
        partnerCompanies: [
          ...PUBLISH.partnerCompanies,
          { partnerCompanyId: 'partner-d', name: 'ディー社' },
        ],
      }),
    ).not.toBe(gateHashSource(PUBLISH));

    expect(
      gateHashSource({
        ...PUBLISH,
        partnerCompanies: PUBLISH.partnerCompanies.map((partner) =>
          partner.partnerCompanyId === 'partner-c' ? { ...partner, name: 'シー技研株式会社' } : partner,
        ),
      }),
    ).not.toBe(gateHashSource(PUBLISH));
  });

  it.each([
    ['公開文', { publicSummary: '大手金融の基幹刷新。React / TypeScript' }],
    ['エンド企業名', { endClientName: '株式会社エンド２' }],
    ['内部単価', { internalUnitPrice: '900001.00' }],
    // 🔴 T-07-09 の是正（docs/05 §11.11 ⑧）: 案件名と要件のフリーテキストも公開先が読む欄であり、
    //    材料に入っていないと「案件名だけ直して再要求」が FAIL のキャッシュを引く（またはその逆）。
    ['案件名', { name: '基幹システム刷新（第 2 期）' }],
    ['要件のフリーテキスト', { requirementTexts: ['金融系の経験', 'PM 経験があれば尚可'] }],
    ['要件の件数', { requirementTexts: ['金融系の経験'] }],
  ])('%s が変わると別の連結になる', (_label, patch) => {
    expect(gateHashSource({ ...PUBLISH, ...patch })).not.toBe(gateHashSource(PUBLISH));
  });

  it('🔴 要件のフリーテキストは並べ替えない（順序が変われば別の連結になる）', () => {
    expect(
      gateHashSource({ ...PUBLISH, requirementTexts: [...PUBLISH.requirementTexts].reverse() }),
    ).not.toBe(gateHashSource(PUBLISH));
  });

  it('🔴 要件を連結しただけの入力と区別する（区切りの混入で衝突しない）', () => {
    expect(gateHashSource({ ...PUBLISH, requirementTexts: ['A', 'B'] })).not.toBe(
      gateHashSource({ ...PUBLISH, requirementTexts: ['A\nB'] }),
    );
  });

  it('🔴 null と空文字を区別する（公開文が無い案件と、空の公開文は別物）', () => {
    expect(gateHashSource({ ...PUBLISH, publicSummary: null })).not.toBe(
      gateHashSource({ ...PUBLISH, publicSummary: '' }),
    );
  });

  it('🔴 対象種別が違えば別の連結になる（材料がたまたま似ても衝突しない）', () => {
    expect(gateHashSource(PUBLISH)).not.toBe(gateHashSource(PROPOSAL));
    expect(gateHashSource(PUBLISH).startsWith(`gate-content/${GATE_HASH_ALGORITHM_VERSION}\n`)).toBe(true);
  });
});
