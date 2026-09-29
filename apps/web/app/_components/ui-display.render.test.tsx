// apps/web/app/_components/ui-display.render.test.tsx
// 🔴 `T-22-04` の表示系プリミティブ（`DataTable` / `Pagination` / `Toolbar` / `EmptyState` /
//    `Skeleton` / `SummaryStrip` / `PageBody` + `IconButton` / `SearchInput` / `StatusBadge`）の
//    **描画**テスト（`SP-22` §6 の「新部品の render テスト」）。
//
// ============================================================================
// なぜ `apps/web` に置くのか（置き場所の作法。`ui-overlays.render.test.tsx` と同じ）
// ============================================================================
// 本リポジトリの render テストは **`apps/*/app/**/*.render.test.tsx`** に置く
// （`vitest.config.ts` の `include` がこの命名だけを `app/**` から拾う）。
// `tests/static/**` は `.test.ts` だけを拾うので JSX を書けず、`packages/ui` 側に `*.test.ts` を
// 置くと `tsc -p packages/ui/tsconfig.json` の出力（`dist/`）に混ざる。
// 🔴 **画面ファイルは 1 つも触っていない**（`collectSourceFiles` は `*.test.tsx` を走査から外す）。
//
// 🔴 **`createElement` で組む**（既存 41 本と同じ流儀。新規依存を足さない）。副作用として、
//    props は**オブジェクトのプロパティ**になり JSX 属性にならない —— したがって
//    `tests/static/datatable-column-contract.test.ts` (m)③（`selection` **属性**の出現 0 件）を
//    このテストが汚すことはない。
//
// ============================================================================
// 🔴 ここで固定するもの（`SP-22` §6 / `T-22-04` の受け入れ基準）
// ============================================================================
//   ① `SummaryStrip` が 0 件で描かない（`docs/04` §7.2 の表「0 が並ぶストリップを出さない」）
//   ② `DataTable` が `selection` 未指定で**選択列を描かない**（§5-13 改訂 17 / `F-016 AC-1` / `U-18`）
//   ③ `PageBody` の 3 クラスの寸法（§7.1。副カラムの固定値 / `prose` の 720px 左寄せ）
//   ④ `StatusBadge` が**同じ状態名で常に同じ色**（§5-1 / §7.4）＋ 36 + 4 + `Phase N` を網羅
//   ⑤ `EmptyState` の 3 段構造（説明 → Primary → Secondary）と、0 件が正常な画面での無アクション
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_STATES,
  CONTRACT_STATES,
  PROPOSAL_REQUEST_STATES,
  PROPOSAL_STATES,
  TENANT_LIFECYCLE_STATES,
} from '@ses/domain';
import {
  Badge,
  DATA_TABLE_MAX_VISIBLE_COLUMNS,
  DataTable,
  EmptyState,
  IconButton,
  PAGE_BODY_ASIDE_WIDTH_CLASSES,
  PageBody,
  Pagination,
  STATUS_BADGE_APPEARANCES,
  Skeleton,
  StatusBadge,
  SummaryStrip,
  Toolbar,
  type DataTableColumn,
} from '@ses/ui';

type Row = { readonly id: string; readonly name: string; readonly site: string };

const ROWS: readonly Row[] = [
  { id: 'e1', name: '山田 太郎', site: '東京' },
  { id: 'e2', name: '鈴木 花子', site: '大阪' },
];

const NAME_COLUMN: DataTableColumn<Row> = {
  id: 'name',
  header: '氏名',
  priority: 'always',
  minWidth: '10rem',
  nameCell: { name: (row) => row.name, href: (row) => `/engineers/${row.id}` },
};

const SITE_COLUMN: DataTableColumn<Row> = {
  id: 'site',
  header: '勤務地',
  // ⚠️ **テストの見本であって §10.3 の表の写しではない**（画面の列定義は段② が `docs/04` §10.3 から
  //    直接写す。ここに表を持つと出所が 2 つになる）。
  priority: 'lg',
  minWidth: '6rem',
  cell: (row) => row.site,
};

const EMPTY = createElement(EmptyState, { description: '条件に一致する人材はいません', testIdPrefix: 'x-empty-' });

