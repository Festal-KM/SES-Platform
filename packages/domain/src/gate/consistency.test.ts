// packages/domain/src/gate/consistency.test.ts
// T-07-07 の完了判定（SP-07 §4）:
//   - 🔴 **同一入力で 100 回実行して同じ結果**（`F-020 AC-3`）
//   - 🔴 警告のみの状態で当該層が PASS であること（`F-020 AC-4`。**警告はそもそも入力に無い**）
//   - Phase 1 の照合は ①必須要件 / ③登録スキルとの矛盾 の 2 項目だけ（docs/02 章 8.5）
//
// 🔴 LLM を呼ばない・モックも要らない。**それがこの層の設計そのもの**である（`BR-61`）。
//    「モック応答を変えても合否が変わらない」ことの実証は
//    `packages/ai/src/gate-consistency-independence.test.ts`（AI の実行経路と併置した検証）。
import { describe, expect, it } from 'vitest';
import {
  decideConsistency,
  type ConsistencyInput,
  type ConsistencySubject,
  type EngineerSkillFacts,
  type ProjectRequirementFacts,
  type SnapshotSkillFacts,
} from './consistency.js';

const REACT = '00000000-0000-7000-8000-0000000000a1';
const TYPESCRIPT = '00000000-0000-7000-8000-0000000000a2';
const AWS = '00000000-0000-7000-8000-0000000000a3';

function claim(
  skillId: string,
  years: number,
  overrides: Partial<SnapshotSkillFacts> = {},
): SnapshotSkillFacts {
  return { skillId, label: labelOf(skillId), years, level: null, ...overrides };
}

function backing(skillId: string, years: number, level: number | null = null): EngineerSkillFacts {
  return { skillId, years, level };
}

function must(skillId: string, requiredYears: number | null = null): ProjectRequirementFacts {
  return { kind: 'MUST', skill: { id: skillId, label: labelOf(skillId) }, requiredYears };
}

function labelOf(skillId: string): string {
  if (skillId === REACT) return 'React';
  if (skillId === TYPESCRIPT) return 'TypeScript';
  return 'AWS';
}

function subject(overrides: Partial<ConsistencySubject> = {}): ConsistencySubject {
  return {
    snapshot: { skills: [claim(REACT, 5)] },
    requirements: [must(REACT, 3)],
    registeredSkills: [backing(REACT, 5)],
    ...overrides,
  };
}

describe('decideConsistency —— 照合するものが無い対象', () => {
  it('subject が無ければ PASS（案件の公開・スキルシートの外部共有）', () => {
    expect(decideConsistency({})).toEqual({ verdict: 'PASS', findings: [] });
  });

  it('空の主張・空の要件でも PASS', () => {
    const decision = decideConsistency({
      subject: { snapshot: { skills: [] }, requirements: [], registeredSkills: [] },
    });
    expect(decision).toEqual({ verdict: 'PASS', findings: [] });
  });
});

