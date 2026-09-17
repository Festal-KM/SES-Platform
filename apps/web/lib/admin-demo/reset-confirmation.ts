// apps/web/lib/admin-demo/reset-confirmation.ts
// 🔴 T-10-07: `A-012` リセットの確認入力（環境名 + テナント名）の照合。docs/04 §A-012「操作と結果」/ docs/05 §13.6。
//
// 🔴 純粋関数・import 無し。`'use client'` の描画部品（ボタンの有効化）と API-A16 のサービス（400 の判定）が**同じ 1 関数**を
//    呼ぶ。画面側で「一致するまで無効」にしても、サーバ側の判定はこの関数で必ずやり直す（画面の無効化は確認の UX であって
//    統制ではない）。
// 🔴 完全一致（前後の空白だけは除く）。大文字小文字・全角半角の寄せ方をしない —— 「間違った環境で叩いた」を止める板であり、
//    寛容にすると板の意味が無くなる。

export type DemoResetConfirmationTarget = {
  /** 接続先の `APP_ENV`（`demo` / `development`。判定済みの値をそのまま受ける）。 */
  readonly appEnv: string;
  /** `demo` プリセットのテナント名（`株式会社サンプルアルファ` / `株式会社サンプルブラボー`）。 */
  readonly tenantNames: readonly string[];
};

export type DemoResetConfirmationInput = {
  readonly confirmEnv: string;
  readonly confirmTenantName: string;
};

function normalize(value: string): string {
  return value.trim();
}

/** 環境名が接続先と一致するか。 */
export function matchesDemoResetEnv(target: DemoResetConfirmationTarget, confirmEnv: string): boolean {
  return normalize(confirmEnv) !== '' && normalize(confirmEnv) === target.appEnv;
}

/** テナント名が `demo` プリセットのいずれかと一致するか。 */
export function matchesDemoResetTenantName(target: DemoResetConfirmationTarget, confirmTenantName: string): boolean {
  const value = normalize(confirmTenantName);
  return value !== '' && target.tenantNames.some((name) => name === value);
}

/** 🔴 両方が一致したときだけ真（片方の一致では実行に進めない）。 */
export function matchesDemoResetConfirmation(
  target: DemoResetConfirmationTarget,
  input: DemoResetConfirmationInput,
): boolean {
  return matchesDemoResetEnv(target, input.confirmEnv) && matchesDemoResetTenantName(target, input.confirmTenantName);
}
