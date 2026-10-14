// apps/web/lib/chat/panes.test.ts
// `S-031` の会話を右に並べて開く（`lib/chat/panes.ts`）。
import { describe, expect, it } from 'vitest';
import {
  canAddPane,
  openThreadIds,
  threadIdFromDroppedUrl,
  withPaneAdded,
  withPaneClosed,
  withThreadSelected,
} from './panes';

const A = '01930000-0000-7000-8000-0000000000a1';
const B = '01930000-0000-7000-8000-0000000000b1';
const C = '01930000-0000-7000-8000-0000000000c1';
const D = '01930000-0000-7000-8000-0000000000d1';
const ORIGIN = 'https://app.test';

describe('withPaneAdded', () => {
  it('何も開いていなければ左端に開く', () => {
    expect(withPaneAdded({ thread: null, panes: [] }, A)).toEqual({ thread: A, panes: [] });
  });

  it('右端に足す（左から A → B → C）', () => {
    const one = withPaneAdded({ thread: A, panes: [] }, B);
    expect(one).toEqual({ thread: A, panes: [B] });
    expect(withPaneAdded(one, C)).toEqual({ thread: A, panes: [B, C] });
  });

  it('🔴 同じ会話を 2 列に出さない（左端・右のどちらに開いていても足さない）', () => {
    expect(withPaneAdded({ thread: A, panes: [B] }, A)).toEqual({ thread: A, panes: [B] });
    expect(withPaneAdded({ thread: A, panes: [B] }, B)).toEqual({ thread: A, panes: [B] });
  });

  it('🔴 上限（3 列）に達していれば並びを変えない', () => {
    const full = { thread: A, panes: [B, C] };
    expect(canAddPane(full)).toBe(false);
    expect(withPaneAdded(full, D)).toEqual(full);
  });
});

describe('withPaneClosed', () => {
  it('右の列を閉じる', () => {
    expect(withPaneClosed({ thread: A, panes: [B, C] }, B)).toEqual({ thread: A, panes: [C] });
  });

  it('🔴 左端を閉じると次の列が繰り上がる（右の会話を巻き添えで閉じない）', () => {
    expect(withPaneClosed({ thread: A, panes: [B, C] }, A)).toEqual({ thread: B, panes: [C] });
  });

  it('最後の 1 列を閉じると何も開いていない状態に戻る', () => {
    expect(withPaneClosed({ thread: A, panes: [] }, A)).toEqual({ thread: null, panes: [] });
  });
});

describe('withThreadSelected', () => {
  it('左端を差し替え、右の並びは残す', () => {
    expect(withThreadSelected({ thread: A, panes: [B] }, C)).toEqual({ thread: C, panes: [B] });
  });

  it('🔴 右に開いている会話を選んだら、その列を左端へ移す（2 列に出さない）', () => {
    expect(withThreadSelected({ thread: A, panes: [B, C] }, B)).toEqual({ thread: B, panes: [C] });
    expect(openThreadIds(withThreadSelected({ thread: A, panes: [B] }, B))).toEqual([B]);
  });
});

describe('threadIdFromDroppedUrl（一覧の行をドラッグしたときの URL）', () => {
  it('同じ画面の `?thread=<UUID>` を受ける（相対・絶対のどちらでも）', () => {
    expect(threadIdFromDroppedUrl(`${ORIGIN}/chat?thread=${A}`, ORIGIN)).toBe(A);
    expect(threadIdFromDroppedUrl(`/chat?thread=${A}&pane=${B}`, ORIGIN)).toBe(A);
  });

  it('`text/uri-list` のコメント行と空行を読み飛ばす', () => {
    expect(threadIdFromDroppedUrl(`# comment\r\n\r\n${ORIGIN}/chat?thread=${A}`, ORIGIN)).toBe(A);
  });

  it('🔴 他のオリジン・他の画面・形の違う ID・壊れた URL は受けない', () => {
    expect(threadIdFromDroppedUrl(`https://evil.test/chat?thread=${A}`, ORIGIN)).toBeNull();
    expect(threadIdFromDroppedUrl(`${ORIGIN}/projects?thread=${A}`, ORIGIN)).toBeNull();
    expect(threadIdFromDroppedUrl(`${ORIGIN}/chat?thread=not-a-uuid`, ORIGIN)).toBeNull();
    expect(threadIdFromDroppedUrl(`${ORIGIN}/chat`, ORIGIN)).toBeNull();
    expect(threadIdFromDroppedUrl('http://[', ORIGIN)).toBeNull();
    expect(threadIdFromDroppedUrl('', ORIGIN)).toBeNull();
  });
});