describe('① 案件の必須要件との齟齬（docs/02 章 8.5 ①）', () => {
  it('必須要件を満たしていれば PASS（年数が同値でも満たす）', () => {
    const decision = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(REACT, 3)] },
        requirements: [must(REACT, 3)],
        registeredSkills: [backing(REACT, 3)],
      }),
    });
    expect(decision.verdict).toBe('PASS');
    expect(decision.findings).toEqual([]);
  });

  it('🔴 必須スキルを主張していなければ FAIL（該当箇所つき）', () => {
    const decision = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(TYPESCRIPT, 4)] },
        requirements: [must(REACT, 3)],
        registeredSkills: [backing(TYPESCRIPT, 4)],
      }),
    });
    expect(decision.verdict).toBe('FAIL');
    expect(decision.findings).toEqual([
      {
        layer: 'CONSISTENCY',
        kind: 'MUST_REQUIREMENT_MISMATCH',
        field: 'snapshot',
        offsetStart: null,
        offsetEnd: null,
        excerpt: 'React -/3.0',
        severity: 'BLOCK',
      },
    ]);
  });

  it('🔴 年数が要求に届かなければ FAIL（抜粋は {主張}/{要求}）', () => {
    const decision = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(REACT, 2.9)] },
        requirements: [must(REACT, 3)],
        registeredSkills: [backing(REACT, 2.9)],
      }),
    });
    expect(decision.verdict).toBe('FAIL');
    expect(decision.findings.map((finding) => finding.excerpt)).toEqual(['React 2.9/3.0']);
  });

  it('年数の指定が無い必須要件は「主張していること」だけを見る', () => {
    const present = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(REACT, 0)] },
        requirements: [must(REACT, null)],
        registeredSkills: [backing(REACT, 0)],
      }),
    });
    expect(present.verdict).toBe('PASS');

    const missing = decideConsistency({
      subject: subject({ snapshot: { skills: [] }, requirements: [must(REACT, null)], registeredSkills: [] }),
    });
    expect(missing.verdict).toBe('FAIL');
    expect(missing.findings.map((finding) => finding.excerpt)).toEqual(['React']);
  });

  it('🔴 NICE（尚可）要件は整合層の合否に効かない（`F-029` の足切りと同じ区分）', () => {
    const decision = decideConsistency({
      subject: subject({
        snapshot: { skills: [] },
        requirements: [{ kind: 'NICE', skill: { id: REACT, label: 'React' }, requiredYears: 10 }],
        registeredSkills: [],
      }),
    });
    expect(decision).toEqual({ verdict: 'PASS', findings: [] });
  });

  it('🔴 フリーテキストのみの必須要件は照合対象外（直せる元データが無い FAIL を作らない）', () => {
    const decision = decideConsistency({
      subject: subject({
        snapshot: { skills: [] },
        requirements: [{ kind: 'MUST', skill: null, requiredYears: 5 }],
        registeredSkills: [],
      }),
    });
    expect(decision).toEqual({ verdict: 'PASS', findings: [] });
  });

  it('同じスキルへの必須要件が複数あれば最も厳しい年数に束ねる（指摘は 1 件）', () => {
    const decision = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(REACT, 4)] },
        requirements: [must(REACT, 3), must(REACT, 6), must(REACT, null)],
        registeredSkills: [backing(REACT, 4)],
      }),
    });
    expect(decision.findings.map((finding) => finding.excerpt)).toEqual(['React 4.0/6.0']);
  });
});

describe('③ 登録スキルとの矛盾（docs/02 章 8.5 ③「登録値どうしの突合」）', () => {
  it('🔴 台帳に無いスキルを外部へ主張していたら FAIL', () => {
    const decision = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(REACT, 5), claim(AWS, 1)] },
        requirements: [],
        registeredSkills: [backing(REACT, 5)],
      }),
    });
    expect(decision.verdict).toBe('FAIL');
    expect(decision.findings.map((finding) => [finding.kind, finding.excerpt])).toEqual([
      ['SKILL_SHEET_MISMATCH', 'AWS'],
    ]);
  });

  it('🔴 台帳の裏付けを超える年数を主張していたら FAIL', () => {
    const decision = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(REACT, 8)] },
        requirements: [],
        registeredSkills: [backing(REACT, 5)],
      }),
    });
    expect(decision.findings.map((finding) => finding.excerpt)).toEqual(['React 8.0/5.0']);
  });

  it('🔴 台帳の方が大きい（控えめな主張）は FAIL にしない —— 凍結後に台帳が伸びるため（`F-019 AC-2`）', () => {
    const decision = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(REACT, 5)] },
        requirements: [must(REACT, 3)],
        registeredSkills: [backing(REACT, 9)],
      }),
    });
    expect(decision).toEqual({ verdict: 'PASS', findings: [] });
  });

  it('レベルも「主張が裏付けを超えていないか」だけを見る', () => {
    const over = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(REACT, 5, { level: 5 })] },
        requirements: [],
        registeredSkills: [backing(REACT, 5, 3)],
      }),
    });
    expect(over.findings.map((finding) => finding.excerpt)).toEqual(['React L5/L3']);

    const unbacked = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(REACT, 5, { level: 2 })] },
        requirements: [],
        registeredSkills: [backing(REACT, 5, null)],
      }),
    });
    // 裏付けが無いことは `-`（年数側の `-/3.0` と同じ表記。docs/05 §11.8 ④）。
    expect(unbacked.findings.map((finding) => finding.excerpt)).toEqual(['React L2/-']);

    const under = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(REACT, 5, { level: 2 })] },
        requirements: [],
        registeredSkills: [backing(REACT, 5, 4)],
      }),
    });
    expect(under.verdict).toBe('PASS');
  });

  it('1 つのスキルにつき指摘は 1 件（年数とレベルの両方が超過していても年数を返す）', () => {
    const decision = decideConsistency({
      subject: subject({
        snapshot: { skills: [claim(REACT, 8, { level: 5 })] },
        requirements: [],
        registeredSkills: [backing(REACT, 5, 3)],
      }),
    });
    expect(decision.findings).toHaveLength(1);
    expect(decision.findings[0]?.excerpt).toBe('React 8.0/5.0');
  });
});

