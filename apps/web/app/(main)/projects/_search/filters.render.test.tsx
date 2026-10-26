// apps/web/app/(main)/projects/_search/filters.render.test.tsx
// ⚠️ **拡張子が `.render.test.tsx` なのは vitest の `include` に合わせるためである**
//    （`apps/*/app/**/*.render.test.tsx` だけが拾われる。`vitest.config.ts`）。
//    🔴 中身は**純粋関数のテスト**であり、描画は 1 つも行わない。
// 検索エリアの**導出**（改修指示書 §3 / §4 / §6）のユニットテスト。
//
// 🔴 ここで固定するのは「画面を開かないと分からない」ことではなく、**算数と写像**である:
//    ① 条件バーのバッジの作り方（初期値はバッジにしない / 項目名を付ける / 金額は 1 バッジ）
//    ② バッジの `×` が**その条件だけ**を初期値に戻すこと
//    ③ `未適用` の判定（`draft` と `applied` の同値性。スキルは順序を見ない）
//    ④ 「＋N」の個数（**欄幅と語長の実測から決まる**。✅✅ 2026-10-19 に人間の指示
//       「見切れない範囲まではバッジを表示して。見切れる分だけ『＋１』などの表示をして。」で
//       指示書の「基本は最大 2 つ」を上書きした。1 つも収まらない場合は『5 件選択』）
//    ⑤ 保存されていた値の正規化（🔴 **古い `並行可否` を読み捨てる**）
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PROJECT_SEARCH_DRAFT,
  isEmptyProjectSearchDraft,
  isProjectPriceRangeInverted,
  isSameProjectSearchDraft,
  parseSavedProjectSearchDraft,
  projectSearchChips,
  removeProjectSearchChip,
  type ProjectSearchChipLabels,
} from './filters';
import { visibleChipCount } from './active-filter-bar';
import { visibleSkillBadgeCount } from './skill-multi-select';
import { filterColumnCount } from './search-filter-form';

const labels: ProjectSearchChipLabels = {
  statusOptions: [
    { value: '', label: 'すべて' },
    { value: 'OPEN', label: '募集中' },
  ],
  categoryOptions: [
    { value: '', label: 'すべて' },
    { value: 'BACKEND', label: 'バックエンド' },
  ],
  remoteModeOptions: [
    { value: '', label: 'すべて' },
    { value: 'FULL_REMOTE', label: 'フルリモート可' },
  ],
  prefectureOptions: [
    { value: '', label: 'すべて' },
    { value: '13', label: '東京都' },
  ],
  startWithinOptions: [
    { value: '', label: 'すべて' },
    { value: 'THIS_MONTH', label: '今月' },
  ],
  skillOptions: [
    { value: 's1', label: 'Python' },
    { value: 's2', label: 'Java' },
  ],
  fieldLabels: {
    q: 'フリーワード',
    category: 'カテゴリ',
    prefecture: '勤務地',
    startWithin: '開始時期',
    price: '単価（月額）',
  },
  fieldSeparator: '：',
  priceRangeSeparator: '〜',
  priceUnit: '円',
};

describe('🔴 条件バーのバッジ（指示書 §4）', () => {
  it('🔴🔴 「すべて」などの初期値はバッジにしない（1 つも条件が無ければ 0 件）', () => {
    expect(projectSearchChips(EMPTY_PROJECT_SEARCH_DRAFT, labels)).toEqual([]);
  });

  it('🔴 意味が曖昧になる値には項目名を付ける（勤務地：東京都 / カテゴリ：バックエンド）', () => {
    const chips = projectSearchChips(
      { ...EMPTY_PROJECT_SEARCH_DRAFT, prefecture: '13', category: 'BACKEND' },
      labels,
    );

    expect(chips.map((chip) => chip.label)).toEqual(['カテゴリ：バックエンド', '勤務地：東京都']);
  });

  it('🔴 ステータスと稼働形態は語だけで意味が通るので項目名を付けない', () => {
    const chips = projectSearchChips(
      { ...EMPTY_PROJECT_SEARCH_DRAFT, status: 'OPEN', remoteMode: 'FULL_REMOTE' },
      labels,
    );

    expect(chips.map((chip) => chip.label)).toEqual(['募集中', 'フルリモート可']);
  });

  it('🔴 スキルは 1 項目につき 1 バッジ、金額範囲は上下限をまとめて 1 バッジ', () => {
    const chips = projectSearchChips(
      { ...EMPTY_PROJECT_SEARCH_DRAFT, skills: ['s1', 's2'], priceMin: '600000', priceMax: '800000' },
      labels,
    );

    expect(chips.map((chip) => chip.key)).toEqual(['skill:s1', 'skill:s2', 'price']);
    // 🔴 単位は円のまま（指示書 §3）。
    expect(chips.at(-1)?.label).toBe('単価（月額）：600000〜800000円');
  });

  it('🔴 選択肢に無い値はバッジにしない（URL 直打ちで語の無いバッジが出ない）', () => {
    const chips = projectSearchChips(
      { ...EMPTY_PROJECT_SEARCH_DRAFT, status: 'UNKNOWN', skills: ['zzz'] },
      labels,
    );

    expect(chips).toEqual([]);
  });
});

