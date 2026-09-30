// apps/web/lib/admin-tenants/list-href.ts
// `A-002` テナント一覧の **URL の組み立て**（並び替え / 異常の要約の絞り込み / カーソル / 列表示切替）。
// SP-22 `T-22-08`（段② の一覧 ③）。
//
// ============================================================================
// 🔴 なぜ `app/admin/tenants/**` から出したのか
// ============================================================================
// `apps/web/app/**` はルート定義とビューでありユニットテストを置かない（`vitest.config.ts` の
// include の注記 / `lib/admin-tenants/schemas.ts` 冒頭と同じ理由）。`T-22-08` で `?hide=` の
// 正規化が加わり、**URL の形がテストで固定されていなければならない対象**になったので、
// `tenantListHref` を純粋関数としてここへ移した（`admin-tenants-list.tsx` は re-export する ——
// 既存の import 元〔`*.render.test.tsx`〕を動かさないため）。
// 🔴 **I/O を持たない**（`lib/projects/list-rows.ts` 冒頭と同じ規律）。
import type { TenantHealthSignal, TenantListSortKey } from '@ses/domain';
import {
  HIDDEN_COLUMNS_PARAM,
  hiddenColumnsParamValue,
  parseHiddenColumns,
  toggleHiddenColumn,
} from '../ui/hidden-columns';

/** `A-002` の URL（管理平面。`docs/04` §A-002）。 */
export const TENANT_LIST_PATH = '/admin/tenants';

/**
 * 🔴 **`A-002` で利用者が外せる列**（`docs/04` §7.1「既定 8 列 + 操作列。**9 列目以降は
 *    列表示切替に格納する**」/ §10.3 の `A-002` の行の改訂 21「本画面は 9 列である。
 *    **優先度が最も低い `案件数` を `hideable` にする**」）。
 *
 * 🔴 **この配列がクエリの許可リストである** —— ここに無い値が `?hide=` に来ても無視される。
 * 🔴 **並びが URL の正規形を決める**（`lib/ui/hidden-columns.ts`）。
 * 🔴 列を増やすときは `docs/04` §10.3 / §A-002 の列の定めが先である（画面の都合で足さない）。
 *    **表示項目を増やすことは `BR-40` / `CLAUDE.md` §10.5 に触れる**（運営者に見せるものを増やす）。
 */
export const TENANT_HIDEABLE_COLUMN_IDS = ['projects'] as const;

export type TenantHideableColumnId = (typeof TENANT_HIDEABLE_COLUMN_IDS)[number];

/** URL のクエリ（`?hide=`）→ いま隠れている列。許可リスト外は捨てる。 */
export function parseHiddenTenantColumns(
  raw: string | readonly string[] | undefined,
): readonly TenantHideableColumnId[] {
  return parseHiddenColumns(raw, TENANT_HIDEABLE_COLUMN_IDS);
}

/**
 * 並び替え・絞り込み・カーソル・列表示切替を載せた `A-002` の URL。
 *
 * 🔴 **既定値はクエリに出さない**（`sort=health` / 絞り込み無し / 先頭ページ / 何も隠していない）——
 *    同じ見え方に複数の URL が対応しないようにするため。
 * 🔴 **並びの切替と絞り込みの切替はカーソルを捨てる**（呼び出し側が `cursor` に `null` を渡す）。
 * 🔴 `hide` は**最後**に載せる（`T-22-08`）。列の表示状態も並び替え・ページ送りで落ちない ——
 *    次ページで隠した列が復活すると、利用者は「何が起きたか」を説明できない。
 * 🔴 **API には渡さない。** 列の表示・非表示は**表示の話**であり、取得する項目は変わらない
 *    （`adminTenantListQuerySchema` はこのキーを持たず、Zod の既定（strip）で無視される）。
 */
export function tenantListHref(
  sort: TenantListSortKey,
  cursor: string | null,
  signal: TenantHealthSignal | null = null,
  hiddenColumns: readonly TenantHideableColumnId[] = [],
): string {
  const params = new URLSearchParams();
  if (sort !== 'health') params.set('sort', sort);
  if (signal !== null) params.set('signal', signal);
  if (cursor !== null) params.set('cursor', cursor);
  const hide = hiddenColumnsParamValue(hiddenColumns);
  if (hide !== null) params.set(HIDDEN_COLUMNS_PARAM, hide);
  const query = params.toString();
  return query === '' ? TENANT_LIST_PATH : `${TENANT_LIST_PATH}?${query}`;
}

/**
 * その列の表示 / 非表示を反転した `A-002` の URL。
 * 🔴 **並び・絞り込み・いま見ているページ（`cursor`）を保つ** —— 列を 1 つ外したせいで
 *    1 ページ目や別の並びに戻されると、いま読んでいた行を見失う。
 */
export function tenantColumnToggleHref(params: {
  readonly sort: TenantListSortKey;
  readonly cursor: string | null;
  readonly signal: TenantHealthSignal | null;
  readonly hidden: readonly TenantHideableColumnId[];
  readonly columnId: TenantHideableColumnId;
}): string {
  return tenantListHref(
    params.sort,
    params.cursor,
    params.signal,
    toggleHiddenColumn(params.hidden, TENANT_HIDEABLE_COLUMN_IDS, params.columnId),
  );
}