describe('🔴 合否と指摘の不変条件（docs/05 §3.6 / §11.4）', () => {
  const failing = decideConsistency({
    subject: subject({
      snapshot: { skills: [claim(REACT, 1), claim(AWS, 2)] },
      requirements: [must(REACT, 3), must(TYPESCRIPT, 1)],
      registeredSkills: [backing(REACT, 1)],
    }),
  });

  it('不一致が 1 件でもあれば FAIL、無ければ PASS', () => {
    expect(failing.verdict).toBe('FAIL');
    expect(failing.findings.length).toBeGreaterThan(0);
  });

  it('🔴 返す指摘はすべて layer=CONSISTENCY / severity=BLOCK（警告を 1 件も返さない）', () => {
    for (const finding of failing.findings) {
      expect(finding.layer).toBe('CONSISTENCY');
      expect(finding.severity).toBe('BLOCK');
    }
  });

  it('🔴 該当箇所は「特定できない」を null で表す（-1 や空文字を使わない。docs/05 §11.7）', () => {
    for (const finding of failing.findings) {
      expect(finding.offsetStart).toBeNull();
      expect(finding.offsetEnd).toBeNull();
      expect(finding.field).toBe('snapshot');
    }
  });

  it('種別は Phase 1 の 2 種のみ（DUPLICATE_PROPOSAL を返さない）', () => {
    const kinds = new Set(failing.findings.map((finding) => finding.kind));
    expect([...kinds].sort()).toEqual(['MUST_REQUIREMENT_MISMATCH', 'SKILL_SHEET_MISMATCH']);
  });

  it('🔴 抜粋は 80 文字以内（docs/05 §3.6）', () => {
    const longLabel = `${'あ'.repeat(200)}`;
    const decision = decideConsistency({
      subject: {
        snapshot: { skills: [{ skillId: REACT, label: longLabel, years: 9, level: null }] },
        requirements: [{ kind: 'MUST', skill: { id: TYPESCRIPT, label: longLabel }, requiredYears: 3 }],
        registeredSkills: [backing(REACT, 1)],
      },
    });
    expect(decision.findings.length).toBe(2);
    for (const finding of decision.findings) {
      expect(finding.excerpt.length).toBeLessThanOrEqual(80);
      // 🔴 数値の側は削られない（切り詰めるのは名前の側）。
      expect(finding.excerpt.endsWith('/3.0') || finding.excerpt.endsWith('/1.0')).toBe(true);
    }
  });

  it('🔴 抜粋の切り詰めでサロゲートペアを割らない', () => {
    const label = `${'A'.repeat(79)}𩸽`; // UTF-16 で 81
    const decision = decideConsistency({
      subject: {
        snapshot: { skills: [{ skillId: REACT, label, years: 1, level: null }] },
        requirements: [],
        registeredSkills: [],
      },
    });
    const excerpt = decision.findings[0]?.excerpt ?? '';
    expect(excerpt.length).toBe(79);
    // 単独のサロゲートが残っていない（壊れた JSON を ReviewGate に入れない）。
    expect(/[\uD800-\uDFFF]/.test(excerpt)).toBe(false);
  });
});

