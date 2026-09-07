// packages/db/src/search/projects.ts
// 案件の検索と既定の並び（`GET /api/projects`。docs/05 §6.4 #25 / `F-015` / `S-010`）。
// T-06-03 → 🔴 T-06-05 で `apps/web/lib/projects/list.ts` から**検索に相当する部分だけ**を
// ここへ移した（docs/05 TBD-8 / SP-06 T-06-05）。
//
// 🔴 **移したもの / 移していないもの**（T-06-05 の射程。`tests/static/search-sql-single-path.test.ts`
//    の冒頭に同じ定義がある）:
//      移した   … 検索条件 → 述語（特に**フリーワード**）、決定的な `ORDER BY` の定義とその自己検査
//      移さない … 一覧の `select` する列 / `count` の呼び出し / カーソルページング / 応答型の組み立て
//    理由: `docs/03` §3.7.3 の代替（段階 1〜4。最終的に OpenSearch）で**差し替わるのは前者だけ**
//    である。後者まで `packages/db` へ引き取ると、応答型（`HostProjectView` / `PartnerProjectView`）と
//    その射影の判断（`F-013 AC-2`）まで DB パッケージに移ってしまい、**射影の議論の置き場所が
//    2 つになる**。
//
// ============================================================================
// 🔴 ここに境界の条件を 1 つも書かない（`F-015 AC-1` / `F-014 AC-1` / `CLAUDE.md` §3.1）
// ============================================================================
// `projects` の RLS は **C4 VISIBILITY**（docs/05 §4.4 / migration 20260903050000）であり、
//   - ホスト文脈:     `tenant_id = app_tenant_id()` の全件
//   - パートナー文脈: **自社宛の `project_visibilities` の行が生きている案件だけ**
// が見える。したがって本モジュールの述語に `tenantId` / `partnerCompanyId` / `visibilities` は
// 1 度も現れない（`projects.test.ts` が文字列として数える）。
import type { PrefectureCode } from '@ses/domain';
import { toDateOnly } from '../date-only.js';
import { PROJECT_STATUSES, type ProjectStatus } from '../schema-value-sets.js';
import { freeWordOr, type FreeWordFilter } from './free-word.js';

/**
 * 本モジュールが組み立てる述語の形（Prisma の `ProjectWhereInput` の部分集合）。
 * 🔴 **列名を型で固定する**（`EngineerWhereFragment` と同じ理由）。とりわけ
 *    `endClientName` / `internalUnitPrice`（商流情報）を**型として持たない** —— 検索対象に
 *    したくなった実装がコンパイルで落ちる（`F-013 AC-2` / 下記 `projectSearchWhere` の 🔴）。
 */
export type ProjectWhereFragment = {
  status?: ProjectStatus;
  startDate?: { gte: Date };
  prefecture?: PrefectureCode;
  name?: FreeWordFilter;
  publicSummary?: FreeWordFilter;
  OR?: ProjectWhereFragment[];
};

/**
 * `GET /api/projects`（#25）の検索条件。
 *
 * 🔴 API 境界の Zod スキーマ（`apps/web/lib/projects/schemas.ts` の `ProjectListQuery`）が
 *    この型に構造的に適合する（`EngineerSearchCriteria` と同じ契約の結び方）。
 */
export type ProjectSearchCriteria = {
  readonly status?: ProjectStatus;
  /** 開始日が**この日以降**（`YYYY-MM-DD`）。 */
  readonly startFrom?: string;
  readonly prefecture?: PrefectureCode;
  readonly q?: string;
};

/**
 * 🔴 **既定の並びの第 1 キー**（`docs/04` §S-010 状態バッジ「`後任募集` は `F-045` の還流で
 *    自動生成される。**既定の並びで上位に置く**（放置すると還流が無意味になる）」）。
 *
 * `CLAUDE.md` §1.3 の「⑥ → ① の還流がこのプロダクトの中核」を一覧の既定の見え方で担保する。
 * 🔴 実装は `ORDER BY status DESC` である（`PROJECT_LIST_ORDER_BY`）。`CASE` 式で優先度を
 *    書くには raw SQL が要り、「検索の実装を `packages/db/src/search/**` の 1 箇所に閉じる」
 *    （SP-06 T-06-05 / docs/05 TBD-8）と衝突するためこの形を採った。
 * 🔴 したがって**値の綴りに順序が依存している**。依存を偶然のままにせず、本モジュールの
 *    読み込み時に「降順に並べた `PROJECT_STATUSES` がこの優先順位と一致すること」を検査する
 *    （`assertStatusPriority`）。状態を増やすと**その場で落ちる**ので、気づかないまま
 *    後任募集が沈むことはない。DB 側（照合順序）での実際の並びは
 *    `tests/isolation/projects.test.ts` が実データで固定する。
 */
export const PROJECT_STATUS_LIST_PRIORITY: readonly ProjectStatus[] = [
  'SUCCESSOR_WANTED',
  'OPEN',
  'FILLED',
];

