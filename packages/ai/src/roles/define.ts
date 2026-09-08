// packages/ai/src/roles/define.ts
// 🔴 `RoleSpec` の**登録時の静的チェック**（docs/05 §7.4「`packages/ai` の登録時に静的チェック
//    （ビルド時に落とす）」。T-07-01 の申し送り 2）。
//
// ============================================================================
// 🔴 なぜ「登録時」なのか
// ============================================================================
// ロールの定義はモジュールのトップレベルにあるため、ここで throw すると **import した時点
// （＝ ワーカーの起動時）に落ちる**。LLM を呼んでから落ちるのとは意味が違う:
//   ① 呼んでから落ちると**原価だけが出る**（`AiUsage` に行が立ち、返るのは失敗）。
//   ② スキーマの不備は「たまたまその日その要求で顕在化する」種類の欠陥であり、
//      本番で最初に踏むのが利用者になる。
//
// 検査するのは docs/03 §3.3.3 / docs/05 §7.4 が「使わない」と決めた 3 つである:
//   - 再帰スキーマ / 外部 `$ref` … JSON Schema に `$ref` / `$defs` が現れたら不可
//   - `minItems > 1`            … Anthropic の構造化出力が対応しない
// 🔴 これらは **JSON Schema 側で無視される制約とは別物**である。`maxLength` / `minimum` などは
//    「無視されるので受信後に `safeParse` で見る」（docs/03 申し送り 10）が、上の 3 つは
//    **要求そのものが通らない**ため、登録の時点で落とす。

import { z } from 'zod';
import { ROLE_PURPOSE, type AiRole } from '@ses/domain';
import type { RoleSpec } from './types.js';

/** プロンプト版の形（docs/05 §7.7「`{ロール}.v{n}`」）。🔴 `v0` と先頭 0 は認めない。 */
export const PROMPT_VERSION_PATTERN = /^([a-z][a-z0-9-]*)\.v([1-9][0-9]*)$/;

export type ParsedPromptVersion = {
  readonly role: string;
  readonly revision: number;
};

/** `'gate-inspector.v1'` → `{ role: 'gate-inspector', revision: 1 }`。形が違えば `undefined`。 */
export function parsePromptVersion(version: string): ParsedPromptVersion | undefined {
  const matched = PROMPT_VERSION_PATTERN.exec(version);
  if (matched === null) return undefined;
  const [, role = '', revision = ''] = matched;
  return { role, revision: Number(revision) };
}

/** 🔴 ロール定義の不備。**握り潰さない**（起動を止める）。 */
export class InvalidRoleSpecError extends Error {
  readonly role: string;

  constructor(role: string, detail: string) {
    super(`RoleSpec（role=${role}）が不正です: ${detail}（docs/05 §7.1 / §7.4 / §7.7）`);
    this.name = 'InvalidRoleSpecError';
    this.role = role;
  }
}

/** 🔴 出力スキーマが Anthropic の構造化出力で使えない形である（docs/03 §3.3.3）。 */
export class UnsupportedOutputSchemaError extends Error {
  readonly role: string;

  constructor(role: string, detail: string, options?: { cause?: unknown }) {
    super(
      `RoleSpec（role=${role}）の outputSchema は構造化出力で使えません: ${detail}` +
        '（docs/03 §3.3.3 / docs/05 §7.4。再帰スキーマ・minItems > 1・外部 $ref は使わない）',
      options,
    );
    this.name = 'UnsupportedOutputSchemaError';
    this.role = role;
  }
}

/**
 * JSON Schema を再帰的に走査し、使えない構文を見つけたら理由を返す。
 *
 * 🔴 `isPropertyMap` は「今見ているオブジェクトのキーが**プロパティ名**である」ことを示す。
 *    区別しないと、出力に `$ref` という名前のフィールドを持つスキーマを誤検知する
 *    （キーワードなのか利用者のフィールド名なのかは、位置でしか決まらない）。
 */
