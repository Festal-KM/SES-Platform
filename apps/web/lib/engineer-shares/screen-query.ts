// apps/web/lib/engineer-shares/screen-query.ts
// `S-015` の**画面側**の URL パラメータ（検索条件の保持）。T-11-11（docs/05 §6.4「#29 の改訂」/ `docs/04` §S-015）。
//
// 🔴 API（`engineerShareListQuerySchema`）との違いは **`shared` の語彙**だけである。API は `true` / `false` /
//    省略（= すべて）の 3 値だが、画面は URL に `shared` が**無い**ことを「既定 = 共有中（`U-15`）」と読む必要が
//    あるため、「すべて」を明示する語 `all` を持つ。`all` は API へ渡すとき**省略**に写す（`toEngineerShareListQuery`）。
// 🔴 **既定フィルタは `ENGINEER_SHARE_DEFAULT_FILTER` の 1 箇所**（`U-15`。「今、何をホストに見せているか」が
//    本画面の存在理由であり、時間勝負の解除がここに集まるため）。運用で見直すときはここだけを変える
//    （[Issue #64](https://github.com/Festal-KM/SES-Platform/issues/64) で異論を募っている）。
// 🔴 `cursor` は画面の URL に持たない（`docs/05`「画面は検索のたびにカーソルを捨てる」）。続きは画面が
//    `nextCursor` で API から読み、取得済みの行の下に追加する。
// 🔴 検索条件の**項目**は `q` / `availableBy`（`#15` と同じフィールド定義）と `shared` の 3 つが最小で最大
//    （`docs/04` §S-015）。スキル・単価・勤務地を足さない。
import { z } from 'zod';
import { t } from '@ses/i18n';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';
import { optionalFilter } from '../api/query-filters';
import { engineerSearchCriteriaFields } from '../engineers/schemas';
import { engineerShareListQuerySchema, type EngineerShareListQuery } from './schemas';

export const ENGINEER_SHARE_PATH = '/engineer-shares';

/** 共有状態フィルタ（画面の語彙）。`all` = すべて。 */
export const ENGINEER_SHARE_FILTERS = ['true', 'false', 'all'] as const;

export type EngineerShareFilter = (typeof ENGINEER_SHARE_FILTERS)[number];

/** 🔴 既定 = 共有中（`U-15`）。**変えるときはここだけ。** */
export const ENGINEER_SHARE_DEFAULT_FILTER: EngineerShareFilter = 'true';

export const engineerShareScreenQuerySchema = z.object({
  q: engineerSearchCriteriaFields.q,
  availableBy: engineerSearchCriteriaFields.availableBy,
  shared: optionalFilter(z.enum(ENGINEER_SHARE_FILTERS)).default(ENGINEER_SHARE_DEFAULT_FILTER),
});

export type EngineerShareScreenQuery = z.infer<typeof engineerShareScreenQuerySchema>;

export type EngineerShareScreenQueryIsolationGuard = AssertNoIsolationKeys<EngineerShareScreenQuery>;

assertNoIsolationKeys(Object.keys(engineerShareScreenQuerySchema.shape), 'engineerShareScreenQuerySchema');

/** 画面の条件 → API の query（`all` は省略に写す。`limit` は既定値）。**`all` の写し方はここ 1 か所。** */
export function toEngineerShareListQuery(screen: EngineerShareScreenQuery): EngineerShareListQuery {
  return engineerShareListQuerySchema.parse({
    q: screen.q,
    availableBy: screen.availableBy,
    shared: screen.shared === 'all' ? undefined : screen.shared,
  });
}

/**
 * 画面が「次の 50 件」で API を呼ぶときの query 文字列（`cursor` を除く）。
 * 🔴 クライアントは `cursor` を足すだけで、`all` の写し方や条件の列挙を持たない。
 */
export function engineerShareApiSearch(screen: EngineerShareScreenQuery): string {
  const params = new URLSearchParams();
  if (screen.q !== undefined) params.set('q', screen.q);
  if (screen.availableBy !== undefined) params.set('availableBy', screen.availableBy);
  if (screen.shared !== 'all') params.set('shared', screen.shared);
  return params.toString();
}

