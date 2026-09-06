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

/**
 * @param extraAllowedOrigins 🔴 T-05-10（K-7）: ダウンロードの署名付き URL（MinIO。development の
 *   `objectStore` は `real`）へブラウザが実際にナビゲートする経路だけに使う、限定的な追加許可。
 *   「何でも許可する」抜け道にしないため、**呼び出し側が明示的に渡した文字列だけ**を足す
 *   （既定は空配列 = 従来どおりアプリのオリジンしか許可しない）。
 */
export async function guardOutboundRequests(
  context: BrowserContext,
  extraAllowedOrigins: readonly string[] = [],
): Promise<OutboundWatcher> {
  const allowedOrigins = [ALLOWED_ORIGIN, ...extraAllowedOrigins];
  const blocked: string[] = [];
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (
      allowedOrigins.some((origin) => url.startsWith(origin)) ||
      url.startsWith('data:') ||
      url.startsWith('blob:')
    ) {
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
