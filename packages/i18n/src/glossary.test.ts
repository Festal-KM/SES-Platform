// packages/i18n/src/glossary.test.ts
// 🔴 docs/02 §7.11 の受け入れ基準: 「ゲートで止まった」「送信に失敗した」「見送られた」「提案依頼を断られた」の 4 つが
//    **別の語**で表示される（`BR-23` / `BR-60` / CLAUDE.md §4.2「失敗と保留を混同しない」）。T-10-01。
import { describe, expect, it } from 'vitest';

import { GLOSSARY, OUTCOME_KINDS, OUTCOME_LABELS, PRODUCT_NAME } from './glossary.js';
import { catalog, t } from './index.js';

const JAPANESE_LETTER = /[぀-ゟ゠-ヺ一-鿿]/;

describe('OUTCOME_LABELS — 4 つの「うまくいかなかった」', () => {
  it('🔴 4 語が互いに異なる（同じ語が 2 つ以上の状態に割り当てられていない）', () => {
    const labels = OUTCOME_KINDS.map((kind) => OUTCOME_LABELS[kind]);
    expect(OUTCOME_KINDS).toEqual(['GATE_FAILED', 'SUBMIT_FAILED', 'LOST', 'DECLINED']);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('🔴 どの語も他の語を丸ごと含まない（「失敗」「失効」のような 1 語への畳み込みが起きていない）', () => {
    for (const a of OUTCOME_KINDS) {
      for (const b of OUTCOME_KINDS) {
        if (a === b) continue;
        expect(OUTCOME_LABELS[a].includes(OUTCOME_LABELS[b]), `${a}「${OUTCOME_LABELS[a]}」が ${b}「${OUTCOME_LABELS[b]}」を含む`).toBe(false);
      }
    }
  });

  it('語は空でなく日本語の文字を含む', () => {
    for (const kind of OUTCOME_KINDS) {
      expect(OUTCOME_LABELS[kind].trim().length).toBeGreaterThan(0);
      expect(JAPANESE_LETTER.test(OUTCOME_LABELS[kind])).toBe(true);
    }
  });

  it('`DECLINED`（依頼を辞退）は `Proposal.WITHDRAWN`（辞退）と別の語。ただし語幹「辞退」は共有する（同じ操作の語）', () => {
    expect(OUTCOME_LABELS.DECLINED).not.toBe(GLOSSARY.decline);
    expect(OUTCOME_LABELS.DECLINED).toContain(GLOSSARY.decline);
    expect(OUTCOME_LABELS.LOST).not.toContain(GLOSSARY.decline);
  });

  it('`GATE_FAILED` は「差し戻し」と「検査」の語で組み、「失敗」の語を含まない（障害の語と混ぜない）', () => {
    expect(OUTCOME_LABELS.GATE_FAILED).toContain(GLOSSARY.sendBack);
    expect(OUTCOME_LABELS.GATE_FAILED).toContain(GLOSSARY.inspect);
    expect(OUTCOME_LABELS.GATE_FAILED).not.toContain(GLOSSARY.failure);
  });
});

describe('GLOSSARY — 境界と責任に関わる語', () => {
  it('docs/02 §7.11 の 8 語 + 検査 / 差し戻し / 保留 / 失敗 が定義され、互いに異なる', () => {
    expect(Object.keys(GLOSSARY).sort()).toEqual(
      ['approve', 'decline', 'failure', 'hold', 'inspect', 'lost', 'proposal', 'proposalRequest', 'publish', 'sendBack', 'share', 'submit'].sort(),
    );
    const words = Object.values(GLOSSARY);
    expect(new Set(words).size).toBe(words.length);
    for (const word of words) expect(JAPANESE_LETTER.test(word)).toBe(true);
  });

  it('「提案依頼」は「提案」を語幹に持つ（応諾で提案になるまで提案ではない、という関係が語に現れている）', () => {
    expect(GLOSSARY.proposalRequest.startsWith(GLOSSARY.proposal)).toBe(true);
    expect(GLOSSARY.proposalRequest).not.toBe(GLOSSARY.proposal);
  });

  it('「保留」は「失敗」「見送り」のどちらとも別の語（CLAUDE.md §4.2「失敗と保留を混同しない」）', () => {
    expect(GLOSSARY.hold).not.toBe(GLOSSARY.failure);
    expect(GLOSSARY.hold).not.toBe(GLOSSARY.lost);
  });
});

describe('カタログの状態ラベルが GLOSSARY / OUTCOME_LABELS を参照している', () => {
  it('`Proposal` の 3 状態と `ProposalRequest` の `DECLINED`（S-017 / S-019 の両方）が OUTCOME_LABELS と一致する', () => {
    expect(t('proposals.state.GATE_FAILED')).toBe(OUTCOME_LABELS.GATE_FAILED);
    expect(t('proposals.state.SUBMIT_FAILED')).toBe(OUTCOME_LABELS.SUBMIT_FAILED);
    expect(t('proposals.state.LOST')).toBe(OUTCOME_LABELS.LOST);
    expect(t('proposalRequests.state.DECLINED')).toBe(OUTCOME_LABELS.DECLINED);
    expect(t('proposals.list.requestState.DECLINED')).toBe(OUTCOME_LABELS.DECLINED);
  });

  it('🔴 `Proposal.WITHDRAWN`（辞退）と `ProposalRequest.DECLINED`（依頼を辞退）が別の語で、S-017 と S-019 で同じ語', () => {
    expect(t('proposals.state.WITHDRAWN')).toBe(GLOSSARY.decline);
    expect(t('proposals.state.WITHDRAWN')).not.toBe(t('proposalRequests.state.DECLINED'));
    expect(t('proposalRequests.state.DECLINED')).toBe(t('proposals.list.requestState.DECLINED'));
  });

  it('🔴 `Proposal` の 14 状態ラベルは互いに異なる（`byState` の 14 キーに同じ語が 2 つ無い）', () => {
    const states = [
      'DRAFT',
      'GATE_RUNNING',
      'GATE_FAILED',
      'APPROVAL_PENDING',
      'APPROVED',
      'SUBMITTING',
      'SUBMITTED',
      'SUBMIT_FAILED',
      'INTERVIEW_SCHEDULED',
      'INTERVIEWED',
      'RESULT_PENDING',
      'WON',
      'LOST',
      'WITHDRAWN',
    ] as const;
    const labels = states.map((state) => t(`proposals.state.${state}`));
    expect(new Set(labels).size).toBe(states.length);
  });

  it('🔴 `ProposalRequest` の 5 状態ラベルは互いに異なり、`Proposal` の 14 語のどれとも一致しない（S-019 で並ぶため）', () => {
    const requestStates = ['REQUESTED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN_BY_HOST', 'EXPIRED'] as const;
    const requestLabels = requestStates.map((state) => t(`proposalRequests.state.${state}`));
    expect(new Set(requestLabels).size).toBe(requestStates.length);
    const proposalLabels = new Set(
      Object.entries(catalog())
        .filter(([key]) => key.startsWith('proposals.state.'))
        .map(([, value]) => value),
    );
    for (const label of requestLabels) expect(proposalLabels.has(label), `「${label}」が Proposal の状態ラベルにもある`).toBe(false);
  });

  it('保留（`sendHold.*`）の文言に「見送り」「失敗」の語が無い（保留を失敗・見送りと同じ語で呼ばない）', () => {
    const holdMessages = Object.entries(catalog()).filter(([key]) => key.startsWith('sendHold.'));
    expect(holdMessages.length).toBeGreaterThan(0);
    for (const [key, value] of holdMessages) {
      expect(value.includes(GLOSSARY.lost), `${key} に「${GLOSSARY.lost}」`).toBe(false);
      expect(value.includes(GLOSSARY.failure), `${key} に「${GLOSSARY.failure}」`).toBe(false);
    }
  });
});

describe('PRODUCT_NAME — プロダクト名の 1 キー化', () => {
  it('`product.name` は PRODUCT_NAME そのもの', () => {
    expect(t('product.name')).toBe(PRODUCT_NAME);
  });

  it('プロダクト名を含む文言はすべて PRODUCT_NAME を含む（文字列として別の綴りを持たない）', () => {
    const containing = Object.entries(catalog()).filter(([, value]) => value.includes(PRODUCT_NAME));
    expect(containing.map(([key]) => key).sort()).toEqual(['admin.console.issuer', 'product.name']);
  });
});
