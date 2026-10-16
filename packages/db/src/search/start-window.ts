// packages/db/src/search/start-window.ts
// ✅✅ **開始時期の絞り込み**（2026-10-16。人間の明示指示「これちゃんと参考にして、検索部分
// 修正してよ」+ 受領モック `デザインモック/自社案件管理_案件一覧.png` の「開始時期: すべて」）。
//
// ============================================================================
// 🔴 なぜ「日付の入力」から「期間の選択」に変えるのか
// ============================================================================
// 着手前の実装は `開始日（この日以降）` の **`<input type="date">`** だった。モックは
// **選択肢**（すべて / 即日 / 今月 / 来月 / 再来月以降）である。営業が案件を探すときに知りたいのは
// 「2026-11-13 以降か」ではなく「**いま出せるか / 来月までに出せるか**」であり、
// 日付を打たせると**その月の初日を自分で計算させる**ことになる。
//
// ============================================================================
// 🔴 現在時刻をこのモジュールが読まない
// ============================================================================
// `today` を**引数で受け取る**。理由は 2 つある:
//   ① `packages/domain` と同じ規律（`CLAUDE.md` §2.1「現在時刻の取得を持ち込まない」）を
//      検索の変換にも効かせる —— 月をまたぐ瞬間の挙動をテストで固定できる。
//   ② 一覧と `COUNT` が**同じ日付**で動くことを呼び出し側が保証できる（1 リクエストの中で
//      `new Date()` を 2 回呼ぶと、日付の境目で件数と行がずれうる）。
import { toDateOnly } from '../date-only.js';

/**
 * 開始時期の区分（モックの選択肢そのもの）。
 * 🔴 **増やさない。** 増やすと「すべて」を含めた選択肢が 6 つを超え、走査の対象になる。
 */
export const PROJECT_START_WINDOWS = ['IMMEDIATE', 'THIS_MONTH', 'NEXT_MONTH', 'LATER'] as const;

export type ProjectStartWindow = (typeof PROJECT_START_WINDOWS)[number];

/** 変換の結果（`YYYY-MM-DD`。`projectSearchWhere` の `startFrom` / `startTo` に渡す）。 */
export type StartWindowRange = {
  readonly startFrom?: string;
  /** 🔴 **この日を含まない**（`lt`）。月末の日数を数えずに「翌月の 1 日未満」で表せる。 */
  readonly startTo?: string;
};

function iso(year: number, monthIndex: number, day: number): string {
  // 🔴 UTC で組む（`toDateOnly` が `YYYY-MM-DD` を UTC の 0 時として読むため、
  //    ローカル時刻で組むと JST では 1 日ずれる）。
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

/**
 * 区分 → 開始日の範囲。
 *
 * | 区分 | 意味 | 範囲 |
 * |---|---|---|
 * | `IMMEDIATE` | 即日 | 開始日が **今日以前**（もう始められる。過去日も含む） |
 * | `THIS_MONTH` | 今月 | 今日 〜 今月末 |
 * | `NEXT_MONTH` | 来月 | 来月の 1 日 〜 来月末 |
 * | `LATER` | 再来月以降 | 再来月の 1 日 以降 |
 *
 * 🔴 **`IMMEDIATE` に過去日を含める。** 開始日が過ぎている案件は「もう始められる」であって
 *    「対象外」ではない（`docs/01` §1.1-2「見えていない候補が増える」を作らない）。
 * 🔴 **区分は重ならない**（`THIS_MONTH` は今日以降に限る）。重なると「今月」と「即日」の
 *    両方に同じ案件が出て、件数の合計が母集団を超える。
 * 🔴 **開始日が未設定（`null`）の案件はどの区分にも一致しない**（比較で偽になる。
 *    `prefecture` と同じで、絞り込みを掛けたときだけ落ちる）。
 */
export function resolveStartWindow(window: ProjectStartWindow, today: Date): StartWindowRange {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const todayIso = today.toISOString().slice(0, 10);
  switch (window) {
    case 'IMMEDIATE':
      // 🔴 `startTo` は「翌日の 0 時未満」= 今日を含む。
      return { startTo: iso(year, month, today.getUTCDate() + 1) };
    case 'THIS_MONTH':
      return { startFrom: todayIso, startTo: iso(year, month + 1, 1) };
    case 'NEXT_MONTH':
      return { startFrom: iso(year, month + 1, 1), startTo: iso(year, month + 2, 1) };
    case 'LATER':
      return { startFrom: iso(year, month + 2, 1) };
  }
}

/** 🔴 `Date` に直してから述語に渡す（`toDateOnly` の 1 実装を通す）。 */
export function startWindowDates(range: StartWindowRange): {
  readonly gte?: Date;
  readonly lt?: Date;
} {
  return {
    ...(range.startFrom === undefined ? {} : { gte: toDateOnly(range.startFrom) }),
    ...(range.startTo === undefined ? {} : { lt: toDateOnly(range.startTo) }),
  };
}
