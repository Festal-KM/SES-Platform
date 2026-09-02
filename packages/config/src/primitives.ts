// packages/config/src/primitives.ts
// docs/03 §6 の「フォーマット / 検証」列を Zod のプリミティブへ落とすための共通ヘルパー。
// env.ts / schema.ts から使う。ここに business logic は置かない（純粋なパーサ定義のみ）。
//
// 🔴 `node:buffer` 等の Node 組み込みモジュールに依存しない（`packages/config` 単体の
// `tsc -p tsconfig.json` は `@types/node` の型（ルート tsconfig.json の `types: []` の対象）を
// 読み込まないため、素の文字列演算だけで base64 のデコード後バイト数を計算する）。

import { z } from 'zod';

/** 標準アルファベットの base64 文字列を、デコードせずに文字数からバイト数を計算する。 */
function base64ByteLength(value: string): number | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  const paddingMatch = /={1,2}$/.exec(value);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  return (value.length / 4) * 3 - padding;
}

/** base64 で指定バイト数「以上」であることを要求する（鍵の強度確認用）。 */
export function base64AtLeastBytes(minBytes: number) {
  return z.string().refine(
    (value) => {
      const length = base64ByteLength(value);
      return length !== null && length >= minBytes;
    },
    { message: `base64 で ${minBytes} バイト以上である必要があります` },
  );
}

/** base64 で「正確に」指定バイト数であることを要求する（AES-256-GCM 鍵など）。 */
export function base64ExactBytes(bytes: number) {
  return z.string().refine((value) => base64ByteLength(value) === bytes, {
    message: `base64 で正確に ${bytes} バイトである必要があります`,
  });
}

/**
 * `"true" | "false"` の文字列を厳密に真偽値へ変換する。
 * 🔴 `z.coerce.boolean()` は `Boolean(value)` を使うため、`"false"` という文字列すら
 * truthy になってしまう既知の罠がある。環境変数のフラグには使わない（docs/05 §13.4 の
 * コード例は概念図であり、この実装上の落とし穴の回避は実装者の裁量とする）。
 */
export function envBoolean(defaultValue?: boolean) {
  const base = z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return defaultValue;
      if (value === 'true') return true;
      if (value === 'false') return false;
      ctx.addIssue({ code: 'custom', message: '"true" または "false" である必要があります' });
      return z.NEVER;
    });
  return base;
}

/** カンマ区切りの列挙値（例: `ESIGN_ENABLED_PROVIDERS=docusign,cloudsign`）。空要素は無視する。 */
export function csvOf<const T extends readonly [string, ...string[]]>(values: T) {
  // z.enum() は `readonly string[]` を受け付ける（`_enum<const T extends readonly string[]>`）ため、
  // キャストせずそのまま渡す。キャストすると literal union 情報が失われ、呼び出し側
  // （例: ESIGN_ENABLED_PROVIDERS）の型が汎用 `string[]` に広がってしまう。
  const item = z.enum(values);
  return z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      const parts = value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      const parsed: z.infer<typeof item>[] = [];
      for (const part of parts) {
        const result = item.safeParse(part);
        if (!result.success) {
          ctx.addIssue({ code: 'custom', message: `不明な値です: ${part}` });
          continue;
        }
        parsed.push(result.data);
      }
      if (parsed.length === 0) {
        ctx.addIssue({ code: 'custom', message: '1 件以上の値が必要です' });
        return z.NEVER;
      }
      return parsed;
    });
}

/** PostgreSQL 接続文字列が `sslmode=require` を含むかどうか。 */
export function hasSslModeRequire(url: string): boolean {
  return /[?&]sslmode=require(&|$)/.test(url);
}

/** `demo.docusign.net`（sandbox / demo アカウント）のみ許可し、それ以外の `*.docusign.net` は本番とみなす。 */
const DOCUSIGN_SANDBOX_HOST = 'demo.docusign.net';

/**
 * `ESIGN_API_BASE_URL` が DocuSign 本番のホスト（`{region}.docusign.net`。`demo.docusign.net` を除く）
 * を指しているかどうか（docs/03 §6.10-3 / docs/05 §13.4 規則 2）。
 * 🔴 `URL` グローバル型（lib.dom）に依存しない（`packages/config` の tsconfig は `lib: ["ES2023"]`
 * のみで DOM 型を含まないため、`hasSslModeRequire` と同じく文字列の正規表現でホスト部を取り出す）。
 */
export function isDocusignProductionBaseUrl(url: string): boolean {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  if (!match) return false;
  const host = (match[1] ?? '').split(':')[0]?.toLowerCase() ?? '';
  const isDocusignHost = host === 'docusign.net' || host.endsWith('.docusign.net');
  return isDocusignHost && host !== DOCUSIGN_SANDBOX_HOST;
}
