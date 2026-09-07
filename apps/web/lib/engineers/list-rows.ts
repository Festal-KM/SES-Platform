// apps/web/lib/engineers/list-rows.ts
// `S-005` エンジニア台帳（一覧）の表示値の組み立て（docs/04 §S-005）。T-05-09。
//
// 🔴 画面（`app/(main)/engineers/**`）ではなくここに置く理由は `detail.ts` と同じである:
//    `app/**` はユニットテストの対象外（`vitest.config.ts` の注記）であり、
//    「上位 3 件の選び方」「`+N` の数え方」「未設定の見せ方」を固定できる場所が要る。
//    ここは **I/O を持たない純粋関数だけ**で、`@ses/db` にも Prisma にも触れない。
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは**日本語の語を書かない**。
import { PAGE_SIZE_DEFAULT } from '@ses/config';
import { t } from '@ses/i18n';
// 🔴 T-06-02: 3 桁区切りは機能に属さない共通語彙（`lib/format/number.ts`）。
import { formatThousands } from '../format/number';
import { PREFECTURE_MESSAGE_KEYS } from '../format/prefectures';
import { formatUnitPriceRange } from './detail';
import { ENGINEER_AVAILABILITY_MESSAGE_KEYS, REMOTE_MODE_MESSAGE_KEYS } from './labels';
import type { OwnEngineerView } from './list';
import { ENGINEER_SKILL_MODE_DEFAULT, type EngineerListQuery } from './schemas';

/** `S-005` の入口（`ENGINEER_FORM_CANCEL_HREF`（`_form/form-props.ts`）と同じ値である）。 */
export const ENGINEER_LIST_PATH = '/engineers';

/**
 * 🔴 一覧に出すスキルの件数（`docs/04` §S-005「主要スキル（上位 3 のみ表示、超過は `+N`）」/
 *    §「テーブルの列ごとの省略方針」）。**`S-016`（匿名候補）の 8 件とは別の値である**
 *    （あちらは `U-06` の開示上限であり、こちらは列幅の都合）。
 */
export const PRIMARY_SKILL_LIMIT = 3;

/** 上位 3 件を選ぶのに要る最小限（名前は選抜の判断に使わない）。 */
export type EngineerSkillCandidate = {
  readonly skillId: string;
  readonly yearsOfExperience: number;
};

/**
 * 🔴 **「主要スキル」の決定的な選び方**: 経験年数の降順、同順は `skillId` の昇順。
 *
 * `docs/02` `F-017` 処理②が匿名候補のスキル並びに定めている規則と**同じもの**を使う
 * （2 つの規則を持つと、同じエンジニアが自社台帳と匿名候補で違うスキルを代表として出す）。
 * 🔴 入力の配列を破壊しない（DB から読んだ配列をそのまま並べ替えると、呼び出し側の
 *    別の用途に影響する）。
 */
export function pickPrimarySkills<T extends EngineerSkillCandidate>(
  skills: readonly T[],
  limit: number = PRIMARY_SKILL_LIMIT,
): { readonly shown: readonly T[]; readonly more: number } {
  const sorted = [...skills].sort((a, b) => {
    if (a.yearsOfExperience !== b.yearsOfExperience) {
      return b.yearsOfExperience - a.yearsOfExperience;
    }
    return a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : 0;
  });
  return {
    shown: sorted.slice(0, limit),
    more: Math.max(sorted.length - limit, 0),
  };
}

/** 1 行分の表示値（すべて文字列。画面は組み立てをせず、そのまま描く）。 */
export type EngineerListRowView = {
  readonly id: string;
  readonly displayName: string;
  readonly ownership: string;
  readonly skills: readonly string[];
  /** 🔴 超過件数の表示（`+2`）。0 件なら `null`（`+0` を描かない）。 */
  readonly moreSkills: string | null;
  readonly unitPrice: string;
  readonly availableFrom: string;
  /** 勤務地・リモート可否（`docs/04` §S-005 の 1 列）。 */
  readonly location: string;
  readonly availability: string;
  readonly updatedOn: string;
};

