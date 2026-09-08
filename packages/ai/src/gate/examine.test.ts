// packages/ai/src/gate/examine.test.ts
// 🔴 T-07-06: マスキング → 検査、機械的検出、オフセットの復元（docs/05 §11.2 / §11.4 / §11.7）。
import { describe, expect, it } from 'vitest';
import type { GateInput, ProposalGateInput, ProjectPublishGateInput } from '@ses/domain';
import {
  EmptyGateContentError,
  interpretGateInspection,
  prepareGateExamination,
  toRawOffset,
} from './examine.js';
import type { GateInspectorOutput } from '../roles/gate-inspector.js';

const HASH = 'b'.repeat(64);

function proposalInput(overrides: Partial<ProposalGateInput> = {}): ProposalGateInput {
  return {
    targetType: 'PROPOSAL',
    targetId: '01930000-0000-7000-8000-000000000001',
    contentHash: HASH,
    audience: { kind: 'EXTERNAL_CLIENT', partnerCompanyIds: [] },
    sections: [
      { field: 'subject', text: 'ご提案' },
      { field: 'body', text: 'Java の経験が 8 年あります。' },
    ],
    forbiddenTerms: { unitPrices: [], endClientNames: [], otherCompanyNames: [] },
    knownPii: { fullNames: [], birthDates: [], emails: [], phones: [], affiliations: [] },
    consistency: { subject: { snapshot: { skills: [] }, requirements: [], registeredSkills: [] } },
    ...overrides,
  };
}

function projectInput(overrides: Partial<ProjectPublishGateInput> = {}): ProjectPublishGateInput {
  return {
    targetType: 'PROJECT_PUBLISH',
    targetId: '01930000-0000-7000-8000-000000000002',
    contentHash: HASH,
    audience: { kind: 'PARTNER', partnerCompanyIds: [] },
    sections: [{ field: 'public_summary', text: '基幹システムの刷新案件です。' }],
    forbiddenTerms: { unitPrices: [], endClientNames: [], otherCompanyNames: [] },
    knownPii: { fullNames: [], birthDates: [], emails: [], phones: [], affiliations: [] },
    consistency: {},
    ...overrides,
  };
}

