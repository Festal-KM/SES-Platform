// apps/web/lib/anonymize/candidate-view.test.ts
// 🔴 T-08-04: `AnonymousCandidateView` の型と組み立て（`F-017 AC-1` / `AC-2` / `AC-3` / `AC-7`）。
//
// 🔴 **型テストだけに頼らない。** T-08-03 のレビューで「型テストは構造上リレーション経由を
//    捕まえられない」ことが実証されている。本ファイルは①型（`@ts-expect-error`）②キー集合
//    ③**組み立て結果の JSON を深さ走査して禁止値が 0 件**の 3 本立てで見る。
//    実 DB での同じ検査は `tests/isolation/anonymous-candidate-view.test.ts` が行う。
import { describe, expect, it } from 'vitest';
import type { SharedCandidateSource } from '@ses/db';
import {
  ANONYMOUS_CANDIDATE_VIEW_KEYS,
  AnonymousCandidateViewError,
  buildAnonymousCandidateViews,
  compareAnonymousCandidateViews,
  type AnonymousCandidateView,
} from './candidate-view';
import { createCandidateReference } from './reference';

const SECRET = 'A'.repeat(43) + '=';
const candidateRef = createCandidateReference(SECRET);

const PROJECT_1 = '01930000-0000-7000-8000-0000000000f1';
const PROJECT_2 = '01930000-0000-7000-8000-0000000000f2';
const ENGINEER_1 = '01930000-0000-7000-8000-0000000000e2';
const ENGINEER_2 = '01930000-0000-7000-8000-0000000000e4';
const ENGINEER_3 = '01930000-0000-7000-8000-0000000000e5';
const SKILL_TS = '01930000-0000-7000-8000-0000000009a1';
const SKILL_GO = '01930000-0000-7000-8000-0000000009a2';

/**
 * 🔴 JST の 2026-09-08 00:15（= UTC では **前日** の 2026-09-07 15:15）。
 *    `toJstIsoDay` は `2026-09-08` を返し、`toISOString().slice(0, 10)`（UTC 切り出し）は
 *    `2026-09-07` を返す —— **両者の差が出る時刻**を選んでいる（`docs/05` §4.6.3 の申し送り）。
 */
const UPDATED_AT_1 = new Date('2026-09-07T15:15:00.000Z');
const UPDATED_AT_2 = new Date('2026-09-07T10:00:00.000Z');
const REFERENCE_DATE = '2026-09-11';

function decimal(value: number): { toString(): string } {
  return { toString: () => String(value) };
}

function source(overrides: Partial<SharedCandidateSource> = {}): SharedCandidateSource {
  return {
    engineerId: ENGINEER_1,
    unitPriceMin: decimal(650000),
    unitPriceMax: decimal(650000),
    availableFrom: new Date('2026-10-01T00:00:00.000Z'),
    prefecture: '13',
    remoteMode: 'PARTIAL_REMOTE',
    updatedAt: UPDATED_AT_1,
    skills: [
      { skillId: SKILL_TS, sortKey: 1, name: 'TypeScript', yearsOfExperience: decimal(7) },
      { skillId: SKILL_GO, sortKey: 2, name: 'Go', yearsOfExperience: decimal(3) },
    ],
    ...overrides,
  };
}

function build(
  rows: readonly SharedCandidateSource[],
  projectId = PROJECT_1,
): readonly AnonymousCandidateView[] {
  return buildAnonymousCandidateViews({
    projectId,
    rows,
    referenceDate: REFERENCE_DATE,
    candidateRef,
  });
}

// ---------------------------------------------------------------------------
// F-017 AC-1: 型として存在しない
// ---------------------------------------------------------------------------