function renderTable(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(DataTable<Row>, {
      columns: [NAME_COLUMN, SITE_COLUMN],
      rows: ROWS,
      rowKey: (row) => row.id,
      empty: EMPTY,
      testIdPrefix: 'engineer-list-',
      ...props,
    }),
  );
}

// ============================================================================
// ① `SummaryStrip`
// ============================================================================
describe('🔴 SummaryStrip（docs/04 §5-13 / §7.2 の改訂 16）', () => {
  it('🔴 0 件のときは何も描かない（「0 が並ぶストリップ」を出さない）', () => {
    expect(renderToStaticMarkup(createElement(SummaryStrip, { items: [], testIdPrefix: 'home-host-summary-' }))).toBe('');
  });

  it('3〜5 件は 1 行のストリップとして描かれ、件数が `data-item-count` に出る', () => {
    const markup = renderToStaticMarkup(
      createElement(SummaryStrip, {
        items: [
          { label: '進行中の提案', value: '12 件', href: '/proposals' },
          { label: '面談予定', value: '3 件' },
          { label: '稼働中', value: '48 件', href: '/assignments' },
        ],
        testIdPrefix: 'home-host-summary-',
      }),
    );
    expect(markup).toContain('data-item-count="3"');
    expect(markup).toContain('data-testid="home-host-summary-root"');
    expect(markup).toContain('data-testid="home-host-summary-link-0"');
  });

  it('🔴 カードにしない / 主コンテンツより強くしない（背景・枠線・影を持たず、文字は 12px + fg-muted）', () => {
    const markup = renderToStaticMarkup(
      createElement(SummaryStrip, {
        items: [
          { label: '案件', value: '14 件' },
          { label: '人材', value: '128 件' },
          { label: '稼働中', value: '48 件' },
        ],
        testIdPrefix: 'home-host-summary-',
      }),
    );
    // 🔴 §7.2: 件数を要対応キューより視覚的に強くしない（**これが禁止の本体**）。
    expect(markup).toContain('text-xs');
    expect(markup).toContain('text-fg-muted');
    expect(markup).not.toContain('shadow');
    // 🔴 §7.2: カードで囲まない（`Card` の面 = `bg-bg` + `border` を持たない）。
    expect(markup).not.toContain('rounded-md');
    // 🔴 §5-13: モバイルで横スクロールにしない（グリッドで折り返す）。
    expect(markup).toContain('grid-cols-2');
    expect(markup).not.toContain('overflow-x');
  });

  it('🔴 1〜2 件は落とす（「0 の指標を間引いた」形を通さない。docs/05 §6.11.1）', () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(SummaryStrip, {
          items: [
            { label: '案件', value: '14 件' },
            { label: '人材', value: '128 件' },
          ],
          testIdPrefix: 'home-host-summary-',
        }),
      ),
    ).toThrow(/3 件以上です/);
  });

  it('🔴 上限（5 件）を超えたら落とす（KPI カードの並びに化けさせない）', () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(SummaryStrip, {
          items: Array.from({ length: 6 }, (_unused, index) => ({ label: `x${String(index)}`, value: '1 件' })),
          testIdPrefix: 'home-host-summary-',
        }),
      ),
    ).toThrow(/5 件までです/);
  });
});

