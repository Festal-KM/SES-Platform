// packages/ai/src/roles/gate-inspector.test.ts
// T-07-05: `gate-inspector` のロール定義（CLAUDE.md §12.2 / docs/05 §7.1 / §7.4 / §11）。
//
// ここで固定するのは 3 つ:
//   ① 🔴 **整合層の合否を返す形が存在しない**（警告は `severity: 'WARN'` のリテラル。`BR-61`）
//   ② 🔴 層の合否と指摘の整合（`FAIL` には `BLOCK` の根拠が要る）を**受信後に**検査すること
//      —— JSON Schema では表現できず、`safeParse` だけが担保である（docs/03 申し送り 10）
//   ③ 出力スキーマが構造化出力で使える形であること（再帰・`minItems > 1`・外部 `$ref` が無い）
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ROLE_PURPOSE } from '@ses/domain';
import { mask, type KnownSensitiveValues } from '../mask.js';
import {
  GATE_INSPECTOR_MAX_OUTPUT_TOKENS,
  GATE_INSPECTOR_TIMEOUT_MS,
  gateInspectorOutputSchema,
  gateInspectorSpec,
  type GateInspectorInput,
  type GateInspectorOutput,
} from './gate-inspector.js';

const NO_KNOWN_VALUES: KnownSensitiveValues = {
  fullNames: [],
  birthDates: [],
  emails: [],
  phones: [],
  affiliations: [],
  unitPrices: [],
  endClientNames: [],
};

const masked = (raw: string) => mask(raw, NO_KNOWN_VALUES).text;

function output(overrides: Partial<GateInspectorOutput> = {}): GateInspectorOutput {
  return {
    pii: { verdict: 'PASS', findings: [] },
    commerce: { verdict: 'PASS', findings: [] },
    consistencyWarnings: [],
    ...overrides,
  };
}

const BLOCK_FINDING = {
  kind: 'FULL_NAME',
  field: 'body',
  offsetStart: 3,
  offsetEnd: 7,
  excerpt: '山田太郎',
  severity: 'BLOCK',
} as const;

describe('ロール定義（docs/05 §7.1）', () => {
  it('role / purpose / モデル段 / 上限が定義どおりである', () => {
    expect(gateInspectorSpec.role).toBe('gate-inspector');
    // 🔴 purpose はロールと 1:1（手書きしない。docs/05 §7.9 ③）。
    expect(gateInspectorSpec.purpose).toBe(ROLE_PURPOSE['gate-inspector']);
    expect(gateInspectorSpec.defaultModel).toBe('DEFAULT');
    expect(gateInspectorSpec.maxOutputTokens).toBe(GATE_INSPECTOR_MAX_OUTPUT_TOKENS);
    expect(gateInspectorSpec.timeoutMs).toBe(GATE_INSPECTOR_TIMEOUT_MS);
  });

  it('入力は 1 つ以上の欄を要求する（空の検査を成立させない）', () => {
    const empty = { audienceKind: 'PARTNER', sections: [] };
    expect(gateInspectorSpec.inputSchema.safeParse(empty).success).toBe(false);
  });

  it('🔴 マスキングを経ていない空文字は入力として受け付けない', () => {
    const broken = { audienceKind: 'PARTNER', sections: [{ field: 'body', text: '' }] };
    expect(gateInspectorSpec.inputSchema.safeParse(broken).success).toBe(false);
  });

  it('未知の欄は入力として受け付けない', () => {
    const broken = { audienceKind: 'PARTNER', sections: [{ field: 'internal_memo', text: 'x' }] };
    expect(gateInspectorSpec.inputSchema.safeParse(broken).success).toBe(false);
  });

  it('正しい入力は素通りし、ブランドを落とさない（buildPrompt に渡せる）', () => {
    const valid: GateInspectorInput = {
      audienceKind: 'EXTERNAL_CLIENT',
      sections: [{ field: 'public_summary', text: masked('公開文です') }],
    };
    const parsed = gateInspectorSpec.inputSchema.parse(valid);
    expect(gateInspectorSpec.buildPrompt(parsed).user).toContain('公開文です');
  });
});

