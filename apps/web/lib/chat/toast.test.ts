import { describe, expect, it } from 'vitest';
import { parseChatToast } from './toast';

describe('parseChatToast（保存したトーストを検める）', () => {
  it('形が合えば読む', () => {
    expect(parseChatToast(JSON.stringify({ message: 'm', href: '/chat?thread=x', linkLabel: 'l' }))).toEqual({
      message: 'm',
      href: '/chat?thread=x',
      linkLabel: 'l',
    });
  });
  it('🔴 行き先がチャットの外（別のサイトなど）なら出さない', () => {
    expect(parseChatToast(JSON.stringify({ message: 'm', href: 'https://evil.example', linkLabel: 'l' }))).toBeNull();
    expect(parseChatToast(JSON.stringify({ message: 'm', href: '/admin', linkLabel: 'l' }))).toBeNull();
  });
  it('壊れた値・足りない値は出さない', () => {
    expect(parseChatToast(null)).toBeNull();
    expect(parseChatToast('{')).toBeNull();
    expect(parseChatToast(JSON.stringify({ message: 'm' }))).toBeNull();
  });
});