describe('🔴 F-017 AC-1: 禁止フィールドが「型として」存在しない', () => {
  it('🔴 `@ts-expect-error` が立つ（フィールドが生えた瞬間に tsc が落ちる）', () => {
    const view = {} as AnonymousCandidateView;
    // @ts-expect-error F-017 AC-1: 実名は AnonymousCandidateView に存在しない
    const displayName: unknown = view.displayName;
    // @ts-expect-error F-017 AC-1: 所属会社名は存在しない
    const affiliationLabel: unknown = view.affiliationLabel;
    // @ts-expect-error BR-06: 共有元パートナーは存在しない
    const ownerPartnerCompanyId: unknown = view.ownerPartnerCompanyId;
    // @ts-expect-error BR-06: 共有元の社名も存在しない
    const partnerCompanyName: unknown = view.partnerCompanyName;
    // @ts-expect-error F-017 AC-2: engineerId（社内 ID）は存在しない
    const engineerId: unknown = view.engineerId;
    // @ts-expect-error F-017 AC-2: MatchCandidate の行 ID も存在しない
    const id: unknown = view.id;
    // @ts-expect-error F-017 AC-1: 営業メモは存在しない
    const preferenceNote: unknown = view.preferenceNote;
    // @ts-expect-error F-017 AC-1: スキルシートは存在しない
    const skillSheet: unknown = view.skillSheet;
    // @ts-expect-error F-008 AC-7: 経歴の行は存在しない
    const careers: unknown = view.careers;
    // @ts-expect-error F-008 AC-7: 件数・真偽値も存在しない
    const careerCount: unknown = view.careerCount;
    // @ts-expect-error F-008 AC-7
    const hasCareers: unknown = view.hasCareers;
    // @ts-expect-error A-04 ⑤: 市区町村は存在しない
    const city: unknown = view.city;
    // @ts-expect-error F-017 AC-3: 具体的な稼働開始日は存在しない
    const availableFrom: unknown = view.availableFrom;
    // @ts-expect-error F-017 AC-4 / BR-58: 確定単価は存在しない
    const unitPrice: unknown = view.unitPrice;
    // @ts-expect-error F-017 AC-2: 生のタイムスタンプは存在しない
    const updatedAt: unknown = view.updatedAt;
    // @ts-expect-error F-017 AC-2: 並び順から復元できる連番は存在しない
    const index: unknown = view.index;
    // @ts-expect-error F-017 AC-7: Phase 1 にスコア・順位は存在しない
    const score: unknown = view.score;
    // @ts-expect-error F-017 AC-7
    const rank: unknown = view.rank;
    // @ts-expect-error F-017 AC-7 / F-031: 根拠文は Phase 2
    const rationale: unknown = view.rationale;

    expect([
      displayName,
      affiliationLabel,
      ownerPartnerCompanyId,
      partnerCompanyName,
      engineerId,
      id,
      preferenceNote,
      skillSheet,
      careers,
      careerCount,
      hasCareers,
      city,
      availableFrom,
      unitPrice,
      updatedAt,
      index,
      score,
      rank,
      rationale,
    ]).toHaveLength(19);
  });

  it('🔴 スキルは `name` だけを持つ（`skillId` / `sortKey` は並びの決定にしか使わない）', () => {
    const skill = {} as AnonymousCandidateView['skills'][number];
    // @ts-expect-error F-017 AC-2: 辞書 ID は応答に載せない（案件をまたいだ突合の材料になる）
    const skillId: unknown = skill.skillId;
    // @ts-expect-error F-017 AC-2: sortKey も載せない
    const sortKey: unknown = skill.sortKey;
    // @ts-expect-error A-04 ①: 経験年数はスキル単位では出さない（集約した yearsBand だけ）
    const yearsOfExperience: unknown = skill.yearsOfExperience;
    expect([skillId, sortKey, yearsOfExperience]).toHaveLength(3);
  });

  it('🔴 キーはちょうど 8 個であり、宣言（`ANONYMOUS_CANDIDATE_VIEW_KEYS`）と一致する', () => {
    expect([...ANONYMOUS_CANDIDATE_VIEW_KEYS]).toEqual([
      'availabilityBand',
      'candidateRef',
      'prefecture',
      'priceBand',
      'remoteMode',
      'skills',
      'updatedOn',
      'yearsBand',
    ]);
    const [view] = build([source()]);
    expect(Object.keys(view ?? {}).sort()).toEqual([...ANONYMOUS_CANDIDATE_VIEW_KEYS]);
  });
});

// ---------------------------------------------------------------------------
// F-017 AC-3: 丸め規則どおりの粒度
// ---------------------------------------------------------------------------