describe('🔴 決定性（`F-020 AC-3`）', () => {
  const input: ConsistencyInput = {
    subject: subject({
      snapshot: { skills: [claim(REACT, 1), claim(AWS, 2, { level: 4 })] },
      requirements: [must(REACT, 3), must(TYPESCRIPT, 2)],
      registeredSkills: [backing(REACT, 1), backing(AWS, 2, 1)],
    }),
  };

  it('同一入力を 100 回実行しても同じ結果になる', () => {
    const first = JSON.stringify(decideConsistency(input));
    for (let i = 0; i < 100; i += 1) {
      expect(JSON.stringify(decideConsistency(input))).toBe(first);
    }
  });

  it('🔴 入力配列の並びを変えても同じ結果になる（DB の行順に合否も並びも依存しない）', () => {
    const reversed: ConsistencyInput = {
      subject: {
        snapshot: { skills: [...(input.subject?.snapshot.skills ?? [])].reverse() },
        requirements: [...(input.subject?.requirements ?? [])].reverse(),
        registeredSkills: [...(input.subject?.registeredSkills ?? [])].reverse(),
      },
    };
    expect(JSON.stringify(decideConsistency(reversed))).toBe(JSON.stringify(decideConsistency(input)));
  });

  it('入力を書き換えない（呼び出し側の配列を破壊しない）', () => {
    const skills = [claim(AWS, 2), claim(REACT, 1)];
    const before = JSON.stringify(skills);
    decideConsistency({
      subject: { snapshot: { skills }, requirements: [must(TYPESCRIPT, 1)], registeredSkills: [] },
    });
    expect(JSON.stringify(skills)).toBe(before);
  });
});

describe('🔴 AI 由来の値を受け取れないこと（`BR-61`）', () => {
  it('警告を入力に混ぜる口が型として存在しない', () => {
    const input: ConsistencyInput = {
      // @ts-expect-error 🔴 `aiWarnings` という入口は存在しない（合否は機械的照合だけで決まる）
      aiWarnings: [{ kind: 'MUST_REQUIREMENT_MISMATCH', severity: 'WARN' }],
    };
    // 余分なキーを握り潰して渡しても、合否は「照合するものが無い」= PASS のままである。
    expect(decideConsistency(input).verdict).toBe('PASS');
  });

  it('検査対象の自由文（本文・件名）を渡す口も存在しない', () => {
    const input: ConsistencyInput = {
      // @ts-expect-error 🔴 本文の書きぶりで合否が揺れる経路を作らない
      text: { subject: '件名', body: '本文' },
    };
    expect(decideConsistency(input).verdict).toBe('PASS');
  });
});

describe('🔴 重複提案（②）は Phase 2 の継ぎ目である', () => {
  it('空配列は受け付ける（Phase 1 の呼び出し側はこれしか渡せない）', () => {
    expect(decideConsistency({ duplicateFindings: [] }).verdict).toBe('PASS');
  });

  it('要素を書くとコンパイルエラーになる（`never[]`）', () => {
    const input: ConsistencyInput = {
      // @ts-expect-error 🔴 F-037（SP-15）が型と照合を同時に足すまで、要素は渡せない
      duplicateFindings: [{ proposalId: 'p-1' }],
    };
    expect(input).toBeDefined();
  });

  it('🔴 型を握り潰して渡された場合は黙って無視せず落とす（静かな機能欠損にしない）', () => {
    const smuggled = { duplicateFindings: ['duplicate'] } as unknown as ConsistencyInput;
    expect(() => decideConsistency(smuggled)).toThrow(RangeError);
  });
});

describe('不正な数値は黙って PASS に倒さない', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('years=%p は RangeError', (years) => {
    expect(() =>
      decideConsistency({
        subject: { snapshot: { skills: [claim(REACT, years)] }, requirements: [], registeredSkills: [] },
      }),
    ).toThrow(RangeError);
  });

  it('level が整数でなければ RangeError', () => {
    expect(() =>
      decideConsistency({
        subject: {
          snapshot: { skills: [claim(REACT, 1, { level: 2.5 })] },
          requirements: [],
          registeredSkills: [],
        },
      }),
    ).toThrow(RangeError);
  });

  it('要求年数が不正なら RangeError', () => {
    expect(() =>
      decideConsistency({
        subject: { snapshot: { skills: [] }, requirements: [must(REACT, Number.NaN)], registeredSkills: [] },
      }),
    ).toThrow(RangeError);
  });
});