// ============================================================================
// ② `DataTable`
// ============================================================================
describe('🔴 DataTable（docs/04 §5-13 / §7.1 / §10.3 / docs/05 §2.3.5）', () => {
  it('🔴 `selection` を渡さないと選択列を描かない（既定は行選択なし。改訂 17）', () => {
    const markup = renderTable();
    expect(markup).not.toContain('type="checkbox"');
    // 列ヘッダは 2 つだけ（選択列も操作列も無い）。
    // ⚠️ `<thead` にも当たるので `<th ` で数える。
    expect(markup.match(/<th /g)?.length).toBe(2);
  });

  it('🔴 `<table>` を保つ（TBD-22 の確定。CSS Grid にしない）', () => {
    const markup = renderTable();
    expect(markup).toContain('<table');
    expect(markup).toContain('<thead');
    expect(markup).toContain('<tbody');
    expect(markup).not.toContain('role="grid"');
  });

  it('🔴 列の落とし方は `priority` が決める（`hidden lg:table-cell`。画面側に直書きさせない）', () => {
    const markup = renderTable();
    expect(markup).toContain('hidden lg:table-cell');
    // 🔴 打ち消し方向（`max-lg:` 等）を使わない（モバイル優先）。
    // ⚠️ 正規表現で書く —— 打ち消し方向のクラスを**文字列リテラル**で書くと、
    //    `tests/static/tailwind-breakpoints.test.ts`（テストファイルも走査する）が
    //    このファイル自身を違反として拾う。
    // ⚠️ ブレークポイント名に絞る（`style="min-width:…"` や `lg:max-w-64` に当てない）。
    expect(markup).not.toMatch(/(?:min|max)-(?:sm|md|lg|xl|2xl):/);
  });

  it('🔴 名称セルは `NameCell` に委譲する（`lg` 以上 = 切り詰め / 下限幅 10rem / `title` で全文）', () => {
    const markup = renderTable();
    expect(markup).toContain('min-w-40');
    expect(markup).toContain('lg:truncate');
    expect(markup).toContain('title="山田 太郎"');
    expect(markup).toContain('href="/engineers/e1"');
    expect(markup).toContain('data-testid="engineer-list-link-e1"');
  });

  it('🔴 sticky ヘッダは下 border で示し、影で示さない（§7.9）', () => {
    const markup = renderTable();
    expect(markup).toContain('sticky top-0');
    expect(markup).toContain('border-b');
    expect(markup).not.toContain('shadow');
  });

  it('🔴 1 レコードをカードに割る表示形態を持たない（モバイルでも列を間引いたテーブル）', () => {
    const markup = renderTable();
    // 行は `<tr>` 1 本であり、モバイル用の別レイアウト（`lg:hidden` の複製）を持たない。
    expect(markup.match(/<tr/g)?.length).toBe(1 + ROWS.length);
    expect(markup).not.toContain('lg:hidden');
  });

  it('行に testid が付き、行キーで引ける（E2E の掴み手）', () => {
    const markup = renderTable();
    expect(markup).toContain('data-testid="engineer-list-table"');
    expect(markup).toContain('data-testid="engineer-list-row-e1"');
    expect(markup).toContain('data-testid="engineer-list-row-e2"');
  });

  it('0 件のときは列ヘッダを残したまま `empty` を描く（絞込 0 でも列の並びを失わない）', () => {
    const markup = renderTable({ rows: [] });
    expect(markup).toContain('data-testid="engineer-list-empty-row"');
    expect(markup).toContain('条件に一致する人材はいません');
    // ⚠️ React の SSR は `colSpan` をそのまま出す（HTML の属性名は大文字小文字を区別しない）。
    expect(markup).toContain('colSpan="2"');
  });

  it('🔴 骨格は「実際に入る行数・列数」で描く（3 行の骨格の後に 50 行が入って跳ねない）', () => {
    const markup = renderTable({ loadingRows: 12 });
    expect(markup.match(/data-testid="engineer-list-skeleton-row-/g)?.length).toBe(12);
    // 列数は実際の列数（2）である。
    expect(markup.match(/animate-pulse/g)?.length).toBe(12 * 2);
    // 骨格のあいだ行は描かない（骨格と実データが同時に出ない）。
    expect(markup).not.toContain('data-testid="engineer-list-row-e1"');
  });

  it('🔴 並び替えはリンクであり、`aria-sort` が `<th>` に付く（クライアントで並べ替えない）', () => {
    const markup = renderTable({
      columns: [NAME_COLUMN, { ...SITE_COLUMN, sortKey: 'site' }],
      sort: { key: 'site', dir: 'asc' },
      sortHref: (key, dir) => `/engineers?sort=${key}&dir=${dir}`,
    });
    expect(markup).toContain('aria-sort="ascending"');
    // 🔴 いま `asc` なので、押すと `desc` になる href である（サーバが並びを確定させる）。
    expect(markup).toContain('href="/engineers?sort=site&amp;dir=desc"');
    expect(markup).toContain('data-testid="engineer-list-sort-site"');
    expect(markup).not.toContain('<button');
  });

  it('🔴 `sortKey` が在るのに `sortHref` が無ければ落ちる（列ヘッダが黙ってリンクにならない形を作らない）', () => {
    expect(() => renderTable({ columns: [NAME_COLUMN, { ...SITE_COLUMN, sortKey: 'site' }] })).toThrow(/sortHref/);
  });

  it('🔴 `hideable` を持たない列が 8 を超えたら落ちる（§7.1「既定 8 列 + 操作列」）', () => {
    const many: DataTableColumn<Row>[] = Array.from({ length: DATA_TABLE_MAX_VISIBLE_COLUMNS + 1 }, (_unused, index) => ({
      id: `c${String(index)}`,
      header: `列${String(index)}`,
      priority: 'always',
      minWidth: '6rem',
      cell: (row: Row) => row.site,
    }));
    expect(() => renderTable({ columns: many })).toThrow(/8 列までです/);
  });

  it('🔴 名称列の下限幅が 10rem を割ったら落ちる（U-16 / T-08-11 の折り返し検出器の前提）', () => {
    expect(() => renderTable({ columns: [{ ...NAME_COLUMN, minWidth: '4rem' }, SITE_COLUMN] })).toThrow(/10rem/);
  });

  it('利用者が外した列（`hideable`）は描かれない。`priority` とは別の仕組みである', () => {
    const markup = renderTable({
      columns: [NAME_COLUMN, { ...SITE_COLUMN, hideable: true }],
      hiddenColumnIds: ['site'],
    });
    expect(markup).not.toContain('data-column-id="site"');
    expect(markup).toContain('data-column-id="name"');
  });

  it('🔴 操作列は列ヘッダの語を要求する（文言を持たない部品が語なしで描かない）', () => {
    expect(() => renderTable({ rowAction: () => null })).toThrow(/rowActionHeader/);
  });
});

// ============================================================================
// ③ `PageBody`（幅 3 クラス）
// ============================================================================
describe('🔴 PageBody の幅 3 クラス（docs/04 §7.1 / docs/05 §2.3.4）', () => {
  it('A 全幅（`full`）: 左右 gutter だけで上限を設けない', () => {
    const markup = renderToStaticMarkup(createElement(PageBody, { widthClass: 'full', children: '本体' }));
    expect(markup).toContain('data-width-class="full"');
    expect(markup).toContain('px-6');
    // 🔴 一覧に最大幅を効かせると、大画面でも列が入りきらない（§7.1）。
    expect(markup).not.toContain('max-w-');
  });

  it('🔴 B 分割（`split`）: 副カラムは `lg` 360 → `xl` 400 → `2xl` 480px の固定（可変にしない）', () => {
    const markup = renderToStaticMarkup(
      createElement(PageBody, { widthClass: 'split', children: '主カラム', aside: '送信先プレビュー' }),
    );
    expect(markup).toContain('data-width-class="split"');
    expect(markup).toContain('data-page-body-aside="true"');
    // 🔴 3 つの固定値（`w-90` = 360 / `w-100` = 400 / `w-120` = 480）。
    expect(markup).toContain('lg:w-90');
    expect(markup).toContain('xl:w-100');
    expect(markup).toContain('2xl:w-120');
    // 🔴 `shrink-0` が無いと主カラムに押されて可変になる（プレビューが嘘になる）。
    expect(markup).toContain('lg:shrink-0');
    expect(PAGE_BODY_ASIDE_WIDTH_CLASSES.split(' ')).toContain('lg:shrink-0');
    // 🔴 `lg` 未満では 1 列に落として副カラムを下へ（隠さない）。
    expect(markup).toContain('flex-col');
    expect(markup).toContain('lg:flex-row');
  });

  it('🔴 C 読み幅（`prose`）: 720px 上限 + 左寄せ（`mx-auto` を書かない）', () => {
    const markup = renderToStaticMarkup(createElement(PageBody, { widthClass: 'prose', children: 'フォーム' }));
    expect(markup).toContain('data-width-class="prose"');
    expect(markup).toContain('max-w-180');
    // 🔴 サイドバーが左にある構造で中央寄せすると、視線の起点が画面ごとに動く（§7.1）。
    expect(markup).not.toContain('mx-auto');
  });

  it('🔴 `full` / `prose` に副カラムを渡したら落ちる（幅クラスの取り違えを黙って捨てない）', () => {
    expect(() =>
      renderToStaticMarkup(createElement(PageBody, { widthClass: 'full', children: 'x', aside: 'preview' })),
    ).toThrow(/split/);
  });

  it('🔴 独自ブレークポイントを持たない（境界は Tailwind 既定の `lg` / `xl` / `2xl` だけ）', () => {
    const markup = renderToStaticMarkup(
      createElement(PageBody, { widthClass: 'split', children: 'x', aside: 'y' }),
    );
    expect(markup).not.toMatch(/min-\[|max-\[/);
  });
});

// ============================================================================
// ④ `StatusBadge`
// ============================================================================
// ⚠️ `createElement` では generic の推論が `state` まで届かないので型引数を明示する
//    （画面は JSX（`<StatusBadge entity="proposal" …>`）で書くため推論が効く）。
describe('🔴 StatusBadge（docs/04 §5-1 / §7.4 / §5-13）', () => {
  it('🔴 §5-1 の 36 状態が `CLAUDE.md` §4.2 の 5 エンティティと 1 対 1 で一致する（1 つも省略しない）', () => {
    // 🔴 `packages/ui` は `@ses/domain` に依存しない（依存を増やさない）ので、**一致はここで固定する**
    //    （`apps/web` は両方を import できる唯一の層である。`components/badge.tsx` の ⚠️）。
    expect(Object.keys(STATUS_BADGE_APPEARANCES.proposal).sort()).toEqual([...PROPOSAL_STATES].sort());
    expect(Object.keys(STATUS_BADGE_APPEARANCES.assignment).sort()).toEqual([...ASSIGNMENT_STATES].sort());
    expect(Object.keys(STATUS_BADGE_APPEARANCES.proposalRequest).sort()).toEqual([...PROPOSAL_REQUEST_STATES].sort());
    expect(Object.keys(STATUS_BADGE_APPEARANCES.tenant).sort()).toEqual([...TENANT_LIFECYCLE_STATES].sort());
    expect(Object.keys(STATUS_BADGE_APPEARANCES.contract).sort()).toEqual([...CONTRACT_STATES].sort());
    const stateCount =
      PROPOSAL_STATES.length +
      ASSIGNMENT_STATES.length +
      PROPOSAL_REQUEST_STATES.length +
      TENANT_LIFECYCLE_STATES.length +
      CONTRACT_STATES.length;
    expect(stateCount, '§5-1 は「5 エンティティ・全 36 状態」である').toBe(36);
  });

  it('🔴 公開の状態 4 値と `Phase N` も表を持つ（§5-1 の 🔴 / §3.1 のサイドバー）', () => {
    expect(Object.keys(STATUS_BADGE_APPEARANCES.projectPublication)).toEqual([
      'UNSET',
      'PUBLISHED',
      'AUTO_REVOKED',
      'RECHECK_HELD',
    ]);
    expect(Object.keys(STATUS_BADGE_APPEARANCES.phase)).toEqual(['PHASE_2', 'PHASE_3']);
  });

  it('🔴 同じ状態名なら、どのエンティティでも同じ色である（形状だけが違う）', () => {
    const tonesByState = new Map<string, Set<string>>();
    for (const states of Object.values(STATUS_BADGE_APPEARANCES)) {
      for (const [state, appearance] of Object.entries(states)) {
        const tones = tonesByState.get(state) ?? new Set<string>();
        tones.add(appearance.variant);
        tonesByState.set(state, tones);
      }
    }
    const conflicting = [...tonesByState]
      .filter(([, tones]) => tones.size > 1)
      .map(([state, tones]) => `${state}: ${[...tones].join(' / ')}`);
    expect(
      conflicting,
      '🔴 docs/04 §5-1: 同じ状態名が画面（エンティティ）によって違う色になると、' +
        '画面をまたいだ読み方が崩れる。`ACTIVE` は Assignment / Tenant のどちらも緑で、違うのは形状だけである',
    ).toEqual([]);
    // 対照: 現に複数のエンティティに在る状態名が存在する（走査が空振りしていない）。
    expect([...tonesByState.keys()]).toContain('ACTIVE');
    expect([...tonesByState.keys()]).toContain('DRAFT');
    expect([...tonesByState.keys()]).toContain('EXPIRED');
  });

  it('🔴 障害（赤）は `SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` だけである（§7.4 / BR-23）', () => {
    const danger = Object.entries(STATUS_BADGE_APPEARANCES).flatMap(([entity, states]) =>
      Object.entries(states)
        .filter(([, appearance]) => appearance.variant === 'danger')
        .map(([state]) => `${entity}.${state}`),
    );
    expect(danger.sort()).toEqual(['contract.SEND_FAILED', 'proposal.SUBMIT_FAILED', 'tenant.SUSPENDED']);
  });

  it('🔴 ゲート差し戻し（`GATE_FAILED`）は橙である（赤にすると品質管理の強化が「悪化」に見える）', () => {
    expect(STATUS_BADGE_APPEARANCES.proposal.GATE_FAILED).toEqual({ variant: 'warning', shape: 'solid' });
  });

  it('🔴 進行中・保留は点線枠である（`GATE_RUNNING` / `SUBMITTING` / `SENDING` / 再検査の保留）', () => {
    expect(STATUS_BADGE_APPEARANCES.proposal.GATE_RUNNING.shape).toBe('dashed');
    expect(STATUS_BADGE_APPEARANCES.proposal.SUBMITTING.shape).toBe('dashed');
    expect(STATUS_BADGE_APPEARANCES.contract.SENDING.shape).toBe('dashed');
    expect(STATUS_BADGE_APPEARANCES.projectPublication.RECHECK_HELD.shape).toBe('dashed');
  });

  it('🔴 語は呼び出し側から受け、色は部品が決める（`variant` / `shape` の prop を持たない）', () => {
    const markup = renderToStaticMarkup(
      createElement(StatusBadge<'proposal'>, { entity: 'proposal', state: 'GATE_FAILED', label: '差し戻し（検査で不合格）' }),
    );
    expect(markup).toContain('差し戻し（検査で不合格）');
    expect(markup).toContain('data-entity="proposal"');
    expect(markup).toContain('data-state="GATE_FAILED"');
    // 橙の塗り（§7.4 の注意色）。
    expect(markup).toContain('bg-warning-bg');
    expect(markup).toContain('text-warning');
  });

  it('🔴 アイコンを付けない（36 状態 × アイコンの対応表を作らない。§7.5）', () => {
    const markup = renderToStaticMarkup(
      createElement(StatusBadge<'tenant'>, { entity: 'tenant', state: 'SANDBOX', label: '試用中' }),
    );
    expect(markup).not.toContain('<svg');
  });

  it('点線枠の状態には経過時間を添えられる（§5-1「点線枠 + 経過時間」）', () => {
    const markup = renderToStaticMarkup(
      createElement(StatusBadge<'proposal'>, { entity: 'proposal', state: 'SUBMITTING', label: '送信中', elapsed: '3 分' }),
    );
    expect(markup).toContain('border-dashed');
    expect(markup).toContain('3 分');
  });

  it('🔴 表に無い状態は無彩色でごまかさず落とす（§5-1「1 つでも表現できないと状況が読めない」）', () => {
    expect(() =>
      renderToStaticMarkup(
        // @ts-expect-error 🔴 型でも弾かれる（表に無い状態名は型エラー）。実行時の壁も在ることを見る。
        createElement(StatusBadge, { entity: 'proposal', state: 'NOT_A_STATE', label: 'x' }),
      ),
    ).toThrow(/見え方が定義されていません/);
  });

  it('`Badge` の 3 形状（塗り / 枠線 / 点線枠）が区別できる（色覚特性に依存しない。§5-1）', () => {
    const solid = renderToStaticMarkup(createElement(Badge, { variant: 'success', children: 'x' }));
    const outline = renderToStaticMarkup(createElement(Badge, { variant: 'success', shape: 'outline', children: 'x' }));
    const dashed = renderToStaticMarkup(createElement(Badge, { variant: 'success', shape: 'dashed', children: 'x' }));
    expect(solid).toContain('bg-success-bg');
    expect(outline).toContain('bg-transparent');
    expect(outline).not.toContain('border-dashed');
    expect(dashed).toContain('border-dashed');
  });
});

// ============================================================================
// ⑤ `EmptyState`
// ============================================================================
describe('🔴 EmptyState（docs/04 §5-13 / §10.1 / §10.4）', () => {
  it('🔴 構造は 説明 → Primary → Secondary の 3 段である', () => {
    const markup = renderToStaticMarkup(
      createElement(EmptyState, {
        description: '人材が未登録です',
        primary: createElement('button', { type: 'button', 'data-testid': 'engineer-empty-create' }, '人材を登録する'),
        secondary: { href: '/skill-sheets', label: 'スキルシートから取り込む' },
        testIdPrefix: 'engineer-list-empty-',
      }),
    );
    const description = markup.indexOf('engineer-list-empty-description');
    const primary = markup.indexOf('engineer-list-empty-primary');
    const secondary = markup.indexOf('engineer-list-empty-secondary');
    expect(description).toBeGreaterThan(-1);
    expect(primary).toBeGreaterThan(description);
    expect(secondary).toBeGreaterThan(primary);
  });

  it('🔴 0 件が正常な画面ではアクションを置かない（`S-022`「送信に失敗した提案はありません」）', () => {
    const markup = renderToStaticMarkup(
      createElement(EmptyState, {
        description: '送信に失敗した提案はありません',
        testIdPrefix: 'proposal-send-failures-empty-',
      }),
    );
    expect(markup).toContain('送信に失敗した提案はありません');
    expect(markup).not.toContain('proposal-send-failures-empty-primary');
    expect(markup).not.toContain('proposal-send-failures-empty-secondary');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<a ');
  });

  it('🔴 イラスト・大きなアイコンを置かない（受け取る prop が無い）', () => {
    const markup = renderToStaticMarkup(
      createElement(EmptyState, { description: '条件に一致する案件はいません', testIdPrefix: 'x-' }),
    );
    expect(markup).not.toContain('<svg');
    expect(markup).not.toContain('<img');
  });

  it('🔴 説明文は 720px を超えて 1 行にしない（§7.1。寸法は `PageBody` の定数を使う）', () => {
    const markup = renderToStaticMarkup(createElement(EmptyState, { description: '説明', testIdPrefix: 'x-' }));
    expect(markup).toContain('max-w-180');
  });
});

// ============================================================================
// `Pagination` / `Toolbar` / `Skeleton` / `IconButton`
// ============================================================================
describe('🔴 Pagination（docs/04 §5-13 / §7.1 / §10.3）', () => {
  it('🔴 オフセット・総件数・無限スクロールを持たない（次 / 前のリンクだけ）', () => {
    const markup = renderToStaticMarkup(
      createElement(Pagination, {
        nextHref: '/engineers?cursor=abc',
        nextLabel: '次のページ',
        prevLabel: '前のページ',
        testIdPrefix: 'engineer-list-',
      }),
    );
    expect(markup).toContain('data-testid="engineer-list-pagination-next"');
    expect(markup).toContain('href="/engineers?cursor=abc"');
    // 🔴 総件数もページ番号も出さない（`S-015` は `total` を返さない API と対になっている）。
    expect(markup).not.toMatch(/\d+\s*\/\s*\d+/);
    // `prevHref` を渡していない画面では「前へ」を描かない（TBD-24）。
    expect(markup).not.toContain('engineer-list-pagination-prev');
  });

  it('端（次が無い）は `disabled` のボタンにせず、位置を保った表示に落とす（§7.10）', () => {
    const markup = renderToStaticMarkup(
      createElement(Pagination, {
        nextHref: null,
        prevHref: '/engineers?cursor=prev',
        nextLabel: '次のページ',
        prevLabel: '前のページ',
        testIdPrefix: 'engineer-list-',
      }),
    );
    expect(markup).toContain('data-testid="engineer-list-pagination-next-edge"');
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toContain('<button');
    expect(markup).toContain('data-testid="engineer-list-pagination-prev"');
  });
});

describe('🔴 Toolbar（docs/04 §5-13 / §3.2-2 / §5-10）', () => {
  it('🔴 母集団の 1 行と §5-10 の説明ブロックが、フィルタ帯の直下に固定される', () => {
    const markup = renderToStaticMarkup(
      createElement(Toolbar, {
        population: '御社が登録した人材 128 件',
        scopeNote: 'この一覧には、御社が登録した人材のみが表示されます',
        filters: createElement('div', { 'data-testid': 'engineer-list-filter-form' }, 'フィルタ'),
        testIdPrefix: 'engineer-list-',
      }),
    );
    const filters = markup.indexOf('engineer-list-toolbar-filters');
    const population = markup.indexOf('engineer-list-toolbar-population');
    const scopeNote = markup.indexOf('engineer-list-toolbar-scope-note');
    expect(filters).toBeGreaterThan(-1);
    expect(population).toBeGreaterThan(filters);
    expect(scopeNote).toBeGreaterThan(population);
    expect(markup).toContain('御社が登録した人材 128 件');
  });

  it('ホストの画面では説明ブロックを持たない（取引先向けの 1 行である）', () => {
    const markup = renderToStaticMarkup(
      createElement(Toolbar, { population: '案件 14 件', testIdPrefix: 'project-list-' }),
    );
    expect(markup).toContain('project-list-toolbar-population');
    expect(markup).not.toContain('project-list-toolbar-scope-note');
  });

  it('🔴 一括操作はモバイルで既定にならない（既定で閉じた `<details>` に入る）', () => {
    const markup = renderToStaticMarkup(
      createElement(Toolbar, {
        population: '提案 24 件',
        bulkActions: createElement('button', { type: 'button' }, '一括承認'),
        bulkActionsLabel: '一括操作',
        selectedCount: 3,
        testIdPrefix: 'proposal-list-',
      }),
    );
    expect(markup).toContain('<details');
    expect(markup).not.toContain('<details open');
    expect(markup).toContain('data-selected-count="3"');
  });

  it('🔴 一括操作の語を渡さずには描けない（`packages/ui` は文言を持たない）', () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(Toolbar, {
          population: 'x',
          bulkActions: createElement('button', { type: 'button' }, 'y'),
          testIdPrefix: 'z-',
        }),
      ),
    ).toThrow(/bulkActionsLabel/);
  });
});

describe('🔴 Skeleton / IconButton', () => {
  it('🔴 スピナーで画面全体を覆わない（`fixed` / `inset-0` を持たない）', () => {
    const markup = renderToStaticMarkup(createElement(Skeleton, { lines: 3 }));
    expect(markup).not.toContain('fixed');
    expect(markup).not.toContain('inset-0');
    expect(markup.match(/animate-pulse/g)?.length).toBe(3);
    // 読み上げの対象にしない（進行の語は領域の側が持つ）。
    expect(markup).toContain('aria-hidden="true"');
  });

  it('🔴 `IconButton` は `Button` の 8 状態をそのまま持ち、`aria-label` が必須である', () => {
    const markup = renderToStaticMarkup(
      createElement(IconButton, {
        icon: createElement('span', { 'aria-hidden': 'true' }, '×'),
        'aria-label': '閉じる',
        variant: 'ghost',
        size: 'sm',
      }),
    );
    expect(markup).toContain('aria-label="閉じる"');
    // `Button` の基底（focus リング / 遷移 / disabled）が効いている。
    expect(markup).toContain('focus-visible:ring-2');
    expect(markup).toContain('transition-colors');
    // 正方形の当たり判定（アイコンだけのボタン）。
    expect(markup).toContain('h-8');
    expect(markup).toContain('w-8');
  });
});
