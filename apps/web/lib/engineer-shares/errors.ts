// apps/web/lib/engineer-shares/errors.ts
// `GET /api/engineer-shares`（#29。`S-015`）のカーソルに固有の例外。T-11-11。
//
// 🔴 docs/05 §15.1 の階層（`AppError`）の上に置く。**別の階層も別の応答フォーマットも作らない**
//    （`lib/api/errors.ts` 冒頭の規律。`toAppError` は `instanceof AppError` で拾い、`toApiErrorBody` が
//    `code` / `messageKey` / `details` を同じ形で返す）。
// 🔴 置き場所を `lib/api/errors.ts` ではなく本モジュールにしたのは、この例外が **`schemas.ts` のカーソルの形
//    （`ENGINEER_SHARE_CURSOR_PATTERN`）と対**であり、形の定義とその拒否を同じモジュール群に閉じるためである
//    （docs/05 §6.4「#29 の改訂」→「T-11-11 の実装の決着」）。
import type { MessageKey } from '@ses/i18n';
import { AppError } from '../api/errors';

/**
 * 🔴 `mode` と `shared` の組み合わせが合わないカーソル（`shared=true` に `u:` / それ以外に `s:`）＝ **400**
 *    （docs/05 §6.4「#29 の改訂」の「カーソルの形と、改竄・流用の拒否」）。
 *
 * 別の並びのキーで「その後ろ」を読むとページの境目で重複・欠落が起きる。**黙って先頭に戻さない**
 * （T-08-05 の「組み合わせが合わないカーソルは 400」と同じ判断）。
 * 🔴 `ValidationError` と別コードにする理由: カーソルの**書式は正しく**、`shared` との**組み合わせ**だけが
 *    問題である。画面はこのコードで「条件を変えたので最初から表示し直す」へ導く。
 * 🔴 母集団（自社の台帳。RLS C3）の外には 1 行も出ない —— これは境界の問題ではなく、ページの整合の問題である。
 */
export class CursorModeMismatchError extends AppError {
  readonly code = 'CURSOR_MODE_MISMATCH';
  readonly httpStatus = 400;
  readonly userMessageKey: MessageKey = 'error.engineerShares.cursorModeMismatch';
  override readonly details: readonly string[] = ['query.cursor'];

  constructor() {
    super('一覧のカーソルが共有状態フィルタと合いません（1 ページ目から読み直してください）。');
    this.name = 'CursorModeMismatchError';
  }
}