/** 画面自身への URL（条件を保つ。既定値のフィルタは載せない）。 */
export function engineerShareScreenHref(screen: EngineerShareScreenQuery): string {
  const params = new URLSearchParams();
  if (screen.q !== undefined) params.set('q', screen.q);
  if (screen.availableBy !== undefined) params.set('availableBy', screen.availableBy);
  if (screen.shared !== ENGINEER_SHARE_DEFAULT_FILTER) params.set('shared', screen.shared);
  const search = params.toString();
  return search === '' ? ENGINEER_SHARE_PATH : `${ENGINEER_SHARE_PATH}?${search}`;
}

/** 氏名・稼働可能時期のどちらかが効いているか（空状態の出し分け。`docs/04` §S-015「条件あり・0 件」）。 */
export function hasEngineerShareSearchTerms(screen: EngineerShareScreenQuery): boolean {
  return screen.q !== undefined || screen.availableBy !== undefined;
}

export type EngineerShareActiveFilterView = {
  readonly key: 'q' | 'availableBy' | 'shared';
  readonly label: string;
  /** その条件**だけ**を外した URL。 */
  readonly href: string;
};

export const ENGINEER_SHARE_FILTER_MESSAGE_KEYS = {
  true: 'engineerShares.filter.shared',
  false: 'engineerShares.filter.notShared',
  all: 'engineerShares.filter.all',
} as const satisfies Record<EngineerShareFilter, string>;

/**
 * いま効いている条件（`docs/04` §S-015 空状態「効いている条件を 1 つずつ外せる導線」。`S-005` と同じ形）。
 * 🔴 共有状態フィルタも「条件」の 1 つとして外せる（外す = `all`）。
 */
export function activeEngineerShareFilters(
  screen: EngineerShareScreenQuery,
): readonly EngineerShareActiveFilterView[] {
  const filters: EngineerShareActiveFilterView[] = [];
  if (screen.q !== undefined) {
    filters.push({
      key: 'q',
      label: `${t('engineerShares.search.q')}: ${screen.q}`,
      href: engineerShareScreenHref({ ...screen, q: undefined }),
    });
  }
  if (screen.availableBy !== undefined) {
    filters.push({
      key: 'availableBy',
      label: `${t('engineerShares.search.availableBy')}: ${screen.availableBy}`,
      href: engineerShareScreenHref({ ...screen, availableBy: undefined }),
    });
  }
  if (screen.shared !== 'all') {
    filters.push({
      key: 'shared',
      label: `${t('engineerShares.search.shared')}: ${t(ENGINEER_SHARE_FILTER_MESSAGE_KEYS[screen.shared])}`,
      href: engineerShareScreenHref({ ...screen, shared: 'all' }),
    });
  }
  return filters;
}

/**
 * 空状態の種別（`docs/04` §S-015「空 / ローディング / エラー」の 4 通り）。行があれば `null`。
 *   - `LEDGER`      … 台帳 0 件（条件の値に関わらずこの表示。評価対象が無い）
 *   - `FILTERED`    … 氏名 / 稼働可能時期の条件あり・0 件
 *   - `SHARED_NONE` … `共有中`・条件なし・0 件
 *   - `ALL_SHARED`  … `共有していない`・条件なし・0 件
 */
export type EngineerShareEmptyState = 'LEDGER' | 'FILTERED' | 'SHARED_NONE' | 'ALL_SHARED';

export function engineerShareEmptyState(
  screen: EngineerShareScreenQuery,
  hasAnyEngineer: boolean,
  itemCount: number,
): EngineerShareEmptyState | null {
  if (!hasAnyEngineer) return 'LEDGER';
  if (itemCount > 0) return null;
  if (hasEngineerShareSearchTerms(screen)) return 'FILTERED';
  if (screen.shared === 'true') return 'SHARED_NONE';
  if (screen.shared === 'false') return 'ALL_SHARED';
  // `all` で条件なし・0 件は台帳 0 件と同義（上で拾う）。同時実行で到達したときも導線を残す。
  return 'FILTERED';
}