/** 未設定（`docs/04` §S-006 と同じく、空欄にせず `—` を置く）。 */
function none(): string {
  return t('engineers.detail.valueNone');
}

/**
 * 勤務地とリモート可否を 1 列に畳む（`docs/04` §S-005 の「勤務地・リモート」列）。
 * 🔴 片方しか無い行を `—` にしない（`formatUnitPriceRange` と同じ判断。片側でも営業判断に使える）。
 */
export function formatLocation(
  prefecture: OwnEngineerView['prefecture'],
  remoteMode: OwnEngineerView['remoteMode'],
): string {
  const parts = [
    prefecture === null ? null : t(PREFECTURE_MESSAGE_KEYS[prefecture]),
    remoteMode === null ? null : t(REMOTE_MODE_MESSAGE_KEYS[remoteMode]),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? none() : parts.join('・');
}

export function engineerListRow(view: OwnEngineerView): EngineerListRowView {
  return {
    id: view.id,
    displayName: view.displayName,
    ownership:
      view.ownership === 'HOST' ? t('engineers.ownership.host') : t('engineers.ownership.partner'),
    skills: view.primarySkills.map((skill) => skill.name),
    // 🔴 `+N` は語ではなく記号 + 数値である（`formatUnitPriceRange` の `〜` と同じ扱い）。
    moreSkills: view.moreSkillCount === 0 ? null : `+${view.moreSkillCount}`,
    unitPrice: formatUnitPriceRange(view.unitPriceMin, view.unitPriceMax),
    availableFrom: view.availableFrom ?? none(),
    location: formatLocation(view.prefecture, view.remoteMode),
    availability: t(ENGINEER_AVAILABILITY_MESSAGE_KEYS[view.availability]),
    updatedOn: view.updatedOn,
  };
}

export function engineerListRows(
  items: readonly OwnEngineerView[],
): readonly EngineerListRowView[] {
  return items.map(engineerListRow);
}

/**
 * 🔴 **母集団の明示**（`docs/04` §3.2 項目 2 / §S-005「母集団の明示」）。
 *
 * ホスト:「自社台帳 1,240 件」/ 取引先:「**御社が登録した人材** 128 件」。
 * 🔴 値は API の `total`（＝ 一覧と同じ `where` の `COUNT`。境界適用後）だけを使う。
 *    クライアントで数え直さない（数え直すと、ページングした瞬間に件数が変わる）。
 * 🔴 出所は `ctx.partnerCompanyId` である（行の値ではない。`F-008 AC-2` と同じ規律）。
 */
export function engineerPopulationLabel(partnerCompanyId: string | null, total: number): string {
  const scope =
    partnerCompanyId === null
      ? t('engineers.list.population.host')
      : t('engineers.list.population.partner');
  // 🔴 3 桁区切りは `lib/format/number.ts` の `formatThousands` を使う（`toLocaleString` を使わない理由も
  //    そちらに書いてある。2 実装にすると単価と件数で桁区切りがずれる）。
  return `${scope} ${formatThousands(total)} ${t('engineers.list.population.unit')}`;
}

// ============================================================================
// 検索条件（`docs/04` §S-005 セクション 1・2 / `F-009`）— URL の組み立てと解除の導線。T-06-04。
// ============================================================================

/**
 * 検索条件を保ったままの `S-005` へのリンクを作る。
 *
 * 🔴 **ページングで条件が落ちない**ことが目的である（`docs/04` §10.1 `S-005` Err
 *    「条件保持の再試行」/ §S-005「条件は URL に反映（共有・再現可能）」）。
 * 🔴 `cursor` は引数で**明示**する（`null` = 先頭ページ）。呼び出し側が「今のカーソルを
 *    引き継ぐのか捨てるのか」を書かずに済ませられないようにするためである。
 * 🔴 パラメータの並びは固定である（同じ条件からは必ず同じ URL になる。テストで固定できる）。
 * 🔴 **既定値は URL に載せない**（`limit` / `skillMode` / オフのチェックボックス）——
 *    既定の URL を `?skillMode=AND&onlyInTime=0&limit=50` で汚さない。
 */
export function engineerListHref(query: EngineerListQuery, cursor: string | null): string {
  const params = new URLSearchParams();
  for (const skillId of query.skills ?? []) params.append('skills', skillId);
  if (query.skillMode !== ENGINEER_SKILL_MODE_DEFAULT) params.set('skillMode', query.skillMode);
  if (query.yearsMin !== undefined) params.set('yearsMin', String(query.yearsMin));
  if (query.priceMin !== undefined) params.set('priceMin', String(query.priceMin));
  if (query.priceMax !== undefined) params.set('priceMax', String(query.priceMax));
  if (query.availableBy !== undefined) params.set('availableBy', query.availableBy);
  if (query.prefecture !== undefined) params.set('prefecture', query.prefecture);
  if (query.remote !== undefined) params.set('remote', query.remote);
  if (query.availability !== undefined) params.set('availability', query.availability);
  if (query.q !== undefined) params.set('q', query.q);
  // 🔴 既定オフ（`F-009 AC-5`）。オンのときだけ載る ＝ **URL からオンだと分かる**。
  if (query.onlyInTime) params.set('onlyInTime', '1');
  if (query.onlyCommutable) params.set('onlyCommutable', '1');
  if (query.limit !== PAGE_SIZE_DEFAULT) params.set('limit', String(query.limit));
  if (cursor !== null) params.set('cursor', cursor);
  const search = params.toString();
  return search === '' ? ENGINEER_LIST_PATH : `${ENGINEER_LIST_PATH}?${search}`;
}

/**
 * 🔴 **絞り込みが 1 つでも効いているか**（`docs/04` §10.1 `S-005`: 初回空と絞込 0 件は
 *    **文言も導線も別物**である）。
 * 🔴 ページング（`cursor`）と表示件数（`limit`）は絞り込みではないので数えない ——
 *    2 ページ目が 0 件でも「条件に一致する人材はいません」にはならない。
 * 🔴 `skillMode` も数えない（単独では母集団を変えない。`skills` が 0 / 1 件なら結果も同じ）。
 * 🔴 **判定は `activeEngineerFilters` に委ねる**（条件を列挙する場所を 2 つ作らない）。
 *    2 本にすると、条件を足したときに「絞込 0 件の文言は出るのに解除の導線が無い」
 *    （あるいはその逆の）行き止まりが生まれる。辞書は要らない（名前が引けなくても
 *    **件数は変わらない**）。
 */
export function hasEngineerListFilters(query: EngineerListQuery): boolean {
  return activeEngineerFilters(query, new Map()).length > 0;
}

/** 効いている条件 1 件（`docs/04` §10.1 `S-005`「スキル: Java を外す」）。 */
export type EngineerActiveFilterView = {
  /** `data-testid` と React の `key`。文言ではない。 */
  readonly key: string;
  /** 「スキル: Java」。 */
  readonly label: string;
  /** 🔴 **その条件だけ**を外した URL（他の条件は保つ）。カーソルは先頭に戻す。 */
  readonly href: string;
};

/** 条件を 1 つ外した query を作る（元の query を壊さない）。 */
function without(
  query: EngineerListQuery,
  overrides: Partial<EngineerListQuery>,
): EngineerListQuery {
  // 🔴 ページングは必ず先頭へ戻す（条件が変わればカーソルの意味も変わる）。
  return { ...query, ...overrides, cursor: undefined };
}

/**
 * 🔴 **効いている条件を列挙し、1 つずつ外せるようにする**（`docs/04` §10.1 `S-005` 絞込 0 件:
 *    「条件に一致する人材はいません」+ **効いている条件を列挙して 1 つずつ外せる導線**）。
 *
 * 🔴 **`docs/01` §1.1-2「見えていない候補が増える」への手当てである。** 0 件になったときに
 *    「どの条件が効いているのか」が分からないと、利用者は条件を全部消してやり直すしかなく、
 *    絞り込みそのものが使われなくなる。
 * 🔴 スキルは**1 件ずつ**外せる（`docs/04` の例が「スキル: Java を外す」と単数である）。
 *
 * @param skillNames 辞書 ID → 表示名。**画面が選択肢のために既に読んでいる辞書**を渡す
 *   （ここから DB を引かない。本ファイルは I/O を持たない）。未知の ID は ID をそのまま出す
 *   —— 「名前が引けない ＝ 条件が消える」という形にすると、外せない条件が残る。
 */
export function activeEngineerFilters(
  query: EngineerListQuery,
  skillNames: ReadonlyMap<string, string>,
): readonly EngineerActiveFilterView[] {
  const filters: EngineerActiveFilterView[] = [];
  const push = (key: string, label: string, next: EngineerListQuery): void => {
    filters.push({ key, label, href: engineerListHref(next, null) });
  };

  for (const skillId of query.skills ?? []) {
    push(
      `skill-${skillId}`,
      `${t('engineers.list.search.skills')}: ${skillNames.get(skillId) ?? skillId}`,
      without(query, { skills: (query.skills ?? []).filter((id) => id !== skillId) }),
    );
  }
  if (query.yearsMin !== undefined) {
    push(
      'yearsMin',
      `${t('engineers.list.search.yearsMin')}: ${String(query.yearsMin)} ${t('engineers.detail.years.unit')}`,
      without(query, { yearsMin: undefined }),
    );
  }
  if (query.priceMin !== undefined) {
    push(
      'priceMin',
      `${t('engineers.list.search.priceMin')}: ${formatThousands(query.priceMin)} ${t('engineers.unitPrice.unit')}`,
      without(query, { priceMin: undefined }),
    );
  }
  if (query.priceMax !== undefined) {
    push(
      'priceMax',
      `${t('engineers.list.search.priceMax')}: ${formatThousands(query.priceMax)} ${t('engineers.unitPrice.unit')}`,
      without(query, { priceMax: undefined }),
    );
  }
  if (query.availableBy !== undefined) {
    push(
      'availableBy',
      `${t('engineers.list.search.availableBy')}: ${query.availableBy}`,
      without(query, { availableBy: undefined }),
    );
  }
  if (query.prefecture !== undefined) {
    push(
      'prefecture',
      `${t('engineers.list.search.prefecture')}: ${t(PREFECTURE_MESSAGE_KEYS[query.prefecture])}`,
      without(query, { prefecture: undefined }),
    );
  }
  if (query.remote !== undefined) {
    push(
      'remote',
      `${t('engineers.list.search.remote')}: ${t(REMOTE_MODE_MESSAGE_KEYS[query.remote])}`,
      without(query, { remote: undefined }),
    );
  }
  if (query.availability !== undefined) {
    push(
      'availability',
      `${t('engineers.list.search.availability')}: ${t(ENGINEER_AVAILABILITY_MESSAGE_KEYS[query.availability])}`,
      without(query, { availability: undefined }),
    );
  }
  if (query.q !== undefined) {
    push(
      'q',
      `${t('engineers.list.search.q')}: ${query.q}`,
      without(query, { q: undefined }),
    );
  }
  // 🔴 チェックボックスも「効いている条件」である（`docs/04` §10.1 `S-005`:
  //    絞込 0 件のときは「絞り込みチェックボックスがオンです」の注意も出す）。
  if (query.onlyInTime) {
    push(
      'onlyInTime',
      t('engineers.list.search.onlyInTime'),
      without(query, { onlyInTime: false }),
    );
  }
  if (query.onlyCommutable) {
    push(
      'onlyCommutable',
      t('engineers.list.search.onlyCommutable'),
      without(query, { onlyCommutable: false }),
    );
  }
  return filters;
}
