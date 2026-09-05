// tests/e2e/support/api.ts
// 「**API 直叩き**」（`CLAUDE.md` §5 Phase 0 / `F-004 AC-9`）の実行手段。
//
// 🔴 ブラウザのページ内から同一オリジンの `fetch` を撃つ。理由:
//    セッション Cookie は `__Host-` 接頭辞 + `Secure` + `HttpOnly` であり、
//    「ブラウザが実際に保持している Cookie が、そのまま API に効くか」を確かめたい。
//    Playwright の `APIRequestContext` に付け替えると、Cookie の適用規則が
//    ブラウザと同一である保証が無くなり、**通ってはいけない経路が通る / 逆に通らない**
//    という取り違えが起きる。
// 🔴 画面を経由しない（UI で隠しているだけではないことの証明。`F-060 AC-3` と同じ思想）。
import type { Page } from '@playwright/test';

export type ApiResponse = {
  readonly status: number;
  readonly text: string;
};

export type ApiRequestInit = {
  readonly method?: string;
  readonly body?: unknown;
};

export async function apiRequest(
  page: Page,
  path: string,
  init: ApiRequestInit = {},
): Promise<ApiResponse> {
  return page.evaluate(
    async ({ path: target, method, body }) => {
      const response = await fetch(target, {
        method: method ?? 'GET',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, text: await response.text() };
    },
    { path, method: init.method, body: init.body },
  );
}

export function parseJson(response: ApiResponse): unknown {
  try {
    return JSON.parse(response.text);
  } catch {
    throw new Error(`JSON として解釈できません (status=${response.status}): ${response.text.slice(0, 300)}`);
  }
}

/** `GET /api/audit-logs` は期間が必須（docs/05 §6.3 #10）。十分広い窓を作る。 */
export function auditLogPeriodQuery(): string {
  const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}
