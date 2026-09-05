// apps/web/lib/password-reset/outcome.ts
// `S-046` ①→② の遷移ロジック（docs/04 §S-046 / `CLAUDE.md` §7「匿名候補の身元が...0 件」と
// 同種の非開示要件。ここでは「アカウントの存在有無が漏れないこと」を対象にする）。
//
// 🔴 存在有無の非開示: この関数は**応答の中身（ステータス・ボディ・メールアドレス）を
//    受け取らない**。受け取れるのは「サーバから応答が返ったか（例外を投げずに完了したか）」の
//    1 bit だけである。シグネチャがそれ以外の入力を持てないため、実装がどう変わっても
//    「登録の有無によって画面の表示が分岐する」経路を作りようがない。
//
// 🔴 API 側が存在有無によらず同一の応答（常に 204）を返すことは
//    `tests/isolation/invitations.test.ts`（T-03-03）の
//    「未知のメールアドレスでも例外にならない」「既知のメールアドレスはトークンが発行される」の
//    2 テストがすでに証明している。本モジュールはその先（画面側）を担保する。
export type RequestResetOutcome = 'submitted' | 'network-error';

/**
 * @param settled サーバから応答が返った（fetch が例外を投げずに完了した）か。
 *   🔴 ステータスコードやレスポンスボディを渡さない設計そのものが非開示の担保である。
 */
export function classifyRequestOutcome(settled: boolean): RequestResetOutcome {
  return settled ? 'submitted' : 'network-error';
}

/**
 * 送信前のローカル検証（構文のみ）。空欄・`@` を含まない・ドメイン部を欠く入力を弾く。
 *
 * 🔴 サーバ応答を一切読まない（`settled` の 1 bit しか見ない `classifyRequestOutcome` と同じ
 *    非開示の原則）。判定材料は利用者が今まさに入力した文字列だけであり、アカウントの存在有無
 *    とは無関係。`noValidate`（二重送信ガードのため付与）でブラウザの `type="email"` /
 *    `required` が働かないぶんを補う（`CLAUDE.md` §11.1「成功したように見えて実際には
 *    送信されていない」壊れ方を、空欄・形式不正のまま #5 を叩いて防ぐ）。
 * 🔴 厳密な RFC 検証はしない。厳密性は #5 の Zod スキーマ（`.email()`）が担う。
 */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
