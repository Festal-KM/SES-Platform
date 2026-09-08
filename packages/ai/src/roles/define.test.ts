// packages/ai/src/roles/define.test.ts
// T-07-05（T-07-01 の申し送り 2）: 🔴 **RoleSpec の登録時の静的チェック**（docs/05 §7.4）。
//
// 🔴 ここで落とすものは「呼べば必ず失敗する定義」である。実行時（LLM 呼び出し後）に気づくと
//    原価だけが出る（`AiUsage` に行が立つ）ため、**起動の時点**で落とす。
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ROLE_PURPOSE } from '@ses/domain';
import type { MaskedText } from '../mask.js';
import { maskedTemplate } from '../mask.js';
import {
  assertOutputSchemaSupported,
  defineRoleSpec,
  InvalidRoleSpecError,
  parsePromptVersion,
  UnsupportedOutputSchemaError,
} from './define.js';
import type { RoleSpec } from './types.js';

const SYSTEM: MaskedText = maskedTemplate`検査担当である。`;
const USER: MaskedText = maskedTemplate`資料である。`;

type Input = { readonly content: string };

function spec(overrides: Partial<RoleSpec<Input, unknown>> = {}): RoleSpec<Input, unknown> {
  return {
    role: 'gate-inspector',
    purpose: ROLE_PURPOSE['gate-inspector'],
    inputSchema: z.object({ content: z.string() }),
    outputSchema: z.object({ verdict: z.enum(['PASS', 'FAIL']) }),
    promptVersion: 'gate-inspector.v1',
    buildPrompt: () => ({ system: SYSTEM, user: USER }),
    defaultModel: 'DEFAULT',
    maxOutputTokens: 1_024,
    timeoutMs: 20_000,
    ...overrides,
  };
}

describe('parsePromptVersion（docs/05 §7.7 の {role}.v{n}）', () => {
  it('正しい形を分解できる', () => {
    expect(parsePromptVersion('gate-inspector.v1')).toEqual({ role: 'gate-inspector', revision: 1 });
    expect(parsePromptVersion('sheet-parser.v12')).toEqual({ role: 'sheet-parser', revision: 12 });
  });

  it('🔴 v0 / 先頭 0 / 版なし / 大文字は認めない（版の一意性が崩れる）', () => {
    for (const invalid of ['gate-inspector.v0', 'gate-inspector.v01', 'gate-inspector', 'Gate.v1', 'gate-inspector.v1.1']) {
      expect(parsePromptVersion(invalid), invalid).toBeUndefined();
    }
  });
});

describe('defineRoleSpec の検査（docs/05 §7.4）', () => {
  it('正しい定義はそのまま返る', () => {
    const defined = defineRoleSpec(spec());
    expect(defined.role).toBe('gate-inspector');
  });

  it('🔴 purpose がロールと食い違う定義は起動時に落ちる（F-063 のロール別原価が壊れるため）', () => {
    expect(() => defineRoleSpec(spec({ purpose: 'sheet_parse' }))).toThrow(InvalidRoleSpecError);
  });

  it('🔴 promptVersion の形が違う定義は落ちる（生成物から版を引けなくなる）', () => {
    expect(() => defineRoleSpec(spec({ promptVersion: 'v1' }))).toThrow(InvalidRoleSpecError);
  });

  it('🔴 promptVersion のロール名が食い違う定義は落ちる', () => {
    expect(() => defineRoleSpec(spec({ promptVersion: 'sheet-parser.v1' }))).toThrow(InvalidRoleSpecError);
  });

  it('maxOutputTokens / timeoutMs が正の整数でない定義は落ちる', () => {
    expect(() => defineRoleSpec(spec({ maxOutputTokens: 0 }))).toThrow(InvalidRoleSpecError);
    expect(() => defineRoleSpec(spec({ timeoutMs: -1 }))).toThrow(InvalidRoleSpecError);
  });
});

describe('🔴 出力スキーマの制約（docs/03 §3.3.3。構造化出力が対応しない形）', () => {
  it('minItems > 1 を持つスキーマは落ちる', () => {
    const schema = z.object({ items: z.array(z.string()).min(2) });
    expect(() => assertOutputSchemaSupported('gate-inspector', schema)).toThrow(UnsupportedOutputSchemaError);
    expect(() => defineRoleSpec(spec({ outputSchema: schema }))).toThrow(UnsupportedOutputSchemaError);
  });

  it('minItems: 1 は許される（「1 件以上」は使える）', () => {
    expect(() => assertOutputSchemaSupported('gate-inspector', z.object({ items: z.array(z.string()).min(1) }))).not.toThrow();
  });

  it('🔴 再帰スキーマは落ちる（JSON Schema に $ref が出る）', () => {
    type Node = { readonly label: string; readonly child: Node | null };
    const node: z.ZodType<Node> = z.object({
      label: z.string(),
      get child() {
        return z.union([node, z.null()]);
      },
    });
    expect(() => assertOutputSchemaSupported('gate-inspector', node)).toThrow(UnsupportedOutputSchemaError);
  });

  it('同じ部分スキーマを複数回使っても展開される（$defs にならないので許される）', () => {
    const shared = z.object({ value: z.string() });
    const schema = z.object({ a: shared, b: shared });
    expect(JSON.stringify(z.toJSONSchema(schema))).not.toContain('$defs');
    expect(() => assertOutputSchemaSupported('gate-inspector', schema)).not.toThrow();
  });

  it('🔴 キーワードとフィールド名を取り違えない（`$ref` という名前の出力項目は誤検知しない）', () => {
    // 検査するのは JSON Schema のキーワードであって、利用者のプロパティ名ではない。
    expect(() => assertOutputSchemaSupported('gate-inspector', z.object({ $ref: z.string(), minItems: z.number() }))).not.toThrow();
  });

  it('例外メッセージに理由（どの位置の何か）が入る', () => {
    try {
      assertOutputSchemaSupported('gate-inspector', z.object({ items: z.array(z.string()).min(3) }));
      expect.unreachable('落ちるはず');
    } catch (error) {
      expect(String(error)).toContain('minItems');
    }
  });
});
