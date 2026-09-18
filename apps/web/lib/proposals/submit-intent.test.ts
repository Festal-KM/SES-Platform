// apps/web/lib/proposals/submit-intent.test.ts
// `S-022` → `S-021` の「送信を受け付けた」印（`markSubmitRequested` / `consumeSubmitRequested`）を固定する。T-12-13 ⑤（レビュー指摘の修正）。
//
// 🔴 ここで固定するもの:
//   ① mark → consume は `true`、2 回目は `false`（印は 1 回だけ消費される。再マウント・再訪で枠が復活しない）
//   ② 別の提案 ID の consume は `false` で、元の印を消費しない
//   ③ storage が throw しても例外を漏らさない（読み書きで throw / **取得そのもの**で throw = storage を無効化したブラウザ、の両方）
import { describe, expect, it } from 'vitest';
import { consumeSubmitRequested, markSubmitRequested, SUBMIT_INTENT_MARK, submitIntentKey, type SubmitIntentStorage } from './submit-intent';

const A = '01930000-0000-7000-8000-000000000a01';
const B = '01930000-0000-7000-8000-000000000a02';

function memoryStorage(): SubmitIntentStorage & { readonly size: () => number } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    size: () => map.size,
  };
}

function throwingStorage(): SubmitIntentStorage {
  const fail = (): never => {
    throw new Error('QuotaExceededError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

describe('submit-intent: S-022 が置き S-021 が 1 回だけ消費する印', () => {
  it('① mark → consume は true、2 回目は false（印は消費で消える）', () => {
    const storage = memoryStorage();
    const source = () => storage;
    expect(consumeSubmitRequested(source, A)).toBe(false);
    markSubmitRequested(source, A);
    expect(storage.size()).toBe(1);
    // E2E が同じキー・同じ値で読む（`submitIntentKey` / `SUBMIT_INTENT_MARK` が唯一の出所）。
    expect(storage.getItem(submitIntentKey(A))).toBe(SUBMIT_INTENT_MARK);
    expect(consumeSubmitRequested(source, A)).toBe(true);
    expect(storage.size()).toBe(0);
    expect(consumeSubmitRequested(source, A)).toBe(false);
  });

  it('② 別の提案 ID の consume は false で、元の印を消費しない', () => {
    const storage = memoryStorage();
    const source = () => storage;
    markSubmitRequested(source, A);
    expect(consumeSubmitRequested(source, B)).toBe(false);
    expect(storage.size()).toBe(1);
    expect(consumeSubmitRequested(source, A)).toBe(true);
    expect(storage.size()).toBe(0);
  });

  it('③ storage の読み書きが throw しても例外を漏らさない（mark は諦め、consume は false）', () => {
    const source = () => throwingStorage();
    expect(() => markSubmitRequested(source, A)).not.toThrow();
    expect(consumeSubmitRequested(source, A)).toBe(false);
  });

  it('③ storage の取得そのものが throw しても例外を漏らさない（`window.sessionStorage` のプロパティアクセスが SecurityError になる環境）', () => {
    const source = (): SubmitIntentStorage => {
      throw new Error('SecurityError: The operation is insecure.');
    };
    expect(() => markSubmitRequested(source, A)).not.toThrow();
    expect(consumeSubmitRequested(source, A)).toBe(false);
  });

  it('印の値が想定外（他のコードが同じキーに別の値を書いた）なら consume は false で触らない', () => {
    const storage = memoryStorage();
    storage.setItem(submitIntentKey(A), 'yes');
    expect(consumeSubmitRequested(() => storage, A)).toBe(false);
    expect(storage.size()).toBe(1);
  });
});
