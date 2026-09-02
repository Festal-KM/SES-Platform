// packages/config/src/app-env.ts
// APP_ENV の 5 値。docs/03 §6.1 / CLAUDE.md §11 が定める唯一の分岐キー。
// 新しい環境を追加する場合はここに 1 箇所追記すれば、schema.ts / connector-selection.ts の
// switch の網羅性検査（TypeScript の exhaustive check）が漏れを検出する。

export const APP_ENV_KINDS = ['development', 'demo', 'sandbox', 'staging', 'production'] as const;

export type AppEnvKind = (typeof APP_ENV_KINDS)[number];

/** switch 文の default 節で使う。到達したら型がすべての枝を検査していない証拠になる。 */
export function assertNever(value: never, context: string): never {
  throw new Error(`${context}: 未対応の値です: ${String(value)}`);
}
