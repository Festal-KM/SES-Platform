// tests/e2e/support/network.ts
// ブラウザ側の外向き通信の遮断（アプリのプロセス側は `harness/network-guard.mjs` が担う）。
//
// 🔴 docs/05 §17.4「実エンドポイントへの発信が 0 件であることを確認する」を**両側**で成立させる。
//    アプリだけを塞いでも、画面が外部の CDN・フォント・解析スクリプトを引きに行けば
//    「非本番環境から外部へ出た」ことに変わりはない。
import { expect, type BrowserContext } from '@playwright/test';
import { E2E_BASE_URL } from '../harness/endpoint';

const ALLOWED_ORIGIN = new URL(E2E_BASE_URL).origin;

export type OutboundWatcher = {
  /** 遮断した外向きリクエストの URL（1 件でもあれば失敗させる）。 */
  readonly blocked: readonly string[];
  readonly assertNone: () => void;
};

export async function guardOutboundRequests(context: BrowserContext): Promise<OutboundWatcher> {
  const blocked: string[] = [];
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(ALLOWED_ORIGIN) || url.startsWith('data:') || url.startsWith('blob:')) {
      await route.continue();
      return;
    }
    blocked.push(url);
    await route.abort('blockedbyclient');
  });
  return {
    get blocked() {
      return blocked;
    },
    assertNone: () => {
      expect(blocked, 'ブラウザから外部エンドポイントへの発信がありました').toEqual([]);
    },
  };
}
