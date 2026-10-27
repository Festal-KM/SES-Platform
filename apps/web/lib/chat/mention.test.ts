// ✅ 2026-10-27（F-038 ⑭ / AC-16）: 自分宛ての `@` の判定（`mention.ts`）。サーバの印と会話の線が同じ関数を使う。
import { describe, expect, it } from 'vitest';
import { insertChatMention } from './markdown';
import { chatMentionNeedle, mentionsName } from './mention';
import { buildQuotedBody } from './quote';

const ID = '01930000-0000-7000-8000-0000000000aa';

describe('自分宛ての @', () => {
  it('入力欄の「@」が入れる形をそのまま見つける', () => {
    const body = insertChatMention('よろしく', 4, 4, '見本 太郎').text;
    expect(mentionsName(body, '見本 太郎')).toBe(true);
  });

  it('大文字・小文字を区別する / @ の無い名前は当てない', () => {
    expect(mentionsName('@host a 確認ください', 'Host A')).toBe(false);
    expect(mentionsName('Host A さん確認ください', 'Host A')).toBe(false);
    expect(mentionsName('@Host A 確認ください', 'Host A')).toBe(true);
  });

  it('名前が空・本文が無いときは何にも当てない', () => {
    expect(chatMentionNeedle('  ')).toBeNull();
    expect(mentionsName('@ だけ', '')).toBe(false);
    expect(mentionsName(null, 'Host A')).toBe(false);
  });

  it('🔴 引用の写しにある @ は数えない（引用しただけで印を付けない）', () => {
    const body = buildQuotedBody({ messageId: ID, name: 'B', snippet: '@Host A 確認ください' }, '了解です');
    expect(mentionsName(body, 'Host A')).toBe(false);
    expect(mentionsName(buildQuotedBody({ messageId: ID, name: 'B', snippet: 'x' }, '@Host A 了解です'), 'Host A')).toBe(true);
  });
});
