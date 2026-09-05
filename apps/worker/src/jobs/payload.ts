// apps/worker/src/jobs/payload.ts
// ジョブ payload の門番（docs/05 §9.1「payload は Zod スキーマで定義し、ワーカー側で `parse` する」）。
//
// 🔴 **不正なら例外にする。既定値で補完しない。** 補完すると「別のテナントを計測した」
//    「分類が欠けた送信が実送信側に落ちた」が、成功として記録されたまま本番まで残る。
//
// ⚠️ 申し送り（SP-07）: `apps/worker` が `zod` を依存に持つ時点で、本ファイルの手書きの門番を
//    Zod スキーマへ置き換える（T-03-10 からの申し送り。現時点で `zod` はワーカーの依存に無く、
//    宣言だけして未インストールのまま残すと build が壊れるため手書きにしてある）。

/** payload の解釈に失敗した（ジョブを実行しない）。 */
export class InvalidJobPayloadError extends Error {
  constructor(job: string, reason: string) {
    super(`${job}: payload が不正です（${reason}）。`);
    this.name = 'InvalidJobPayloadError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID の必須フィールド。 */
export function requireUuid(job: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new InvalidJobPayloadError(job, `${field} が UUID ではありません`);
  }
  return value;
}

/** 空でない文字列の必須フィールド。🔴 値そのものを例外メッセージに載せない（トークンが載りうる）。 */
export function requireNonEmptyString(job: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new InvalidJobPayloadError(job, `${field} が空でない文字列ではありません`);
  }
  return value;
}