/**
 * 🔴 既定の並び（`F-015 AC-3`「同一条件・同一データで並び順が常に同じ」/ docs/05 §4.8）。
 *
 *   ①`status` 降順   … 後任募集 → 募集中 → 充足（`docs/04` §S-010。上記）
 *   ②`updated_at` 降順 … `F-015` 処理③「更新日時」
 *   ③`start_date` 昇順（NULL 最後）… 同処理③「開始日」。同じ更新時刻の案件は開始日の近い順
 *   ④`id` 降順        … `uuid(7)` は時系列で単調増加するので、ここで順序が**一意**に決まる
 *
 * 🔴 **`ORDER BY` に「全体件数」「順位」を持ち込まない**（docs/05 §4.8）。境界外の行の有無で
 *    順位が動くと、並び順そのものが他社の存在を漏らす。①〜④はすべて**その行の列の値**だけで
 *    決まり、母集団の大きさに依存しない。
 * 🔴 スコア・重みの概念を持たない（`F-009 AC-2` と同じ Phase 1 の規律。スコアは `F-029`）。
 * 🔴 索引は `projects_tenant_id_status_updated_at_start_date_id_idx`（T-06-05。
 *    migration `20260912000000_search_indexes`）。**`tenant_id` が先頭列**であり、
 *    ②〜④の向き（`DESC` / `DESC` / `ASC NULLS LAST` / `DESC`）まで索引の定義と一致させてある
 *    —— 一致していないと `ORDER BY` がソートに落ち、1 万件で p95 1 秒（`F-015 AC-2`）に届かない。
 */
export const PROJECT_LIST_ORDER_BY = [
  { status: 'desc' },
  { updatedAt: 'desc' },
  { startDate: { sort: 'asc', nulls: 'last' } },
  { id: 'desc' },
] as const;

/**
 * 🔴 **`ORDER BY status DESC` が `PROJECT_STATUS_LIST_PRIORITY` を与えることの検査。**
 *
 * 🔴 照合するのは**値集合の出所（`PROJECT_STATUSES`）**であって、優先順位の配列自身ではない。
 *    自身と照合すると「この配列が綴りの降順に並んでいる」ことしか言えず、
 *    **`PROJECT_STATUSES` に状態が増えても落ちない**（優先順位の側が古いまま残り、
 *    新しい状態が `後任募集` より上に来ても気づけない）。
 * 🔴 読み込み時に落とす（`assertNoIsolationKeys` と同じ形）。テストだけに置くと、
 *    状態を足した変更が「テストを直せば通る」ものに見えてしまう。
 * 🔴 これで**値集合の増減と並び替えの両方**が起動時に検出される。
 * ⚠️ export しているのは、**検査そのものが実際に落ちること**をユニットテストで示すためである。
 */
export function assertStatusPriority(priority: readonly ProjectStatus[]): void {
  // DB は `status` を値の綴りで並べる。その降順が優先順位そのものでなければならない。
  const byDescendingValue = [...PROJECT_STATUSES].sort().reverse();
  if (byDescendingValue.join(',') !== priority.join(',')) {
    throw new Error(
      '案件一覧の既定の並び（ORDER BY status DESC）が PROJECT_STATUS_LIST_PRIORITY と一致しません' +
        `（期待: ${byDescendingValue.join(',')} / 宣言: ${priority.join(',')}）。` +
        '状態を追加・改名したときは docs/04 §S-010 の「後任募集を上位に置く」を満たす手段を' +
        '選び直してください（CLAUDE.md §8.6 / §8.7）。',
    );
  }
}

assertStatusPriority(PROJECT_STATUS_LIST_PRIORITY);

/**
 * 🔴 フリーワードの対象列（`docs/04` §S-010 の検索条件）。
 *
 * 🔴 **`end_client_name` を検索対象にしない** —— ホストだけが一致する検索を作ると、`where` が
 *    ロールで分岐して「一覧と `COUNT` が同じ述語」という担保（docs/05 §4.8）が崩れる
 *    （`F-013 AC-2` の趣旨にも反する）。`ProjectWhereFragment` に列自体を持たせていない。
 * 🔴 フリーワードは索引で加速されない（`free-word.ts` 冒頭の実測）。母集団は RLS の C4 が
 *    テナント / 公開範囲で絞っており、その中を走査する。
 */
const PROJECT_FREE_WORD_COLUMNS = ['name', 'publicSummary'] as const;

/**
 * 🔴 **検索条件 → 述語（`F-015` の入力）。これが一覧と `COUNT` の唯一の `where` である。**
 *
 * 🔴 ここに境界の条件を書かない（本ファイル冒頭）。返す述語はすべて**業務上の絞り込み**であり、
 *    条件が 1 つも指定されなければ `{}`（= 母集団そのもの）になる。
 * 🔴 **ソフト条件（適合による分割）を持たない。** `docs/02` A-03 が「減点 + 明示的なフィルタ」で
 *    扱うと定めた 2 項目（稼働可能時期 / 勤務地）は**人材側の条件**であり、案件検索には現れない。
 *    したがって `#25` は `SearchPlan` の形を採らず、単一の述語を返す（`plan.ts` の 🔴）。
 */
export function projectSearchWhere(criteria: ProjectSearchCriteria): ProjectWhereFragment {
  return {
    ...(criteria.status === undefined ? {} : { status: criteria.status }),
    // 🔴 `start_date` が未設定の案件は「開始日 X 以降」に一致しない（NULL は比較で偽）。
    //    絞り込みを掛けたときだけ落ちる挙動であり、既定（未指定）では全件が出る。
    ...(criteria.startFrom === undefined
      ? {}
      : { startDate: { gte: toDateOnly(criteria.startFrom) } }),
    ...(criteria.prefecture === undefined ? {} : { prefecture: criteria.prefecture }),
    ...(criteria.q === undefined ? {} : freeWordOr(criteria.q, PROJECT_FREE_WORD_COLUMNS)),
  };
}
