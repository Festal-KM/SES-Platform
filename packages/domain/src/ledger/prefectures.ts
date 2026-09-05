// packages/domain/src/ledger/prefectures.ts
// 都道府県コード（JIS X 0401 の 2 桁）の唯一の出所。T-05-01。
//
// 🔴 なぜ `packages/domain` に置くか（CLAUDE.md §2.1）:
//    この値集合は ①`S-007` の入力（`F-008`。`engineers.prefecture`）②`F-009` の複合検索の
//    絞り込み ③`F-013` の案件（`projects.prefecture`）④`F-017` の匿名候補の開示 5 項目の
//    すべてが同じものを指す必要がある。`apps/web` に置くと `apps/worker`（`match.build`）が
//    同じ表を複製することになり、値がずれた時点でマッチングの母集団が静かに欠ける。
//    純粋なデータ（I/O・現在時刻を持たない）なので domain の制約にも反しない。
//
// 🔴 **表示名はここに持たない**（`CLAUDE.md` §3.5「ユーザー向け文言は `packages/i18n`」）。
//    名称は `packages/i18n` の `prefecture.{code}` が持ち、コードと文言キーの対応は
//    `apps/web/lib/engineers/labels.ts` の `PREFECTURE_MESSAGE_KEYS`
//    （`Record<PrefectureCode, MessageKey>` = 網羅をコンパイラが強制する）が引き受ける。
//    実際に 47 件すべてが空でない表示名を引けることは
//    `apps/web/lib/engineers/labels.test.ts` が機械的に確認する。
//    🔴 突き合わせを `packages/i18n` 側に置かないのは、`@ses/i18n` に `@ses/domain` への
//    依存を足さないためである（`packages/i18n` はクライアントコンポーネントから値 import
//    されうる区画であり、依存を増やすほど `tests/static/client-db-boundary.test.ts` の
//    「他パッケージへは深追いしない」前提が痩せる）。
//
// 🔴 `engineers.prefecture` / `projects.prefecture` に DB の CHECK は無い（docs/05 §3.4 / §3.5）。
//    したがって値の妥当性を守るのは API 境界の Zod（`z.enum(PREFECTURE_CODES)`）だけである。
//    ここを配列リテラルにしているのは、そのまま `z.enum` に渡せるようにするためである。

/** JIS X 0401 の都道府県コード（`01`〜`47`）。🔴 並びはコード昇順（表示順もこれに従う）。 */
export const PREFECTURE_CODES = [
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38', '39', '40',
  '41', '42', '43', '44', '45', '46', '47',
] as const;

export type PrefectureCode = (typeof PREFECTURE_CODES)[number];

export function isPrefectureCode(value: string): value is PrefectureCode {
  return (PREFECTURE_CODES as readonly string[]).includes(value);
}
