// apps/web/lib/engineer-shares/schemas.ts
// docs/05 §6.4 #29（`GET /api/engineer-shares` / `PUT /api/engineers/{id}/share`。
// `F-016` / `S-015`）の境界検証。T-08-02 → 🔴 T-11-11 で `GET` に検索 3 条件 + カーソルページングを足した
// （docs/05 §6.4「#29 の改訂」。T-08-02 の「`GET` に query を持たせない」注記は同改訂で撤回された）。
//
// 🔴 **body は `{ shared: boolean }` の 1 項目だけ**である（docs/05 §6.4 #29 の「入力」）。
//    足してはならないものと、その理由:
//      - `partnerCompanyId` / `tenantId` … 分離キーは認証コンテキストからしか来ない
//        （`CLAUDE.md` §3.1 / `BR-03`）。`assertNoIsolationKeys` が構築時に落とす。
//      - `engineerIds`（複数形）… 🔴 **一括で全件をオンにする既定操作を作らない**
//        （`F-016 AC-1` / `BR-53`）。対象は path の `{id}` 1 件だけであり、
//        **配列を受け取る形が存在しない**ことが「全部共有するボタン」を作れない理由になる。
//      - 開示項目の上書き（出す / 出さないの選択）… 🔴 開示は 5 項目で固定であり、
//        利用者にもテナントにも選ばせない（`BR-54` / `CLAUDE.md` §8.6）。
//      - 共有の有効期限・共有先パートナーの指定 … 経路 4 の読み手はホストだけであり
//        （`BR-56`）、宛先という概念が無い。
//
// 🔴 **`GET` の query は 3 条件（`q` / `availableBy` / `shared`）+ ページング（`cursor` / `limit`）が最小で最大**
//    （`docs/04` §S-015「この 3 つが最小」）。スキル・単価・勤務地・`skillMode` を足さない —— 探索は `S-005`
//    （`#15`）の領分であり、条件を増やすほど `S-005` と二重の検索画面になる。`schemas.test.ts` がキー集合を固定する。
// 🔴 `q` / `availableBy` は **`#15` と同じフィールド定義**（`engineerSearchCriteriaFields`）を import して使う
//    ＝ 同じ意味・同じパーサ（`docs/04` §S-015「`S-005` と同じ『○月○日までに稼働可能』」）。
import { z } from 'zod';
import { assertNoIsolationKeys, type AssertNoIsolationKeys } from '../api/isolation-keys';
import { cursorPageQuerySchema } from '../api/pagination';
import { optionalFilter } from '../api/query-filters';
import { engineerSearchCriteriaFields } from '../engineers/schemas';
import { CursorModeMismatchError } from './errors';

/** `PUT /api/engineers/{id}/share` の path（対象の指定であって実行者のスコープではない）。 */
export const engineerShareParamsSchema = z.object({ id: z.uuid() });

export type EngineerShareParams = z.infer<typeof engineerShareParamsSchema>;

export type EngineerShareParamsIsolationGuard = AssertNoIsolationKeys<EngineerShareParams>;

assertNoIsolationKeys(Object.keys(engineerShareParamsSchema.shape), 'engineerShareParamsSchema');

/**
 * `PUT /api/engineers/{id}/share` の body。
 *
 * 🔴 `shared` は**必須**である（`.optional()` にしない）。省略を「オン」と解釈する余地を
 *    1 つも残さない —— 既定オフ（`F-016 AC-1`）は「行の非存在」で表現されており、
 *    省略時の既定値を書いた瞬間にその表現が破れる。
 */
export const engineerShareBodySchema = z.object({ shared: z.boolean() });

export type EngineerShareBody = z.infer<typeof engineerShareBodySchema>;

export type EngineerShareBodyIsolationGuard = AssertNoIsolationKeys<EngineerShareBody>;

assertNoIsolationKeys(Object.keys(engineerShareBodySchema.shape), 'engineerShareBodySchema');

// ---------------------------------------------------------------------------
// 🔴 `GET /api/engineer-shares` の query とカーソル（T-11-11。docs/05 §6.4「#29 の改訂」）
// ---------------------------------------------------------------------------

/** 並びの種別 = カーソルの `mode`。`s` = 共有開始日時の並び（`shared=true`）/ `u` = 更新日時の並び（それ以外）。 */
export type EngineerShareCursorMode = 's' | 'u';

/** UUID の字面（既存の UUID 検査 `lib/anonymize/reference.ts` / `lib/auth/claims.ts` と同じ）。 */
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** `epochMs` の桁数（13 桁の 10 進。2001-09-09 〜 2286-11-20 の範囲で固定長）。 */
const EPOCH_MS_DIGITS = 13;

