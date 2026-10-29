// packages/db/src/search/projects.test.ts
// `GET /api/projects`（#25）の**述語の組み立て**と**既定の並び**（`search/projects.ts`）。
// T-06-03 で `apps/web/lib/projects/list.test.ts` として書いたもののうち、T-06-05 の移設で
// ここへ移った部分（検索述語と `ORDER BY`）。一覧の `select` する列の検査は `apps/web` に残る。
//
// 🔴 ここで固定するのは 2 点である:
//   ①検索条件が指定されたときだけ述語が増えること（`F-015` の入力）
//   ②既定の並びが `募集中 → 終了` → 更新日時 → 開始日 → id であること
//     （✅ 2026-10-16: 状態が 2 値になった。Issue #98）
//     （`docs/04` §S-010 / `F-015 AC-3`）
// 🔴 「述語に境界の条件（`tenantId` / `partnerCompanyId` / 公開範囲）が 1 つも無い」は
//    `apps/web/lib/api/search-isolation.test.ts` が固定する。
// 🔴 実 DB での並び（照合順序）と `total` の母集団は `tests/isolation/projects.test.ts` が固定する。
import { describe, expect, it } from 'vitest';
import { PROJECT_STATUSES, type ProjectStatus } from '../schema-value-sets.js';
import {
  assertStatusPriority,
  PROJECT_LIST_ORDER_BY,
  PROJECT_STATUS_LIST_PRIORITY,
  projectSearchWhere,
  type ProjectSearchCriteria,
} from './projects.js';
// ✅ 2026-10-15: 単価レンジの述語は人材検索と共有している（T-06-03 の申し送りの決着）。
import { engineerPriceConditions } from './engineers.js';
import { unitPriceOverlapConditions } from './unit-price-range.js';

/** `where` を素の JSON にして「何が入っているか」を文字列として数える。 */
function whereJson(criteria: ProjectSearchCriteria = {}): string {
  return JSON.stringify(projectSearchWhere(criteria));
}