describe('🔴 バッジの `×` はその条件だけを初期値に戻す（指示書 §4）', () => {
  it('スキルは 1 件だけ外れる', () => {
    const next = removeProjectSearchChip(
      { ...EMPTY_PROJECT_SEARCH_DRAFT, skills: ['s1', 's2'], status: 'OPEN' },
      'skill:s1',
    );

    expect(next.skills).toEqual(['s2']);
    expect(next.status).toBe('OPEN');
  });

  it('🔴 金額は 1 バッジなので上下限をまとめて戻る', () => {
    const next = removeProjectSearchChip(
      { ...EMPTY_PROJECT_SEARCH_DRAFT, priceMin: '1', priceMax: '2', q: '基幹' },
      'price',
    );

    expect(next.priceMin).toBe('');
    expect(next.priceMax).toBe('');
    expect(next.q).toBe('基幹');
  });

  it('🔴 未知の鍵では何も変えない（黙って別の条件を消さない）', () => {
    const draft = { ...EMPTY_PROJECT_SEARCH_DRAFT, status: 'OPEN' };

    expect(removeProjectSearchChip(draft, 'nope')).toEqual(draft);
  });
});

describe('🔴 「未適用」の判定（指示書 §6）', () => {
  it('🔴 スキルの並び順が違っても同じ条件である（OR なので順序に意味が無い）', () => {
    expect(
      isSameProjectSearchDraft(
        { ...EMPTY_PROJECT_SEARCH_DRAFT, skills: ['s1', 's2'] },
        { ...EMPTY_PROJECT_SEARCH_DRAFT, skills: ['s2', 's1'] },
      ),
    ).toBe(true);
  });

  it('1 つでも違えば未適用である', () => {
    expect(
      isSameProjectSearchDraft(EMPTY_PROJECT_SEARCH_DRAFT, {
        ...EMPTY_PROJECT_SEARCH_DRAFT,
        q: 'a',
      }),
    ).toBe(false);
    expect(isEmptyProjectSearchDraft(EMPTY_PROJECT_SEARCH_DRAFT)).toBe(true);
  });

  it('🔴 単価の下限 > 上限（片方だけの指定は正当である）', () => {
    expect(
      isProjectPriceRangeInverted({ ...EMPTY_PROJECT_SEARCH_DRAFT, priceMin: '2', priceMax: '1' }),
    ).toBe(true);
    expect(
      isProjectPriceRangeInverted({ ...EMPTY_PROJECT_SEARCH_DRAFT, priceMin: '2', priceMax: '' }),
    ).toBe(false);
  });
});

describe('🔴🔴 保存されていた値の正規化（指示書 §3 / §8 の完成条件）', () => {
  it('🔴 古い保存条件に `並行可否` が入っていても読み捨てる（検索に影響しない）', () => {
    const parsed = parseSavedProjectSearchDraft({
      q: '基幹',
      parallelOk: '1',
      sourceKind: 'OWN',
      skills: ['s1', 42],
    });

    expect(parsed).not.toBeNull();
    expect(parsed).toEqual({ ...EMPTY_PROJECT_SEARCH_DRAFT, q: '基幹', skills: ['s1'] });
    expect(Object.keys(parsed ?? {})).not.toContain('parallelOk');
  });

  it('🔴 壊れた値は `null`（画面を落とさない）', () => {
    expect(parseSavedProjectSearchDraft(null)).toBeNull();
    expect(parseSavedProjectSearchDraft('x')).toBeNull();
  });
});

// ============================================================================
// 🔴🔴 スキル欄の「＋N」の個数
// ============================================================================
// ✅✅ **2026-10-19: 「基本は最大 2 つ」という上限を撤廃した**（人間の明示指示「スキルの部分は
//    見切れない範囲まではバッジを表示して。見切れる分だけ『＋１』などの表示をして」）。
//    🔴 **改修指示書 §3 の記述はこの指示が上書きした**ので、ここで固定するのは
//    **「入るだけ入れる」**である（**上限の件数を固定しない** —— 固定し直すと同じ不具合が戻る）。
// 🔴 **幅はバッジ 1 つずつの実測値を配列で渡す**（`visibleChipCount` と同じ署名）。
//    `Java` 相当のバッジは実測 60px 程度、`max-w-32` で省略が始まる長い語は 128px である。
//    ⚠️ 器の幅からは `FRAME_PX`（左右の padding 24 + chevron 16 + 間隔 8 = 48）が引かれる。
const SHORT = 60;
const LONG = 128;
const badges = (count: number, width: number = SHORT): readonly number[] =>
  Array.from({ length: count }, () => width);