/**
 * 🔴 カーソルは**並びのキーの組**（`#15` の T-08-05 = 並びのキー、に倣う）。
 *
 *   - `shared=true` … `s:{sharedAtEpochMs}:{engineerId}`（`engineer_shares.shared_at DESC, engineer_id DESC`）
 *   - それ以外     … `u:{updatedAtEpochMs}:{engineerId}`（`engineers.updated_at DESC, id DESC`）
 *
 * 両列とも `Timestamptz(3)` なのでミリ秒で可逆である。**形が違えば 400**（T-05-09 が塞いだ
 * 「UUID でない値が Postgres のキャストで 500」を再発させない）。
 * 🔴 **行の ID ではない**ので、ページの境目の行が解除・削除されても次ページは「そのキーより後ろ」として決まる
 *    （1 件ずつ解除する画面では**境目の行が消えるのが通常動作**である）。
 */
export const ENGINEER_SHARE_CURSOR_PATTERN = new RegExp(
  `^(?<mode>[su]):(?<ts>\\d{${EPOCH_MS_DIGITS}}):(?<id>${UUID_SOURCE})$`,
  'i',
);

export const engineerShareCursorSchema = z.string().regex(ENGINEER_SHARE_CURSOR_PATTERN);

/** 共有状態フィルタ（API の語彙）。🔴 省略 = すべて。boolean に coerce しない（`?shared=` の空文字は「指定なし」に畳む）。 */
export const ENGINEER_SHARE_API_SHARED_VALUES = ['true', 'false'] as const;

/**
 * `GET /api/engineer-shares` の query。
 * 🔴 `cursorPageQuerySchema.extend`（`limit` = 既定 `PAGE_SIZE_DEFAULT`〔50〕、上限 `PAGE_SIZE_MAX`〔200〕。超過は 400）。
 * 🔴 分離キーを持たない（`assertNoIsolationKeys`）。
 */
export const engineerShareListQuerySchema = cursorPageQuerySchema.extend({
  q: engineerSearchCriteriaFields.q,
  availableBy: engineerSearchCriteriaFields.availableBy,
  shared: optionalFilter(z.enum(ENGINEER_SHARE_API_SHARED_VALUES)),
  cursor: optionalFilter(engineerShareCursorSchema),
});

export type EngineerShareListQuery = z.infer<typeof engineerShareListQuerySchema>;

export type EngineerShareListQueryIsolationGuard = AssertNoIsolationKeys<EngineerShareListQuery>;

assertNoIsolationKeys(Object.keys(engineerShareListQuerySchema.shape), 'engineerShareListQuerySchema');

/** 復号したカーソル（キーセット述語の材料）。 */
export type EngineerShareCursor = {
  readonly mode: EngineerShareCursorMode;
  /** 並びの第 1 キーの値（`shared_at` または `updated_at`）。 */
  readonly at: Date;
  /** 並びの第 2 キー（`engineer_id` / `id`）。 */
  readonly engineerId: string;
};

/** `shared` の値 → 並びの種別。**判定はここ 1 か所**（`service.ts` の駆動表の選択もこれを使う）。 */
export function engineerShareCursorMode(shared: 'true' | 'false' | undefined): EngineerShareCursorMode {
  return shared === 'true' ? 's' : 'u';
}

/**
 * 並びのキー → カーソル（`buildCursorPage` の `toCursor`）。`decode` と同じファイルに置き、形の定義を 2 箇所に持たない。
 */
export function encodeEngineerShareCursor(
  mode: EngineerShareCursorMode,
  row: { readonly at: Date; readonly engineerId: string },
): string {
  return `${mode}:${String(row.at.getTime()).padStart(EPOCH_MS_DIGITS, '0')}:${row.engineerId}`;
}

/**
 * カーソル → 並びのキー。🔴 `mode` と `shared` の組み合わせが合わなければ **400 `CURSOR_MODE_MISMATCH`**
 * （`shared=true` に `u:` / それ以外に `s:`。黙って先頭に戻さない）。
 *
 * @throws RangeError 形が合わないとき。🔴 API 境界では `engineerShareCursorSchema` が先に 400 にするので、
 *         ここに届くのは実装ミスだけである。値は message に載せない。
 * @throws CursorModeMismatchError 形は正しいが `shared` と組み合わせが合わないとき（400）。
 */
export function decodeEngineerShareCursor(
  cursor: string,
  shared: 'true' | 'false' | undefined,
): EngineerShareCursor {
  const match = ENGINEER_SHARE_CURSOR_PATTERN.exec(cursor);
  if (match === null || match.groups === undefined) {
    throw new RangeError('匿名共有の一覧のカーソルの形が不正です（docs/05 §6.4「#29 の改訂」）。');
  }
  const mode = match.groups['mode']?.toLowerCase() === 's' ? 's' : 'u';
  if (mode !== engineerShareCursorMode(shared)) throw new CursorModeMismatchError();
  return {
    mode,
    at: new Date(Number(match.groups['ts'])),
    engineerId: (match.groups['id'] ?? '').toLowerCase(),
  };
}