describe('検索条件 → 述語（`F-015` の入力）', () => {
  it('条件が 1 つも無ければ `where` は空である（＝ 母集団そのもの）', () => {
    expect(projectSearchWhere({})).toEqual({});
  });

  it('状態は等値で絞る', () => {
    expect(projectSearchWhere({ status: 'CLOSED' })).toEqual({
      status: 'CLOSED',
    });
  });

  it('開始日は「この日以降」で絞る', () => {
    expect(projectSearchWhere({ startFrom: '2026-10-01' })).toEqual({
      startDate: { gte: new Date('2026-10-01T00:00:00.000Z') },
    });
  });

  it('勤務地は等値で絞る', () => {
    expect(projectSearchWhere({ prefecture: '13' })).toEqual({ prefecture: '13' });
  });

  // ✅✅ **2026-10-16（人間の明示指示「半角・全角スペース区切りで複数語 → AND 条件」）:
  //    フリーワードが `AND` の中に入った。**
  // 🔴 **トップレベルの `OR` をやめた理由**: 語ごとに `OR`（列の集合）を作るので、
  //    `OR` を使う条件が 2 つ以上になる。オブジェクトの同じキーは後から書いたほうが勝つため、
  //    以前の形のままだと **2 語目以降が静かに消えていた**。
  it('フリーワードは案件名・業務概要・公開メモ・必須と尚可のスキルを見る', () => {
    expect(projectSearchWhere({ q: '基幹' })).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: '基幹', mode: 'insensitive' } },
            { publicSummary: { contains: '基幹', mode: 'insensitive' } },
            { publicMemo: { contains: '基幹', mode: 'insensitive' } },
            { requirements: { some: { OR: [{ freeText: { contains: '基幹', mode: 'insensitive' } }, { skill: { name: { contains: '基幹', mode: 'insensitive' } } }] } } },
          ],
        },
      ],
    });
  });

  it('🔴 複数語は AND で重なる（語ごとに公開対象のいずれかとの一致を要求する）', () => {
    expect(projectSearchWhere({ q: '基幹 刷新' })).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: '基幹', mode: 'insensitive' } },
            { publicSummary: { contains: '基幹', mode: 'insensitive' } },
            { publicMemo: { contains: '基幹', mode: 'insensitive' } },
            { requirements: { some: { OR: [{ freeText: { contains: '基幹', mode: 'insensitive' } }, { skill: { name: { contains: '基幹', mode: 'insensitive' } } }] } } },
          ],
        },
        {
          OR: [
            { name: { contains: '刷新', mode: 'insensitive' } },
            { publicSummary: { contains: '刷新', mode: 'insensitive' } },
            { publicMemo: { contains: '刷新', mode: 'insensitive' } },
            { requirements: { some: { OR: [{ freeText: { contains: '刷新', mode: 'insensitive' } }, { skill: { name: { contains: '刷新', mode: 'insensitive' } } }] } } },
          ],
        },
      ],
    });
  });

  it('🔴 全角の空白でも区切る（日本語入力のまま打った利用者だけ 1 語扱いにしない）', () => {
    expect(projectSearchWhere({ q: '基幹　刷新' }).AND).toHaveLength(2);
  });

  it('🔴 空白だけのフリーワードは条件にならない（空語の部分一致は全件に一致する）', () => {
    expect(projectSearchWhere({ q: '   ' })).toEqual({});
  });

  it('🔴 同じ語を 2 回書いても述語は増えない（走査量だけが増える）', () => {
    expect(projectSearchWhere({ q: '基幹 基幹' }).AND).toHaveLength(1);
  });

  // ✅ 2026-10-16（人間の明示指示「ON で ステータス = 募集中 に絞る（ステータスセレクトと
  //    併用時は AND）」）。
  it('🔴 「募集中のみ」は `status` と独立した条件として `AND` に積む', () => {
    expect(projectSearchWhere({ recruitingOnly: true })).toEqual({ AND: [{ status: 'OPEN' }] });
  });

  it('🔴 ステータスと併用して矛盾したら 0 件になる形である（どちらも黙って捨てない）', () => {
    const where = projectSearchWhere({ status: 'CLOSED', recruitingOnly: true });
    expect(where.status).toBe('CLOSED');
    expect(where.AND).toEqual([{ status: 'OPEN' }]);
  });

  it('🔴 「募集中のみ」が false のときは条件を足さない', () => {
    expect(projectSearchWhere({ recruitingOnly: false })).toEqual({});
  });

  // ✅ 2026-10-16（人間の明示指示「稼働形態」）。
  it('稼働形態は等値で絞る（値集合は `REMOTE_MODES` の 3 値）', () => {
    expect(projectSearchWhere({ remoteMode: 'FULL_REMOTE' })).toEqual({
      remoteMode: 'FULL_REMOTE',
    });
  });

  // ✅✅ 2026-10-16（受領モック `デザインモック/自社案件管理_案件一覧.png` の絞り込み。
  //    [Issue #113](https://github.com/Festal-KM/SES-Platform/issues/113)「設計から改訂して」）。
  it('カテゴリは等値で絞る', () => {
    expect(projectSearchWhere({ category: 'BACKEND' })).toEqual({ category: 'BACKEND' });
  });

  it('案件区分は等値で絞る', () => {
    expect(projectSearchWhere({ sourceKind: 'PARTNER' })).toEqual({ sourceKind: 'PARTNER' });
  });

  it('🔴 並行可否は `false` でも条件になる（「不可で絞る」が落ちない）', () => {
    expect(projectSearchWhere({ parallelOk: true })).toEqual({ parallelOk: true });
    // 🔴 `false` を「指定なし」に畳むと、**「不可」で絞った瞬間に全件が出る**。
    expect(projectSearchWhere({ parallelOk: false })).toEqual({ parallelOk: false });
  });

  it('🔴 開始時期は下端と上端を 1 つの `startDate` に畳む（区分は両端を持つ）', () => {
    const where = projectSearchWhere({ startFrom: '2026-11-01', startTo: '2026-12-01' });
    expect(where.startDate?.gte?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(where.startDate?.lt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('🔴 上端だけでも条件になる（「即日」は下端を持たない）', () => {
    const where = projectSearchWhere({ startTo: '2026-10-17' });
    expect(where.startDate?.gte).toBeUndefined();
    expect(where.startDate?.lt?.toISOString()).toBe('2026-10-17T00:00:00.000Z');
  });

  it('複数条件は AND として重なる（キーが並ぶ）', () => {
    expect(Object.keys(projectSearchWhere({ status: 'OPEN', prefecture: '13' })).sort()).toEqual([
      'prefecture',
      'status',
    ]);
  });

  // ✅ 2026-10-15: 単価レンジ（`unitPriceOverlapConditions` を人材検索と共有する）。
  it('単価の下限を指定すると、案件の**上限**がそれ以上のものに絞る（NULL は制約なし）', () => {
    expect(projectSearchWhere({ priceMin: 700_000 })).toEqual({
      AND: [{ OR: [{ unitPriceMax: null }, { unitPriceMax: { gte: 700_000 } }] }],
    });
  });

  it('単価の上限を指定すると、案件の**下限**がそれ以下のものに絞る（NULL は制約なし）', () => {
    expect(projectSearchWhere({ priceMax: 800_000 })).toEqual({
      AND: [{ OR: [{ unitPriceMin: null }, { unitPriceMin: { lte: 800_000 } }] }],
    });
  });

  it('🔴 人材検索（`#15`）と同じ述語を返す（2 画面で重なりの定義を分けない）', () => {
    const criteria = { priceMin: 600_000, priceMax: 900_000 } as const;
    expect(projectSearchWhere(criteria).AND).toEqual(unitPriceOverlapConditions(criteria));
    // 🔴 人材側の条件は**必須キーを持つ**（`skillMode` / `onlyInTime` / `onlyCommutable`）。
    //    単価に関係しないキーを埋めて呼ぶ —— **型をねじ伏せない**（`as any` を書くと、
    //    人材側の条件が変わったときにこの対照が静かに意味を失う）。
    expect(
      engineerPriceConditions({
        ...criteria,
        skillMode: 'AND',
        onlyInTime: false,
        onlyCommutable: false,
      }),
    ).toEqual(unitPriceOverlapConditions(criteria));
  });

  // ✅ **2026-10-16: 形が変わった**（フリーワードも `AND` の要素になった。上の 🔴）。
  // 🔴 **守っている性質は同じである**: 単価レンジとフリーワードが**両方とも残ること**。
  it('🔴 単価レンジはフリーワードを消さない（どちらも `AND` の要素として残る）', () => {
    const where = projectSearchWhere({ q: '基幹', priceMin: 700_000 });
    // 単価の 1 条件 + フリーワード 1 語 = 2 要素。
    expect(where.AND).toHaveLength(2);
    expect(JSON.stringify(where)).toContain('publicSummary');
    expect(JSON.stringify(where)).toContain('unitPriceMax');
    // 🔴 トップレベルに `OR` を残さない（残すと 2 つ目の `OR` が上書きで消える形に戻る）。
    expect(where.OR).toBeUndefined();
  });

  it('🔴 条件を全部重ねても 1 つも落ちない（`AND` の要素数で数える）', () => {
    const where = projectSearchWhere({
      q: '基幹 刷新',
      priceMin: 700_000,
      priceMax: 900_000,
      recruitingOnly: true,
      status: 'OPEN',
      prefecture: '13',
      remoteMode: 'FULL_REMOTE',
      startFrom: '2026-11-01',
    });
    // 単価 2 + フリーワード 2 語 + 募集中のみ 1 = 5 要素。
    expect(where.AND).toHaveLength(5);
    expect(where.status).toBe('OPEN');
    expect(where.prefecture).toBe('13');
    expect(where.remoteMode).toBe('FULL_REMOTE');
    expect(where.startDate).toBeDefined();
  });

  // ✅✅ 2026-10-16: 受領モックの 9 条件を全部重ねても 1 つも落ちないこと。
  it('🔴 モックの絞り込みを全部指定しても、条件が 1 つも落ちない', () => {
    const where = projectSearchWhere({
      q: '基幹',
      status: 'OPEN',
      sourceKind: 'OWN',
      category: 'BACKEND',
      remoteMode: 'FULL_REMOTE',
      priceMin: 700_000,
      priceMax: 900_000,
      prefecture: '13',
      startFrom: '2026-11-01',
      startTo: '2026-12-01',
      parallelOk: true,
      recruitingOnly: true,
    });
    expect(where.status).toBe('OPEN');
    expect(where.sourceKind).toBe('OWN');
    expect(where.category).toBe('BACKEND');
    expect(where.remoteMode).toBe('FULL_REMOTE');
    expect(where.prefecture).toBe('13');
    expect(where.parallelOk).toBe(true);
    expect(where.startDate?.gte).toBeDefined();
    expect(where.startDate?.lt).toBeDefined();
    // 単価 2 + フリーワード 1 語 + 募集中のみ 1 = 4 要素。
    expect(where.AND).toHaveLength(4);
  });

  it('🔴 商流情報の列を検索対象にしない（ホストだけ一致する述語を作らない）', () => {
    const json = whereJson({ q: '架空エンド' });
    expect(json).not.toContain('endClientName');
    expect(json).not.toContain('internalUnitPrice');
  });
});

describe('🔴 F-015 AC-3: 既定の並びが決定的である', () => {
  it('並びは 状態 → 更新日時 → 開始日 → id の 4 段である', () => {
    expect(PROJECT_LIST_ORDER_BY).toEqual([
      { status: 'desc' },
      { updatedAt: 'desc' },
      { startDate: { sort: 'asc', nulls: 'last' } },
      { id: 'desc' },
    ]);
  });

  it('🔴 `ORDER BY` に「全体件数」「順位」「スコア」を持ち込まない（docs/05 §4.8）', () => {
    const json = JSON.stringify(PROJECT_LIST_ORDER_BY);
    expect(json).not.toContain('_count');
    expect(json).not.toContain('score');
    expect(json).not.toContain('rank');
  });

  // ✅✅ **2026-10-16（[Issue #98](https://github.com/Festal-KM/SES-Platform/issues/98) の回答
  //    「募集中と終了の二つだけでよい」）: 旧 `後任募集` は `OPEN` に合流した。**
  // 🔴 **上位に来るべきものは変わっていない** —— 営業が最初に見たいのは**まだ出せる案件**であり、
  //    2 値ではそれが `OPEN` である。
  it('🔴 募集中が既定の並びで上位に来る（`docs/04` §S-010）', () => {
    expect(PROJECT_STATUS_LIST_PRIORITY[0]).toBe('OPEN');
    expect(PROJECT_STATUS_LIST_PRIORITY.at(-1)).toBe('CLOSED');
  });

  it('🔴 状態の優先順位が `status` の降順と一致する（一致しなければ import 時に落ちる）', () => {
    // `PROJECT_LIST_ORDER_BY` の第 1 キーは `status: 'desc'` であり、DB は値の綴りで並べる。
    // 綴りの降順が優先順位と一致することが、募集中を上位に置く実装の前提である
    // （`'OPEN' > 'CLOSED'`。2 値になっても成立している）。
    expect([...PROJECT_STATUSES].sort().reverse()).toEqual([...PROJECT_STATUS_LIST_PRIORITY]);
  });

  it('状態の値集合が優先順位と過不足なく一致する（状態を足したら気づける）', () => {
    expect([...PROJECT_STATUS_LIST_PRIORITY].sort()).toEqual([...PROJECT_STATUSES].sort());
  });

  // 🔴 上の 2 本は「いま一致していること」しか言えない。**検査そのものが落ちること**を
  //    ここで示す —— これが無いと「読み込み時に落ちる」は注釈の主張のままになる
  //    （code-reviewer 指摘、T-06-03 Iteration 2）。
  describe('🔴 `assertStatusPriority` は `PROJECT_STATUSES` と照合する（宣言の自己照合にしない）', () => {
    it('現在の宣言は通る（対照）', () => {
      expect(() => {
        assertStatusPriority(PROJECT_STATUS_LIST_PRIORITY);
      }).not.toThrow();
    });

    it('🔴 状態が欠けていたら落ちる（＝ 順位が未定の状態がある）', () => {
      expect(() => {
        assertStatusPriority(['OPEN']);
      }).toThrow(/PROJECT_STATUS_LIST_PRIORITY/);
    });

    it('🔴 綴りの降順と違う並びを宣言したら落ちる（募集中が静かに沈まない）', () => {
      expect(() => {
        assertStatusPriority(['CLOSED', 'OPEN']);
      }).toThrow(/PROJECT_STATUS_LIST_PRIORITY/);
    });

    it('値集合に無い状態を宣言したら落ちる', () => {
      expect(() => {
        assertStatusPriority(['OPEN', 'CLOSED', 'ARCHIVED' as ProjectStatus]);
      }).toThrow(/PROJECT_STATUS_LIST_PRIORITY/);
    });
  });
});

describe('基本検索とグループ検索', () => {
  it('フェーズはOR、方式と稼働率はANDで組む', () => {
    expect(projectSearchWhere({ developmentPhases: ['BASIC_DESIGN', 'DETAIL_DESIGN'], developmentMethod: 'AGILE', utilizationMin: 60, utilizationMax: 80 })).toEqual({ developmentPhases: { hasSome: ['BASIC_DESIGN', 'DETAIL_DESIGN'] }, developmentMethod: 'AGILE', utilizationRate: { gte: 60, lte: 80 } });
  });
  it('グループ内はOR、グループ同士はAND。必須・尚可の両方を対象とする', () => {
    const where = projectSearchWhere({ q: 'Java | Springboot', keywordGroups: JSON.stringify([['基本設計', '内部設計'], ['マネジメント']]) });
    expect(where.AND).toHaveLength(3);
    const groups = where.AND?.map(group => JSON.stringify(group));
    expect(groups?.filter(group => group.includes('基本設計') && group.includes('内部設計'))).toHaveLength(1);
    expect(groups?.filter(group => group.includes('Java') && group.includes('Springboot'))).toHaveLength(1);
    expect(JSON.stringify(where)).toContain('publicMemo');
    expect(JSON.stringify(where)).toContain('requirements');
    expect(JSON.stringify(where)).not.toContain('kind');
    expect(JSON.stringify(where)).not.toContain('remarks');
  });
  it('内部備考は認証文脈から許可した場合だけ検索する', () => {
    expect(JSON.stringify(projectSearchWhere({ q: '社内連絡' }))).not.toContain('remarks');
    expect(JSON.stringify(projectSearchWhere({ q: '社内連絡', searchInternalRemarks: true }))).toContain('remarks');
    expect(JSON.stringify(projectSearchWhere({ q: '社内連絡', searchInternalRemarks: true }))).not.toContain('endClientName');
  });
});

it('グループ内ANDとグループ内ORを混ぜても外側はANDになる', () => {
  const where = projectSearchWhere({ keywordGroups: JSON.stringify([{ mode: 'AND', terms: ['Java', 'Springboot'] }, { mode: 'OR', terms: ['基本設計','内部設計'] }]) });
  expect(where.AND).toHaveLength(2);
  expect(where.AND?.[0]?.AND).toHaveLength(2);
  expect(where.AND?.[1]?.OR).toHaveLength(2);
});

it('稼働率の境界が重ならない', () => {
  expect(projectSearchWhere({utilizationBand:'FULL'}).AND).toEqual([{utilizationRate:{gte:100,lte:100}}]);
  expect(projectSearchWhere({utilizationBand:'HALF_TO_FULL'}).AND).toEqual([{utilizationRate:{gte:50,lte:99}}]);
  expect(projectSearchWhere({utilizationBand:'UNDER_HALF'}).AND).toEqual([{utilizationRate:{gte:1,lte:49}}]);
});