describe('🔴 F-017 AC-3: 丸め後の値だけが載る', () => {
  it('7 年 → `Y5_10` / 65 万円 → `RANGE 60〜70` / 都道府県コードのみ', () => {
    const [view] = build([source()]);
    expect(view).toEqual({
      candidateRef: candidateRef(PROJECT_1, ENGINEER_1),
      skills: [{ name: 'TypeScript' }, { name: 'Go' }],
      yearsBand: 'Y5_10',
      priceBand: { kind: 'RANGE', fromManYen: 60, toManYen: 70 },
      availabilityBand: 'NEXT_MONTH',
      prefecture: '13',
      remoteMode: 'PARTIAL_REMOTE',
      // 🔴 JST。`toISOString().slice(0,10)`（UTC 切り出し）なら `2026-09-07` になっていた。
      updatedOn: '2026-09-08',
    });
  });

  it('🔴 `updatedOn` は JST 暦日である（UTC 切り出しとの差が出る時刻で確かめる）', () => {
    const [view] = build([source({ updatedAt: UPDATED_AT_1 })]);
    expect(view?.updatedOn).toBe('2026-09-08');
    // 🔴 UTC 切り出し（`toISOString().slice(0, 10)`）なら前日になる。
    //    入口検査（`docs/05` §4.6.3）は形式しか見ないので、**基準がずれても落ちない** ——
    //    だからここで基準そのものを固定する。
    expect(UPDATED_AT_1.toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(view?.updatedOn).not.toBe(UPDATED_AT_1.toISOString().slice(0, 10));
  });

  it('🔴 未知の都道府県・リモート区分は素通ししない（fail-closed で null）', () => {
    // 🔴 型の上では起こらない値を**意図的に**流し込む（DB の CHECK が緩んだ / 列に別の値が
    //    入った場合の備え）。型で守れている前提に寄りかからないための対照である。
    const driftedRemoteMode = 'HYBRID_TUESDAY' as unknown as SharedCandidateSource['remoteMode'];
    const [view] = build([source({ prefecture: '東京都渋谷区', remoteMode: driftedRemoteMode })]);
    expect(view?.prefecture).toBeNull();
    expect(view?.remoteMode).toBeNull();
    expect(JSON.stringify(view)).not.toContain('渋谷区');
  });
});

// ---------------------------------------------------------------------------
// F-017 AC-2: 案件をまたいだ突合ができない
// ---------------------------------------------------------------------------

describe('🔴 F-017 AC-2 / BR-55: 案件をまたいで同一人物を突き合わせられない', () => {
  it('同じエンジニアでも案件が違えば参照子が違う', () => {
    const [inProject1] = build([source()], PROJECT_1);
    const [inProject2] = build([source()], PROJECT_2);
    expect(inProject1?.candidateRef).not.toBe(inProject2?.candidateRef);
  });

  it('🔴 2 つの案件の応答を突き合わせても、一致する識別子が 1 つも無い', () => {
    const rows = [source(), source({ engineerId: ENGINEER_2, updatedAt: UPDATED_AT_2 })];
    const refs1 = build(rows, PROJECT_1).map((view) => view.candidateRef);
    const refs2 = build(rows, PROJECT_2).map((view) => view.candidateRef);
    expect(refs1.some((ref) => refs2.includes(ref))).toBe(false);
  });

  it('🔴 応答に `engineerId` / `skillId` / 生の `updatedAt` が 1 文字も現れない', () => {
    const serialized = JSON.stringify(build([source()]));
    for (const forbidden of [
      ENGINEER_1,
      SKILL_TS,
      SKILL_GO,
      UPDATED_AT_1.toISOString(),
      String(UPDATED_AT_1.getTime()),
      '650000',
      '2026-10-01',
    ]) {
      expect(serialized, `禁止された値が応答に含まれている: ${forbidden}`).not.toContain(forbidden);
    }
    // 空振り防止（対照）: 出てよい値は確かに出ている。
    expect(serialized).toContain('TypeScript');
    expect(serialized).toContain('2026-09-08');
  });

  it('🔴 同日の候補の相対順序が案件ごとに変わる（並び順からの突合を断つ）', () => {
    // 🔴 鍵・案件 ID・エンジニア ID をすべて固定してあるので、この判定は**決定的**である
    //    （乱数に依存しない）。示しているのは「案件ごとにタイブレークが変わる」という性質で
    //    あって、「常に順序が一致しない」ことの一般証明ではない —— 候補が 1 件のときや
    //    更新日が全て異なるときは順序が一致しうる（それは並び順の規則どおりであり、
    //    突合の材料としては `updatedOn`（日単位）の粒度までしか与えない）。
    // 3 件とも同じ更新日にして、並びが参照子だけで決まる状況を作る。
    const rows = [
      source({ engineerId: ENGINEER_1 }),
      source({ engineerId: ENGINEER_2 }),
      source({ engineerId: ENGINEER_3 }),
    ];
    const order1 = build(rows, PROJECT_1).map((view) => view.candidateRef);
    const order2 = build(rows, PROJECT_2).map((view) => view.candidateRef);

    // 「どの参照子が何番目か」を案件間で写像しても、同じエンジニアの順位が保たれない。
    const rankIn = (refs: readonly string[], projectId: string, engineerId: string): number =>
      refs.indexOf(candidateRef(projectId, engineerId));
    const ranks1 = [ENGINEER_1, ENGINEER_2, ENGINEER_3].map((id) => rankIn(order1, PROJECT_1, id));
    const ranks2 = [ENGINEER_1, ENGINEER_2, ENGINEER_3].map((id) => rankIn(order2, PROJECT_2, id));
    expect(ranks1).not.toEqual(ranks2);
    // 空振り防止: どちらの案件でも 3 件すべてに順位が付いている。
    expect(ranks1.sort()).toEqual([0, 1, 2]);
    expect(ranks2.sort()).toEqual([0, 1, 2]);
  });

  it('🔴 参照子が想定の表記でない場合は組み立てが失敗する（ID の素通しを入口で落とす）', () => {
    expect(() =>
      buildAnonymousCandidateViews({
        projectId: PROJECT_1,
        rows: [source()],
        referenceDate: REFERENCE_DATE,
        // 「参照子として engineerId を返す」実装ミスの再現。
        candidateRef: (_projectId, engineerId) => engineerId,
      }),
    ).toThrow(AnonymousCandidateViewError);
  });

  it('🔴 失敗時のメッセージに `engineerId` が載らない', () => {
    try {
      buildAnonymousCandidateViews({
        projectId: PROJECT_1,
        rows: [source()],
        referenceDate: REFERENCE_DATE,
        candidateRef: (_projectId, engineerId) => engineerId,
      });
      expect.unreachable('AnonymousCandidateViewError が投げられるはず');
    } catch (error) {
      expect((error as Error).message).not.toContain(ENGINEER_1);
    }
  });
});

// ---------------------------------------------------------------------------
// 並び順（docs/03 §4.13.2-2）
// ---------------------------------------------------------------------------

describe('🔴 並び順: updatedOn 降順 → candidateRef 昇順（docs/03 §4.13.2-2）', () => {
  it('更新日の新しい順に並ぶ', () => {
    const views = build([
      source({ engineerId: ENGINEER_2, updatedAt: UPDATED_AT_2 }),
      source({ engineerId: ENGINEER_1, updatedAt: UPDATED_AT_1 }),
    ]);
    expect(views.map((view) => view.updatedOn)).toEqual(['2026-09-08', '2026-09-07']);
  });

  it('同日内は参照子の昇順である', () => {
    const views = build([
      source({ engineerId: ENGINEER_1 }),
      source({ engineerId: ENGINEER_2 }),
      source({ engineerId: ENGINEER_3 }),
    ]);
    const refs = views.map((view) => view.candidateRef);
    expect([...refs].sort()).toEqual(refs);
  });

  it('🔴 入力の並びに依存しない（10 回シャッフルしても同じ結果）', () => {
    const rows = [
      source({ engineerId: ENGINEER_1 }),
      source({ engineerId: ENGINEER_2, updatedAt: UPDATED_AT_2 }),
      source({ engineerId: ENGINEER_3 }),
    ];
    const expected = build(rows).map((view) => view.candidateRef);
    for (let i = 0; i < 10; i += 1) {
      const rotated = [...rows.slice(i % rows.length), ...rows.slice(0, i % rows.length)];
      expect(build(rotated).map((view) => view.candidateRef)).toEqual(expected);
    }
  });

  it('比較関数は全順序である（同一候補のみ 0 を返す）', () => {
    const views = build([source({ engineerId: ENGINEER_1 }), source({ engineerId: ENGINEER_2 })]);
    expect(views).toHaveLength(2);
    const [a, b] = views as readonly [AnonymousCandidateView, AnonymousCandidateView];
    expect(compareAnonymousCandidateViews(a, a)).toBe(0);
    expect(compareAnonymousCandidateViews(a, b)).toBeLessThan(0);
    expect(compareAnonymousCandidateViews(b, a)).toBeGreaterThan(0);
  });
});