describe('プロンプトの内容（検査基準そのもの。CLAUDE.md §3.3 / §12.2）', () => {
  const prompt = gateInspectorSpec.buildPrompt({
    audienceKind: 'PARTNER',
    sections: [{ field: 'body', text: masked('本文') }],
  });

  it('🔴 整合層の合否を判定しないことが明記されている（CLAUDE.md §12.2 / BR-61）', () => {
    expect(prompt.system).toContain('整合層の合否は決めません');
    expect(prompt.system).toContain('severity は必ず "WARN"');
  });

  it('PII 層と商流層の判定基準が両方書かれている（CLAUDE.md §3.3 の第 1・2 層）', () => {
    expect(prompt.system).toContain('# ① PII 層の判定');
    expect(prompt.system).toContain('# ② 商流層の判定');
    // 🔴 パートナー間の相互参照（CLAUDE.md §3.1 の最大事故）が商流層の対象に入っている。
    expect(prompt.system).toContain('他の取引先企業の社名');
  });

  it('🔴 伏せ字を指摘・復元させない指示が入っている（BR-11）', () => {
    expect(prompt.system).toContain('伏せ字そのものを指摘しないでください');
    expect(prompt.system).toContain('推測したり復元したりしないでください');
  });

  it('共有先の区分が user 側に載る（区分で商流層の基準が変わるため）', () => {
    expect(prompt.user).toContain('PARTNER（取引先企業の担当者');
    const toEndClient = gateInspectorSpec.buildPrompt({
      audienceKind: 'EXTERNAL_CLIENT',
      sections: [{ field: 'body', text: masked('本文') }],
    });
    expect(toEndClient.user).toContain('EXTERNAL_CLIENT（エンド企業など');
  });

  it('🔴 LLM に操作をさせないことが明記されている（docs/05 §7.8 対策 4）', () => {
    expect(prompt.system).toContain('送信・承認・公開などの操作も行いません');
  });
});

