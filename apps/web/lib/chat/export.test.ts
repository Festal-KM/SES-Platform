// apps/web/lib/chat/export.test.ts
// `S-031` の会話の書き出し（`lib/chat/export.ts`）。
import { describe, expect, it } from 'vitest';
import { buildThreadCsv, csvCell } from './export';
import type { ChatMessageView } from './views';

const LABELS = {
  sentAt: '日時',
  sender: '送信者',
  company: '会社',
  body: '本文',
  unknownName: '（表示できません）',
  deleted: 'この発言は削除されました',
  purged: '本文は削除されています',
};

function message(id: string, body: string | null, extra: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id,
    sentAt: '2026-10-16T00:00:00.000Z',
    senderName: '佐藤',
    senderCompanyName: '株式会社サンプル',
    own: false,
    mine: false,
    body,
    ...extra,
  };
}

describe('csvCell', () => {
  it('引用符で囲み、" を重ねる', () => {
    expect(csvCell('a"b')).toBe('"a""b"');
  });

  it('🔴 数式の差し込みを無害にする（= + - @ タブ CR で始まるセル）', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('普通の文')).toBe('"普通の文"');
  });
});

describe('buildThreadCsv', () => {
  it('BOM・見出し・CRLF で、古い順のまま並べる。改行を含む本文はセルの中に残す', () => {
    const csv = buildThreadCsv([message('a', '1 行目\n2 行目'), message('b', 'ok')], LABELS);
    expect(csv.startsWith('\uFEFF"日時","送信者","会社","本文"\r\n')).toBe(true);
    expect(csv).toContain('"1 行目\n2 行目"');
    expect(csv.endsWith('"ok"\r\n')).toBe(true);
  });

  it('本人が削除した発言と保持期限で消えた発言を書き分ける', () => {
    const csv = buildThreadCsv([message('a', null, { deleted: true }), message('b', null)], LABELS);
    expect(csv).toContain(LABELS.deleted);
    expect(csv).toContain(LABELS.purged);
  });
});
