// packages/ai/src/gate-consistency-independence.test.ts
// T-07-07 の完了判定（SP-07 §4）: 🔴 **LLM のモック応答を変えても整合層の合否が変わらない**
//   （`F-020 AC-3` / `AC-4` / `BR-61`）。
//
// ============================================================================
// 🔴 なぜ `packages/ai` 側にこのテストを置くか
// ============================================================================
// 「合否が LLM で揺れない」ことは、整合層だけを見ていても実証できない —— **AI を実際に走らせて、
// 応答を変えて、それでも同じ結果になる**ことを見て初めて実証になる。ここでは
// `MockAnthropicClient`（E2E / 結合と同一実装。docs/05 §17.5）で `gate-inspector` を
// 5 通りの応答（全層 PASS / PII FAIL / 警告つき / スキーマ違反 / タイムアウト）で走らせ、
// 同じ `ConsistencyInput` に対する `decideConsistency` の結果が 1 ビットも変わらないことを見る。
//
// ⚠️ **申し送り（T-07-06）**: ゲートのパイプライン（`gate.run` → `decideGate` → `ReviewGate` 保存）は
//    未実装であり、ここで実証できるのは「AI の実行経路と整合層を**併置**して結果が独立である」
//    ところまでである。**パイプラインを通した検証（AI 応答を変えても `ReviewGate.consistencyVerdict`
//    と対象の状態が変わらない）は T-07-06 が引き継ぐ**（docs/05 §11.8 ⑦）。
//
// 🔴 実 API には接続しない（モックのみ）。
import { decideConsistency, type ConsistencyInput } from '@ses/domain';
import { describe, expect, it } from 'vitest';
import { mask, type KnownSensitiveValues } from './mask.js';
import { MockAnthropicClient, type MockAnthropicStep } from './mock/index.js';
import { catalogRoleModelResolver } from './models.js';
import {
  gateInspectorSpec,
  type GateInspectorInput,
  type GateInspectorOutput,
} from './roles/gate-inspector.js';
import type { AiCallContext, RoleResult } from './roles/types.js';
import { createRoleRunner } from './run.js';
import type { AiCostGuard, AiUsageRecorder } from './usage.js';

const NO_KNOWN_VALUES: KnownSensitiveValues = {
  fullNames: [],
  birthDates: [],
  emails: [],
  phones: [],
  affiliations: [],
  unitPrices: [],
  endClientNames: [],
};

const REACT = '00000000-0000-7000-8000-0000000000a1';
const TYPESCRIPT = '00000000-0000-7000-8000-0000000000a2';

/**
 * 🔴 整合層の入力。**AI に渡す本文とは別の出所**（DB に永続化された値）である。
 *    必須要件 TypeScript 3.0 年を主張していないため、機械的照合は FAIL になる。
 */
const CONSISTENCY_INPUT: ConsistencyInput = {
  subject: {
    snapshot: { skills: [{ skillId: REACT, label: 'React', years: 5, level: 3 }] },
    requirements: [
      { kind: 'MUST', skill: { id: REACT, label: 'React' }, requiredYears: 3 },
      { kind: 'MUST', skill: { id: TYPESCRIPT, label: 'TypeScript' }, requiredYears: 3 },
    ],
    registeredSkills: [{ skillId: REACT, years: 5, level: 3 }],
  },
};

function inspectorInput(): GateInspectorInput {
  return {
    audienceKind: 'PARTNER',
    sections: [
      { field: 'body', text: mask('React の経験が豊富な要員をご提案します。', NO_KNOWN_VALUES).text },
      { field: 'snapshot', text: mask('React 5 年 / レベル 3', NO_KNOWN_VALUES).text },
    ],
  };
}

function layer(
  verdict: 'PASS' | 'FAIL',
  findings: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  return { verdict, findings };
}

const PII_BLOCK = {
  kind: 'FULL_NAME',
  field: 'snapshot',
  offsetStart: 0,
  offsetEnd: 3,
  excerpt: '[名前]',
  severity: 'BLOCK',
};

const CONSISTENCY_WARNING = {
  kind: 'MUST_REQUIREMENT_MISMATCH',
  field: 'body',
  offsetStart: null,
  offsetEnd: null,
  excerpt: '要件との齟齬の疑い',
  severity: 'WARN',
};

/** 🔴 応答を変えるのはここだけ。整合層の入力は上の 1 つで固定している。 */
const SCENARIOS: readonly { readonly name: string; readonly script: readonly MockAnthropicStep[] }[] = [
  {
    name: '全層 PASS・警告なし',
    script: [
      { kind: 'output', output: { pii: layer('PASS'), commerce: layer('PASS'), consistencyWarnings: [] } },
    ],
  },
  {
    name: 'PII 層が FAIL（BLOCK の指摘つき）',
    script: [
      {
        kind: 'output',
        output: { pii: layer('FAIL', [PII_BLOCK]), commerce: layer('PASS'), consistencyWarnings: [] },
      },
    ],
  },
  {
    name: '🔴 整合層の警告が 2 件（合否を変えてはならない）',
    script: [
      {
        kind: 'output',
        output: {
          pii: layer('PASS'),
          commerce: layer('PASS'),
          consistencyWarnings: [
            CONSISTENCY_WARNING,
            { ...CONSISTENCY_WARNING, kind: 'SKILL_SHEET_MISMATCH', field: 'snapshot' },
          ],
        },
      },
    ],
  },
  {
    name: 'スキーマ違反（再試行しても直らない）',
    script: [{ kind: 'output', output: { pii: { verdict: 'MAYBE' } } }],
  },
  {
    name: 'タイムアウト（LLM の失敗）',
    script: [{ kind: 'error', error: 'TIMEOUT' }],
  },
];

function fixedClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 8, 8, 0, 0, tick++));
}

const callContext: AiCallContext = {
  tenantId: '00000000-0000-7000-8000-000000000101',
  targetType: 'PROPOSAL',
  targetId: '00000000-0000-7000-8000-000000000001',
  now: fixedClock(),
};

async function runInspector(
  script: readonly MockAnthropicStep[],
): Promise<RoleResult<GateInspectorOutput>> {
  const client = new MockAnthropicClient({ script });
  const usage: AiUsageRecorder = {
    record: () => Promise.resolve('usage-1'),
    countUnit: () => Promise.resolve(),
  };
  const costGuard: AiCostGuard = {
    reserve: () => Promise.resolve({ handle: 'reservation-1' }),
    settle: () => Promise.resolve(),
  };
  const runner = createRoleRunner({
    client,
    usage,
    costGuard,
    models: catalogRoleModelResolver({ DEFAULT: 'model-default', CHEAP: 'model-cheap' }),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });
  return runner.runRole(gateInspectorSpec, inspectorInput(), callContext);
}

describe('🔴 整合層の合否は LLM の応答に依存しない（F-020 AC-3 / BR-61）', () => {
  const baseline = decideConsistency(CONSISTENCY_INPUT);

  it('対照: 整合層は機械的照合だけで FAIL を出している（空振りしていない）', () => {
    expect(baseline.verdict).toBe('FAIL');
    expect(baseline.findings.map((finding) => finding.excerpt)).toEqual(['TypeScript -/3.0']);
  });

  it.each(SCENARIOS)('$name —— 応答が変わっても整合層の結果は同一', async ({ script }) => {
    const result = await runInspector(script);
    // AI の結果がどうであれ（成功・失敗・警告つき）、整合層は同じ入力から同じ結論を出す。
    expect(decideConsistency(CONSISTENCY_INPUT)).toEqual(baseline);
    // 対照: シナリオが実際に AI 経路を通っている（`ok` の真偽はシナリオごとに異なる）。
    expect(typeof result.ok).toBe('boolean');
    expect(result.provenance.role).toBe('gate-inspector');
  });

  it('対照: シナリオが実際に異なる応答を生んでいる（成功 3 / 失敗 2）', async () => {
    const results = await Promise.all(SCENARIOS.map((scenario) => runInspector(scenario.script)));
    expect(results.map((result) => result.ok)).toEqual([true, true, true, false, false]);
  });

  it('🔴 警告のみが存在する状態でも整合層は PASS（F-020 AC-4）', async () => {
    const warned = SCENARIOS[2];
    if (warned === undefined) throw new Error('シナリオの並びが変わっています。');
    const result = await runInspector(warned.script);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // AI は整合層について 2 件の警告を出している。
    expect(result.output.consistencyWarnings).toHaveLength(2);
    for (const warning of result.output.consistencyWarnings) {
      expect(warning.severity).toBe('WARN'); // 🔴 BLOCK を返す形がスキーマに無い
    }

    // 🔴 その警告だけがある状態（機械的照合に不一致が無い入力）では、整合層は PASS である。
    const clean: ConsistencyInput = {
      subject: {
        snapshot: { skills: [{ skillId: REACT, label: 'React', years: 5, level: 3 }] },
        requirements: [{ kind: 'MUST', skill: { id: REACT, label: 'React' }, requiredYears: 3 }],
        registeredSkills: [{ skillId: REACT, years: 5, level: 3 }],
      },
    };
    expect(decideConsistency(clean)).toEqual({ verdict: 'PASS', findings: [] });
  });

  it('🔴 AI が全層 PASS でも、機械的照合の FAIL は覆らない', async () => {
    const allPass = SCENARIOS[0];
    if (allPass === undefined) throw new Error('シナリオの並びが変わっています。');
    const result = await runInspector(allPass.script);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.pii.verdict).toBe('PASS');
    expect(decideConsistency(CONSISTENCY_INPUT).verdict).toBe('FAIL');
  });

  it('🔴 gate-inspector の出力を decideConsistency に渡す口が型として無い', async () => {
    const result = await runInspector(SCENARIOS[0]?.script ?? []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const input: ConsistencyInput = {
      // @ts-expect-error 🔴 BR-61: AI の出力は整合層の入力になり得ない（別フィールドで併記する）
      aiWarnings: result.output.consistencyWarnings,
    };
    expect(decideConsistency(input).verdict).toBe('PASS');
  });
});