describe('🔴 出力スキーマ: 整合層の警告は合否を作れない（BR-61 / F-020 AC-4）', () => {
  it('severity=WARN の警告は受理される', () => {
    const parsed = gateInspectorOutputSchema.safeParse(
      output({
        consistencyWarnings: [
          {
            kind: 'SKILL_SHEET_MISMATCH',
            field: 'body',
            offsetStart: null,
            offsetEnd: null,
            excerpt: '経験年数の合計が経歴と合いません',
            severity: 'WARN',
          },
        ],
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('🔴 severity=BLOCK の警告を返す形が存在しない（型としても実行時としても）', () => {
    const parsed = gateInspectorOutputSchema.safeParse({
      ...output(),
      consistencyWarnings: [
        {
          kind: 'SKILL_SHEET_MISMATCH',
          field: 'body',
          offsetStart: null,
          offsetEnd: null,
          excerpt: 'x',
          severity: 'BLOCK',
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('🔴 重複提案（DUPLICATE_PROPOSAL）は AI の警告種別に無い（F-037 の機械的照合の領分）', () => {
    const parsed = gateInspectorOutputSchema.safeParse({
      ...output(),
      consistencyWarnings: [
        {
          kind: 'DUPLICATE_PROPOSAL',
          field: 'body',
          offsetStart: null,
          offsetEnd: null,
          excerpt: 'x',
          severity: 'WARN',
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('🔴 整合層の verdict を返す口が無い（合否は decideConsistency だけが決める）', () => {
    const parsed = gateInspectorOutputSchema.safeParse({
      ...output(),
      consistency: { verdict: 'FAIL', findings: [] },
    });
    // 🔴 モデルが勝手に整合層の合否を付けてきても、**`safeParse` の出力に現れない**（落ちる）。
    //    ここで応答ごと失敗にしないのは、失敗が `gate-inspector` の失敗 = PII / 商流の FAIL
    //    （docs/05 §7.4）を意味するためである。余分なキーは合否に触れないので、
    //    「落として先へ進む」ほうが正しい。**到達しないことがここでの担保である。**
    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.keys(parsed.data)).toEqual(['pii', 'commerce', 'consistencyWarnings']);
  });
});

describe('🔴 受信後の再検証（JSON Schema では表現できない不変条件）', () => {
  it('FAIL なのに BLOCK の根拠が無い応答は弾く', () => {
    const parsed = gateInspectorOutputSchema.safeParse(output({ pii: { verdict: 'FAIL', findings: [] } }));
    expect(parsed.success).toBe(false);
  });

  it('PASS なのに BLOCK の指摘がある応答は弾く', () => {
    const parsed = gateInspectorOutputSchema.safeParse(
      output({ pii: { verdict: 'PASS', findings: [BLOCK_FINDING] } }),
    );
    expect(parsed.success).toBe(false);
  });

  it('FAIL + BLOCK の指摘は受理される', () => {
    const parsed = gateInspectorOutputSchema.safeParse(
      output({ pii: { verdict: 'FAIL', findings: [BLOCK_FINDING] } }),
    );
    expect(parsed.success).toBe(true);
  });

  it('層をまたいだ種別は弾く（商流層の指摘を PII 層に入れられない）', () => {
    // 🔴 この形は**型としても書けない**（`GateInspectorOutput` の pii.findings は PII の種別しか
    //    受け付けない）。ここで見ているのは、モデルが実際に返してきた場合の実行時の挙動である。
    const crossLayer: unknown = {
      ...output(),
      pii: { verdict: 'FAIL', findings: [{ ...BLOCK_FINDING, kind: 'UNIT_PRICE' }] },
    };
    expect(gateInspectorOutputSchema.safeParse(crossLayer).success).toBe(false);
  });

  it('excerpt が 80 文字を超える応答は弾く（本文の複製を findings に溜めない）', () => {
    const parsed = gateInspectorOutputSchema.safeParse(
      output({ pii: { verdict: 'FAIL', findings: [{ ...BLOCK_FINDING, excerpt: 'あ'.repeat(81) }] } }),
    );
    expect(parsed.success).toBe(false);
  });

  it('負のオフセット・片方だけ null・逆順のオフセットは弾く（画面のハイライトが壊れる）', () => {
    const cases = [
      { offsetStart: -1, offsetEnd: 3 },
      { offsetStart: 3, offsetEnd: null },
      { offsetStart: null, offsetEnd: 3 },
      { offsetStart: 7, offsetEnd: 7 },
      { offsetStart: 9, offsetEnd: 4 },
    ];
    for (const offsets of cases) {
      const parsed = gateInspectorOutputSchema.safeParse(
        output({ pii: { verdict: 'FAIL', findings: [{ ...BLOCK_FINDING, ...offsets }] } }),
      );
      expect(parsed.success, `${JSON.stringify(offsets)} が通ってしまう`).toBe(false);
    }
  });

  it('「箇所を特定できない」は両方 null で表す（空文字や -1 ではない）', () => {
    const parsed = gateInspectorOutputSchema.safeParse(
      output({
        commerce: {
          verdict: 'FAIL',
          findings: [{ ...BLOCK_FINDING, kind: 'END_CLIENT', offsetStart: null, offsetEnd: null }],
        },
      }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe('🔴 出力スキーマが構造化出力で使える形であること（docs/05 §7.4）', () => {
  const jsonSchema = JSON.stringify(
    z.toJSONSchema(gateInspectorSpec.outputSchema, { target: 'draft-2020-12', io: 'output' }),
  );

  it('$ref / $defs を含まない（再帰スキーマ・外部参照が無い）', () => {
    expect(jsonSchema).not.toContain('"$ref"');
    expect(jsonSchema).not.toContain('"$defs"');
  });

  it('minItems > 1 を含まない', () => {
    expect(jsonSchema).not.toMatch(/"minItems":\s*([2-9]|\d{2,})/);
  });

  it('整合層の警告の severity が const:"WARN" になっている（スキーマ側でも BLOCK を作れない）', () => {
    expect(jsonSchema).toContain('"const":"WARN"');
  });

  it('⚠️ maxLength / minimum は JSON Schema に載るが API 側では無視される（だから safeParse が要る）', () => {
    expect(jsonSchema).toContain('"maxLength":80');
    expect(jsonSchema).toContain('"minimum":0');
  });
});