describe('prepareGateExamination（docs/05 §11.2 BUILD）', () => {
  it('🔴 LLM に渡す本文はマスキング済みである（BR-11 / BR-12）', () => {
    const prepared = prepareGateExamination(
      proposalInput({
        sections: [
          { field: 'subject', text: '山田 太郎さんのご提案' },
          { field: 'body', text: '連絡先 taro@example.com。単価は 650000 円です。' },
        ],
        knownPii: {
          fullNames: ['山田 太郎'],
          birthDates: [],
          emails: ['taro@example.com'],
          phones: [],
          affiliations: [],
        },
        forbiddenTerms: { unitPrices: ['650000'], endClientNames: [], otherCompanyNames: [] },
      }),
    );
    const texts = prepared.inspectorInput.sections.map((section) => section.text);
    expect(texts.join('\n')).not.toContain('山田 太郎');
    expect(texts.join('\n')).not.toContain('taro@example.com');
    expect(texts.join('\n')).not.toContain('650000');
    expect(texts[0]).toContain('[名前]');
  });

  it('空の欄は検査対象から落ちる（LLM に空文字を渡さない）', () => {
    const prepared = prepareGateExamination(
      proposalInput({
        sections: [
          { field: 'subject', text: '   ' },
          { field: 'body', text: '本文あり' },
        ],
      }),
    );
    expect(prepared.inspectorInput.sections.map((section) => section.field)).toEqual(['body']);
  });

  it('🔴 検査できる本文が 1 欄も無ければ PASS に倒さず落とす（F-020 AC-1）', () => {
    expect(() =>
      prepareGateExamination(
        proposalInput({
          sections: [
            { field: 'subject', text: '' },
            { field: 'body', text: '  ' },
          ],
        }),
      ),
    ).toThrowError(EmptyGateContentError);
  });

  it('audienceKind をそのまま渡す（商流層の判定基準が変わる）', () => {
    expect(prepareGateExamination(proposalInput()).inspectorInput.audienceKind).toBe(
      'EXTERNAL_CLIENT',
    );
    expect(prepareGateExamination(projectInput()).inspectorInput.audienceKind).toBe('PARTNER');
  });

  it('maskHits が欄をまたいで合算される（AiUsage へ運ぶ要約。docs/05 §7.11 ③）', () => {
    const prepared = prepareGateExamination(
      proposalInput({
        sections: [
          { field: 'subject', text: '山田 太郎の件' },
          { field: 'body', text: '山田 太郎をご紹介します。' },
        ],
        knownPii: {
          fullNames: ['山田 太郎'],
          birthDates: [],
          emails: [],
          phones: [],
          affiliations: [],
        },
      }),
    );
    const name = prepared.maskHits.find((hit) => hit.category === 'NAME');
    expect(name).toMatchObject({ method: 'KNOWN_VALUE', count: 2 });
  });

  describe('🔴 機械的検出（docs/05 §11.4。AI の見落としに対する保険）', () => {
    it('既知の氏名が本文に残っていれば PII 層の BLOCK になる（F-020 AC-5）', () => {
      const prepared = prepareGateExamination(
        proposalInput({
          sections: [{ field: 'body', text: '担当は山田太郎です。' }],
          knownPii: {
            fullNames: ['山田 太郎'],
            birthDates: [],
            emails: [],
            phones: [],
            affiliations: [],
          },
        }),
      );
      expect(prepared.mechanicalPii).toHaveLength(1);
      expect(prepared.mechanicalPii[0]).toMatchObject({
        layer: 'PII',
        kind: 'FULL_NAME',
        field: 'body',
        severity: 'BLOCK',
        excerpt: '[名前]',
      });
      // 🔴 抜粋に原文が入らない（ReviewGate.findings が PII の再出現経路にならない）。
      expect(prepared.mechanicalPii[0]?.excerpt).not.toContain('山田');
      expect(prepared.mechanicalCommerce).toEqual([]);
    });

    it('公開範囲外のエンド企業名は商流層の BLOCK になる（F-020 AC-6 / F-014 AC-3）', () => {
      const prepared = prepareGateExamination(
        projectInput({
          sections: [{ field: 'public_summary', text: 'エンド商事の基幹刷新です。' }],
          forbiddenTerms: {
            unitPrices: [],
            endClientNames: ['エンド商事'],
            otherCompanyNames: [],
          },
        }),
      );
      expect(prepared.mechanicalCommerce).toHaveLength(1);
      expect(prepared.mechanicalCommerce[0]).toMatchObject({
        layer: 'COMMERCE',
        kind: 'END_CLIENT',
        field: 'public_summary',
        severity: 'BLOCK',
      });
    });

    it('内部単価が本文に残れば商流層の BLOCK になる', () => {
      const prepared = prepareGateExamination(
        projectInput({
          sections: [{ field: 'public_summary', text: '想定 750000 円 / 月です。' }],
          forbiddenTerms: { unitPrices: ['750000'], endClientNames: [], otherCompanyNames: [] },
        }),
      );
      expect(prepared.mechanicalCommerce.map((row) => row.kind)).toContain('UNIT_PRICE');
    });

    it('🔴 他社名は OTHER_COMPANY として区別される（CLAUDE.md §3.1 の他社露出）', () => {
      const prepared = prepareGateExamination(
        projectInput({
          sections: [{ field: 'public_summary', text: '株式会社アルファも参画予定です。' }],
          forbiddenTerms: {
            unitPrices: [],
            endClientNames: [],
            otherCompanyNames: ['株式会社アルファ'],
          },
        }),
      );
      expect(prepared.mechanicalCommerce).toHaveLength(1);
      expect(prepared.mechanicalCommerce[0]?.kind).toBe('OTHER_COMPANY');
    });

    it('🔴 パターン検出（署名のメール等）は FAIL にしない（直せない FAIL を作らない）', () => {
      const prepared = prepareGateExamination(
        proposalInput({
          sections: [{ field: 'body', text: 'ご不明点は sales@host.example.com までご連絡ください。' }],
        }),
      );
      expect(prepared.mechanicalPii).toEqual([]);
      // 対照: LLM に送る本文では伏せられている（マスキングは補助検出も行う）。
      expect(prepared.inspectorInput.sections[0]?.text).toContain('[メール]');
    });

    it('指摘は欄の順・位置の順に決定的に並ぶ', () => {
      const prepared = prepareGateExamination(
        proposalInput({
          sections: [
            { field: 'subject', text: '山田 太郎の件' },
            { field: 'body', text: 'まず山田 太郎、次に佐藤 花子。' },
          ],
          knownPii: {
            fullNames: ['佐藤 花子', '山田 太郎'],
            birthDates: [],
            emails: [],
            phones: [],
            affiliations: [],
          },
        }),
      );
      expect(
        prepared.mechanicalPii.map((row) => `${row.field}:${String(row.offsetStart)}`),
      ).toEqual(['subject:0', 'body:2', 'body:10']);
    });
  });
});

