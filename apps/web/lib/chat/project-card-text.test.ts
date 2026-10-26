// apps/web/lib/chat/project-card-text.test.ts
// ✅ 2026-10-23（紺野）: 案件カードの語・「条件を引用」の文面・行頭の「/」の判定。
import { describe, expect, it } from 'vitest';
import {
  appendQuote,
  chatProjectConditionsQuote,
  chatProjectHref,
  chatProjectLocationText,
  chatProjectStartText,
  chatRequirementText,
  slashCommandRange,
  type ChatProjectCardLabels,
} from './project-card-text';
import type { ChatVisibleProjectCard } from './views';

const LABELS: ChatProjectCardLabels = {
  statuses: { OPEN: '募集中', CLOSED: '終了' },
  remoteModes: { FULL_REMOTE: 'フルリモート', PARTIAL_REMOTE: '一部リモート', ONSITE_ONLY: '出社のみ' },
  prefectures: { '13': '東京都' },
  none: '—',
  yearsOrMore: '年以上',
  must: '必須',
  nice: '尚可',
};

const CARD: ChatVisibleProjectCard = {
  visible: true,
  id: '01930000-0000-7000-8000-0000000000f1',
  name: '基幹刷新',
  status: 'OPEN',
  startDate: '2026-11-01',
  prefecture: '13',
  remoteMode: 'PARTIAL_REMOTE',
  mustRequirements: [
    { skillName: 'TypeScript', freeText: null, requiredYears: 3 },
    { skillName: null, freeText: 'React での開発', requiredYears: null },
  ],
  niceRequirements: [{ skillName: 'AWS', freeText: null, requiredYears: 1.5 }],
};

describe('カードの語', () => {
  it('要件は 辞書名 → 自由記述 の順。年数があれば「N 年以上」', () => {
    expect(chatRequirementText(CARD.mustRequirements[0]!, LABELS)).toBe('TypeScript 3 年以上');
    expect(chatRequirementText(CARD.mustRequirements[1]!, LABELS)).toBe('React での開発');
    expect(chatRequirementText({ skillName: null, freeText: null, requiredYears: null }, LABELS)).toBe('—');
  });

  it('勤務地 / リモートは「・」でつなぎ、どちらも無ければ —', () => {
    expect(chatProjectLocationText(CARD, LABELS)).toBe('東京都・一部リモート');
    expect(chatProjectLocationText({ ...CARD, prefecture: null }, LABELS)).toBe('一部リモート');
    expect(chatProjectLocationText({ ...CARD, prefecture: null, remoteMode: null }, LABELS)).toBe('—');
  });

  it('開始時期は日付そのまま。無ければ —', () => {
    expect(chatProjectStartText(CARD, LABELS)).toBe('2026-11-01');
    expect(chatProjectStartText({ ...CARD, startDate: null }, LABELS)).toBe('—');
  });

  it('案件詳細の行き先はホストも取引先も同じ', () => {
    expect(chatProjectHref(CARD.id)).toBe(`/projects/${CARD.id}`);
  });
});

describe('「条件を引用」', () => {
  it('必須・尚可を Markdown の引用で返す（🔴 案件名を入れない）', () => {
    const quote = chatProjectConditionsQuote(CARD, LABELS);
    expect(quote).toBe('> 必須: TypeScript 3 年以上、React での開発\n> 尚可: AWS 1.5 年以上');
    expect(quote).not.toContain(CARD.name);
  });

  it('要件が無い区分の行は出さない。どちらも無ければ空文字', () => {
    expect(chatProjectConditionsQuote({ ...CARD, niceRequirements: [] }, LABELS)).toBe('> 必須: TypeScript 3 年以上、React での開発');
    expect(chatProjectConditionsQuote({ ...CARD, mustRequirements: [], niceRequirements: [] }, LABELS)).toBe('');
  });

  it('入力欄の末尾に足す（空なら引用だけ。続けて書けるよう空行を置く）', () => {
    expect(appendQuote('', '> 必須: X')).toBe('> 必須: X\n\n');
    expect(appendQuote('ご確認ください  ', '> 必須: X')).toBe('ご確認ください\n\n> 必須: X\n\n');
    expect(appendQuote('そのまま', '')).toBe('そのまま');
  });
});

describe('行頭の「/」', () => {
  it('行頭で「/」を打ったらメニューを出す（取り除く範囲を返す）', () => {
    expect(slashCommandRange('/', 1)).toEqual({ start: 0, end: 1 });
    expect(slashCommandRange('こんにちは\n/案', 8)).toEqual({ start: 6, end: 8 });
  });

  it('行の途中の「/」・空白を含む・「//」では出さない', () => {
    expect(slashCommandRange('a/b', 3)).toBeNull();
    expect(slashCommandRange('/ 案件', 4)).toBeNull();
    expect(slashCommandRange('//', 2)).toBeNull();
    expect(slashCommandRange('', 0)).toBeNull();
  });
});
