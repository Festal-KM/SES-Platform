// tests/static/chat-attachment-visibility.test.ts
// ✅ 2026-10-27（Codex レビュー）: 🔴 検査が CLEAN でない他人の添付の発言を「数える・冒頭を出す」問い合わせは、
//    `where` に `chatMessageVisibleWhere(ctx.userId)` を持つ（後から落とすのではなく数える前に除く）。
//    本体は RLS の RESTRICTIVE ポリシーであり、RLS を外した状態は分離テストで作れないため、ここで形を固定する。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatMessageVisibleWhere, isChatMessageVisibleToViewer } from '../../apps/web/lib/chat/views.js';
import { repoRoot } from './support/ui-classes.js';

const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

describe('🔴 検査中の添付の発言を数える・冒頭を出す問い合わせに、見える条件が付いている', () => {
  it.each([
    ['apps/web/lib/chat/read.ts', 2],
    ['apps/web/lib/chat/people.ts', 1],
    ['apps/web/lib/chat/read-state.ts', 1],
  ] as const)('%s に chatMessageVisibleWhere(ctx.userId) が %i 回以上ある', (file, count) => {
    const occurrences = read(file).split('chatMessageVisibleWhere(ctx.userId)').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(count);
  });

  it('未読の数（groupBy）の where に付いている', () => {
    expect(read('apps/web/lib/chat/read-state.ts')).toMatch(/groupBy\(\{[\s\S]{0,200}chatMessageVisibleWhere\(ctx\.userId\)/);
  });

  it('条件は写しの段の判定（isChatMessageVisibleToViewer）と同じ 3 つ（添付なし / CLEAN / 送った本人）', () => {
    expect(chatMessageVisibleWhere('u1')).toEqual({ OR: [{ attachmentKey: null }, { attachmentScanStatus: 'CLEAN' }, { senderUserId: 'u1' }] });
    const row = { senderUserId: 'u2', attachmentContentType: 'application/pdf', attachmentScanStatus: 'SCANNING' };
    expect(isChatMessageVisibleToViewer(row, 'u1')).toBe(false);
    expect(isChatMessageVisibleToViewer({ ...row, attachmentScanStatus: 'CLEAN' }, 'u1')).toBe(true);
    expect(isChatMessageVisibleToViewer(row, 'u2')).toBe(true);
  });
});