describe('🔴🔴 スキル欄の「＋N」の個数（2026-10-19: 上限を撤廃し「入るだけ入れる」に変えた）', () => {
  it('🔴 まだ測っていない（`null`）なら全件（サーバ描画と水和直後で見た目が変わらない）', () => {
    expect(visibleSkillBadgeCount(null, badges(5))).toBe(5);
    expect(visibleSkillBadgeCount(null, badges(20))).toBe(20);
    expect(visibleSkillBadgeCount(null, badges(1))).toBe(1);
    expect(visibleSkillBadgeCount(null, [])).toBe(0);
  });

  it('🔴🔴 余裕があるだけ出す（**上限 2 件で切らない**。これが 2026-10-19 の不具合そのもの）', () => {
    // 器 400 → 使えるのは 352。短いバッジ 3 つ（60×3 + 間隔 4×2 = 188）は余裕で入る。
    expect(visibleSkillBadgeCount(400, badges(3))).toBe(3);
    // 器 500 → 使えるのは 452。7 つ（60×7 + 4×6 = 444）まで入る。
    expect(visibleSkillBadgeCount(500, badges(7))).toBe(7);
  });

  it('🔴 入りきらない分だけ「＋N」にまとめる（「＋N」の幅を先に確保してから数える）', () => {
    // 器 500 で 8 つ（508）は入らない → 「＋N」(52) と間隔(4) を引いた 396 に 6 つ（380）。
    expect(visibleSkillBadgeCount(500, badges(8))).toBe(6);
    // 器 400 で 5 つ（316 ≤ 352）は入る。6 つ（380）は入らず、296 に 4 つ（252）。
    expect(visibleSkillBadgeCount(400, badges(5))).toBe(5);
    expect(visibleSkillBadgeCount(400, badges(6))).toBe(4);
  });

  it('🔴🔴 同じ幅でも語の長さで入る数が変わる（持ち分の決め打ちでは満たせない）', () => {
    // 器 300（使えるのは 252）: 短い 4 つ（252）はちょうど入るが、長い語は 1 つ + ＋3。
    expect(visibleSkillBadgeCount(300, badges(4, SHORT))).toBe(4);
    expect(visibleSkillBadgeCount(300, badges(4, LONG))).toBe(1);
  });

  it('🔴 1 つも収まらない幅では 0（＝呼び出し側が「N 件選択」に切り替える）', () => {
    expect(visibleSkillBadgeCount(200, badges(5))).toBe(1);
    expect(visibleSkillBadgeCount(120, badges(5))).toBe(0);
    // 🔴 1 件しか選んでいなくても、入らないなら 0（「1 件選択」になる）。
    expect(visibleSkillBadgeCount(100, badges(1))).toBe(0);
    // 測れていない（器も中身も 0）ときも 0 に倒れる —— 次の計測で正しくなる。
    expect(visibleSkillBadgeCount(0, badges(3, 0))).toBe(0);
  });

  it('🔴 選択が 0 件なら 0（バッジもバッジの数も出さない）', () => {
    expect(visibleSkillBadgeCount(400, [])).toBe(0);
    expect(visibleSkillBadgeCount(0, [])).toBe(0);
  });

  it('🔴 「＋0」を出さない / 選んだ数を超えない（必ず 1 つは ＋N に残る）', () => {
    for (const width of [0, 60, 120, 160, 200, 240, 300, 400, 800, 2000]) {
      for (const [count, badgeWidth] of [
        [1, SHORT],
        [2, SHORT],
        [3, SHORT],
        [5, SHORT],
        [20, SHORT],
        [5, LONG],
        [20, LONG],
      ] as const) {
        const visible = visibleSkillBadgeCount(width, badges(count, badgeWidth));
        expect(visible).toBeGreaterThanOrEqual(0);
        expect(visible).toBeLessThanOrEqual(count);
        // 🔴 一部だけ出すなら、隠れている数は必ず 1 以上である（`+0` にならない）。
        expect(visible === count || count - visible >= 1).toBe(true);
      }
    }
  });
});

describe('🔴 条件バーの「＋N」（指示書 §4）', () => {
  it('全部入るなら全部出す', () => {
    expect(visibleChipCount(300, [80, 80, 80])).toBe(3);
  });

  it('🔴 入りきらないときは「＋N」の幅を先に確保してから数える', () => {
    // 器 200 / バッジ 80 × 3 → 「＋N」(52) と間隔(8) を引いた 140 に 1 つだけ入る。
    expect(visibleChipCount(200, [80, 80, 80])).toBe(1);
  });

  it('🔴 1 つも入らないなら 0（バッジを出さず「＋N」だけにする）', () => {
    expect(visibleChipCount(60, [80, 80])).toBe(0);
  });

  it('🔴 測る前（`null`）は全部出す', () => {
    expect(visibleChipCount(null, [80, 80, 80])).toBe(3);
  });
});

describe('🔴 段組みは「器の幅」で決まる（指示書 §2）', () => {
  it('768 以上 → 3 列 / 520〜767 → 2 列 / 520 未満 → 1 列', () => {
    expect(filterColumnCount(1200)).toBe(3);
    expect(filterColumnCount(768)).toBe(3);
    expect(filterColumnCount(767)).toBe(2);
    expect(filterColumnCount(520)).toBe(2);
    expect(filterColumnCount(519)).toBe(1);
  });

  it('測る前は 3 列', () => {
    expect(filterColumnCount(null)).toBe(3);
  });


});