function findUnsupported(node: unknown, path: string, isPropertyMap = false): string | undefined {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      const found = findUnsupported(item, `${path}[${index}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof node !== 'object' || node === null) return undefined;

  for (const [key, value] of Object.entries(node)) {
    const here = path === '' ? key : `${path}.${key}`;
    if (!isPropertyMap) {
      // 🔴 `$ref` は「再帰スキーマ」と「外部参照」の両方の現れ方である（Zod は循環を検出すると
      //    `$ref: '#'` を吐く）。`$defs` も同じ理由で不可（参照が前提の構造になっている）。
      if (key === '$ref') return `${here} に $ref があります（再帰スキーマまたは外部参照）`;
      if (key === '$defs' || key === 'definitions') return `${here} に定義の共有（$defs）があります`;
      if (key === 'minItems' && typeof value === 'number' && value > 1) {
        return `${here} = ${value}（minItems は 1 まで）`;
      }
    }
    const found = findUnsupported(value, here, key === 'properties' && !isPropertyMap);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 🔴 出力スキーマが構造化出力で使える形であることを検査する（docs/05 §7.4）。
 *
 * `zodOutputFormat` が実際に送るのと同じ変換（`z.toJSONSchema`）を通してから見る ——
 * Zod のスキーマを目で見て判断すると、`z.lazy` や参照の共有のように**変換して初めて
 * `$ref` になる**形を取りこぼす。
 */
export function assertOutputSchemaSupported(role: string, schema: z.ZodType<unknown>): void {
  let jsonSchema: unknown;
  try {
    jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' });
  } catch (cause) {
    throw new UnsupportedOutputSchemaError(role, 'JSON Schema へ変換できませんでした', { cause });
  }
  const unsupported = findUnsupported(jsonSchema, '');
  if (unsupported !== undefined) throw new UnsupportedOutputSchemaError(role, unsupported);
}

/**
 * 🔴 **ロール定義の唯一の登録口**（docs/05 §7.1 / §7.4）。ロールはここを通してから
 *    `runRole` に渡す。検査するのは 4 点:
 *
 *   ① `purpose` が `ROLE_PURPOSE[role]` と一致する（`AiUsage.purpose` はロールと 1:1。§7.9 ③）
 *   ② `promptVersion` が `{role}.v{n}` の形で、ロール名の部分が `role` と一致する（§7.7）
 *   ③ `outputSchema` が構造化出力で使える形である（§7.4）
 *   ④ `maxOutputTokens` / `timeoutMs` が正の整数である（0 や負値は「呼べば必ず失敗する」定義）
 *
 * 🔴 ① は `runRole` の手順 0 でも検査する（多重防御）。あちらは「実行の直前」、ここは
 *    「起動の時点」であり、**間違った定義を含むワーカーが起動できない**ことに意味がある。
 */
export function defineRoleSpec<I, O>(spec: RoleSpec<I, O>): RoleSpec<I, O> {
  const role: AiRole = spec.role;

  if (spec.purpose !== ROLE_PURPOSE[role]) {
    throw new InvalidRoleSpecError(
      role,
      `purpose が ROLE_PURPOSE['${role}']（${ROLE_PURPOSE[role]}）と一致しません（${spec.purpose}）`,
    );
  }

  const parsed = parsePromptVersion(spec.promptVersion);
  if (parsed === undefined) {
    throw new InvalidRoleSpecError(role, `promptVersion の形が {role}.v{n} ではありません（${spec.promptVersion}）`);
  }
  if (parsed.role !== role) {
    throw new InvalidRoleSpecError(
      role,
      `promptVersion のロール名が一致しません（${spec.promptVersion}）。生成物から版を引けなくなります`,
    );
  }

  assertOutputSchemaSupported(role, spec.outputSchema);

  if (!Number.isSafeInteger(spec.maxOutputTokens) || spec.maxOutputTokens <= 0) {
    throw new InvalidRoleSpecError(role, `maxOutputTokens が正の整数ではありません（${spec.maxOutputTokens}）`);
  }
  if (!Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs <= 0) {
    throw new InvalidRoleSpecError(role, `timeoutMs が正の整数ではありません（${spec.timeoutMs}）`);
  }

  return spec;
}