describe('オフセットの復元（docs/05 §11.7）', () => {
  it('伏せ字の外側の位置は差分だけずれる', () => {
    const prepared = prepareGateExamination(
      proposalInput({
        sections: [{ field: 'body', text: '担当は山田 太郎です。連絡はメールで。' }],
        knownPii: {
          fullNames: ['山田 太郎'],
          birthDates: [],
          emails: [],
          phones: [],
          affiliations: [],
        },
      }),
    );
    const map = prepared.offsetMaps.get('body');
    expect(map).toBeDefined();
    if (map === undefined) return;
    // 原文: 「担当は」= 0..3 / 「山田 太郎」= 3..8 / 以降 8..
    // マスク後: 「担当は」= 0..3 / 「[名前]」= 3..8（5 文字）/ 以降 8..
    expect(toRawOffset(map, 0, 'start')).toBe(0);
    expect(toRawOffset(map, 3, 'start')).toBe(3);
    // 伏せ字の内側を指す位置は原文の区間の端に丸める。
    expect(toRawOffset(map, 4, 'start')).toBe(3);
    expect(toRawOffset(map, 6, 'end')).toBe(8);
  });

  it('🔴 AI が返した位置が原文の位置に戻る（画面のハイライトがずれない）', () => {
    const prepared = prepareGateExamination(
      proposalInput({
        // 「[メール]」は 5 文字、原文のアドレスは 17 文字。マスク後は 12 文字短くなる。
        sections: [{ field: 'body', text: 'a@b.example.co.jp の件で、田中部長にご相談ください。' }],
      }),
    );
    const maskedText = prepared.inspectorInput.sections[0]?.text ?? '';
    const start = maskedText.indexOf('田中部長');
    const output: GateInspectorOutput = {
      pii: {
        verdict: 'FAIL',
        findings: [
          {
            kind: 'FULL_NAME',
            field: 'body',
            offsetStart: start,
            offsetEnd: start + 4,
            excerpt: '田中部長',
            severity: 'BLOCK',
          },
        ],
      },
      commerce: { verdict: 'PASS', findings: [] },
      consistencyWarnings: [],
    };
    const interpreted = interpretGateInspection(prepared, output);
    const finding = interpreted.pii.findings[0];
    expect(finding?.layer).toBe('PII');
    const raw = 'a@b.example.co.jp の件で、田中部長にご相談ください。';
    expect(raw.slice(finding?.offsetStart ?? 0, finding?.offsetEnd ?? 0)).toBe('田中部長');
  });

  it('位置が特定できない指摘は null のまま渡る（-1 や空文字を使わない）', () => {
    const prepared = prepareGateExamination(proposalInput());
    const output: GateInspectorOutput = {
      pii: { verdict: 'PASS', findings: [] },
      commerce: { verdict: 'PASS', findings: [] },
      consistencyWarnings: [
        {
          kind: 'SKILL_SHEET_MISMATCH',
          field: 'snapshot',
          offsetStart: null,
          offsetEnd: null,
          excerpt: '経験年数の合計が経歴と一致しません',
          severity: 'WARN',
        },
      ],
    };
    const interpreted = interpretGateInspection(prepared, output);
    expect(interpreted.warnings[0]).toMatchObject({
      layer: 'CONSISTENCY',
      offsetStart: null,
      offsetEnd: null,
      severity: 'WARN',
    });
  });

  it('🔴 layer は AI に決めさせず、どちらの配列に入ったかで決まる（docs/05 §7.13 ④）', () => {
    const prepared = prepareGateExamination(proposalInput());
    const output: GateInspectorOutput = {
      pii: {
        verdict: 'FAIL',
        findings: [
          { kind: 'FULL_NAME', field: 'body', offsetStart: null, offsetEnd: null, excerpt: 'x', severity: 'BLOCK' },
        ],
      },
      commerce: {
        verdict: 'FAIL',
        findings: [
          { kind: 'END_CLIENT', field: 'body', offsetStart: null, offsetEnd: null, excerpt: 'y', severity: 'BLOCK' },
        ],
      },
      consistencyWarnings: [],
    };
    const interpreted = interpretGateInspection(prepared, output);
    expect(interpreted.pii.findings[0]?.layer).toBe('PII');
    expect(interpreted.commerce.findings[0]?.layer).toBe('COMMERCE');
  });
});

describe('型（対象種別ごとに渡せるものが違う）', () => {
  it('GateInput の合併がそのまま扱える', () => {
    const inputs: GateInput[] = [proposalInput(), projectInput()];
    expect(inputs.map((row) => row.targetType)).toEqual(['PROPOSAL', 'PROJECT_PUBLISH']);
  });
});
