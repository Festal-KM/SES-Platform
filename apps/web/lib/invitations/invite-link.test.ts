// apps/web/lib/invitations/invite-link.test.ts
// 🔴 `F-007 AC-4` / T-04-08 の要（かなめ）。**開示の 4 象限を網羅する。**
//
// ここが緩むと、`production` の応答に平文トークンが載る（= 誰でも受諾できる資格情報が
// API 応答・ブラウザの履歴・プロキシのログに残る。`CLAUDE.md` §3.4）。
import { describe, expect, it } from 'vitest';
import { APP_ENV_KINDS, loadAppEnv } from '@ses/config';
import { buildValidEnv } from '@ses/config/testing';
import {
  buildInvitationIssueView,
  INVITE_URL_NOT_DISCLOSED,
  resolveInviteUrlRuntime,
  type InviteUrlRuntime,
} from './invite-link';

const SANDBOX: InviteUrlRuntime = {
  kind: 'SANDBOX_LINK_HANDOVER',
  appUrl: 'https://sandbox.example.com',
};
const ID = '01930000-0000-7000-8000-0000000000e1';
const TOKEN = 'plain-invite-token-0001';

function view(runtime: InviteUrlRuntime, recipientClass: 'HOST_MEMBER' | 'PARTNER_MEMBER') {
  return buildInvitationIssueView({
    id: ID,
    deliveryState: 'MOCKED',
    recipientClass,
    token: TOKEN,
    resolveInviteUrl: () => runtime,
  });
}

describe('🔴 開示の 4 象限（環境 × 宛先分類）', () => {
  it('sandbox × 分類 2（取引先）だけがリンクを返す', () => {
    const result = view(SANDBOX, 'PARTNER_MEMBER');

    expect(result).toEqual({
      disclosure: 'SANDBOX_INVITE_URL',
      id: ID,
      deliveryState: 'MOCKED',
      inviteUrl: `https://sandbox.example.com/invite/${TOKEN}`,
    });
  });

  it('🔴 sandbox × 分類 1（自社メンバー）は返さない（メールが本人に実送信されるため）', () => {
    const result = view(SANDBOX, 'HOST_MEMBER');

    expect(result.disclosure).toBe('NONE');
    expect(result.inviteUrl).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('🔴 分類 1 では runtime の解決（起動時 DI）を 1 度も呼ばない', () => {
    // 自社メンバーの招待は起動時設定に依存しない（`F-001 AC-5` と同じ構図）。
    // ここが破れると、`APP_ENV` を読めない文脈（結合テスト）で分類 1 の招待まで失敗する。
    let calls = 0;

    const result = buildInvitationIssueView({
      id: ID,
      deliveryState: 'MOCKED',
      recipientClass: 'HOST_MEMBER',
      token: TOKEN,
      resolveInviteUrl: () => {
        calls += 1;
        return SANDBOX;
      },
    });

    expect(calls).toBe(0);
    expect(result.disclosure).toBe('NONE');
  });

  it.each(['PARTNER_MEMBER', 'HOST_MEMBER'] as const)(
    '🔴 production 相当（開示しない runtime）× 分類 %s はフィールドごと存在しない',
    (recipientClass) => {
      const result = view(INVITE_URL_NOT_DISCLOSED, recipientClass);

      expect(result.disclosure).toBe('NONE');
      // 🔴 `undefined` が入っているのではなく、**キーが存在しない**（JSON に出ない）。
      expect(Object.keys(result).sort()).toEqual(['deliveryState', 'disclosure', 'id']);
      expect('inviteUrl' in result).toBe(false);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    },
  );
});

// 🔴 環境ごとの判定は**実際の環境変数スキーマ**（`buildValidEnv` → `loadAppEnv`）を通す。
//    テスト側で `{ APP_ENV: 'sandbox' }` を手で作ると、スキーマが変わっても気づけない。
describe('🔴 resolveInviteUrlRuntime（起動時の 1 箇所。docs/05 §13.1）', () => {
  it('sandbox だけが開示する runtime を返す（appUrl は `APP_URL` から来る）', () => {
    const env = loadAppEnv(buildValidEnv('sandbox'));

    expect(resolveInviteUrlRuntime(env)).toEqual({
      kind: 'SANDBOX_LINK_HANDOVER',
      appUrl: env.APP_URL,
    });
  });

  it.each(APP_ENV_KINDS.filter((kind) => kind !== 'sandbox'))(
    '🔴 %s は開示しない（`production` はもちろん `development` / `demo` も含む）',
    (appEnv) => {
      const runtime = resolveInviteUrlRuntime(loadAppEnv(buildValidEnv(appEnv)));

      expect(runtime).toEqual(INVITE_URL_NOT_DISCLOSED);
      // 🔴 開示しない枝は `appUrl` を持たない = リンクを組み立てる材料がそもそも無い。
      expect('appUrl' in runtime).toBe(false);
    },
  );

  it('🔴 全 5 環境のうち、開示するのはちょうど 1 つである', () => {
    const disclosing = APP_ENV_KINDS.filter(
      (kind) => resolveInviteUrlRuntime(loadAppEnv(buildValidEnv(kind))).kind !== 'NOT_DISCLOSED',
    );

    expect(disclosing).toEqual(['sandbox']);
  });
});

describe('リンクの中身', () => {
  it('🔴 メール本文と同じ受諾経路（`/invite/{token}`）を指す —— 別トークン・別経路を作らない', () => {
    const result = view(SANDBOX, 'PARTNER_MEMBER');

    expect(result.inviteUrl).toBe(`https://sandbox.example.com/invite/${TOKEN}`);
  });

  it('deliveryState はそのまま透過する（保留でもリンクは渡せる）', () => {
    const held = buildInvitationIssueView({
      id: ID,
      deliveryState: 'HELD_DOMAIN_UNVERIFIED',
      recipientClass: 'PARTNER_MEMBER',
      token: TOKEN,
      resolveInviteUrl: () => SANDBOX,
    });

    expect(held.deliveryState).toBe('HELD_DOMAIN_UNVERIFIED');
    expect(held.disclosure).toBe('SANDBOX_INVITE_URL');
  });
});
