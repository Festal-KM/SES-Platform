// apps/web/lib/settings/sending-domain-fact.ts
// 🔴 送信画面が常時示す「事実」の算出（`送信元ドメイン: @example.co.jp（検証済み）`。
//    `docs/03` `ui-design` 申し送り 2 / `docs/04` §S-036）。T-04-06。
//
// 🔴 今回この事実を表示するのは S-036 のみである。後続の送信画面（`S-021` / `S-024` /
//    `S-026` / `S-014`。SP-09 以降）が同じ導出を再利用できるよう、S-036 の外（この lib と
//    `apps/web/app/(main)/_shared/sending-domain-status.tsx`）に独立して置く。**今回は
//    S-036 / S-003 / S-035 内で使うところまで**（SP-04 T-04-06 のスコープ）。
//
// 🔴 純粋関数のみ（DB / fetch を持たない）。`GET /api/settings/sending-domains`（#71）の
//    応答（`SendingDomainListView`）を渡すだけで使えるようにし、サーバ・クライアント両方の
//    コンポーネントから呼べるようにする。
import type { TenantSendingDomainState } from '@ses/db';
import type { MessageKey } from '@ses/i18n';
// 🔴 P0 修正（Iteration 3）: `SENDING_DOMAIN_NOT_REQUIRED` は依存フリーな
//    `./sending-domain-constants` から**値として**読む。`./sending-domains` は
//    `@ses/db` に依存するサーバ専用モジュールであり、そこから 1 つでも値を import すると
//    本ファイル（クライアントコンポーネントから import される）ごとクライアントバンドルに
//    含まれてしまう（`tests/static/client-db-boundary.test.ts` が固定する）。
import { SENDING_DOMAIN_NOT_REQUIRED } from './sending-domain-constants';
// 🔴 ここは**型のみ**（`import type`）にする。値を 1 つでも混ぜると上記の事故が再発する。
import type { SendingDomainListView, SendingDomainResponseState } from './sending-domains';

/**
 * 状態 → 文言キー（`settings.sendingDomain.state.*`。docs/05 §6.3 #71 の 4 値 + `NOT_REQUIRED`）。
 * 🔴 `apps/web/app/admin/tenants/_lib/labels.ts` の `SENDING_DOMAIN_STATE_MESSAGE_KEYS` とは
 *    別物である（あちらは運営者向けの `admin.provisioning.sendingDomain.*`。管理平面のファイルを
 *    主平面から import させないため、値は同じでもキーの出所は分ける）。
 */
export const SENDING_DOMAIN_STATE_MESSAGE_KEYS: Readonly<
  Record<SendingDomainResponseState, MessageKey>
> = {
  REGISTERED: 'settings.sendingDomain.state.REGISTERED',
  PENDING: 'settings.sendingDomain.state.PENDING',
  VERIFIED: 'settings.sendingDomain.state.VERIFIED',
  FAILED: 'settings.sendingDomain.state.FAILED',
  [SENDING_DOMAIN_NOT_REQUIRED]: 'settings.sendingDomain.state.NOT_REQUIRED',
};

/**
 * 送信画面の「事実」。
 *
 * 🔴 `NOT_REQUIRED`（sandbox / demo / development）はドメインを持たない —— 共通ドメインで
 *    動作するため、個々のテナントのドメイン名を事実として示す意味が無い。
 * 🔴 `UNSET` はドメインを 1 件も登録していない（`view.domains` が空）。
 * 🔴 検証済みの行が複数あることは無い（`tenant_sending_domains` の部分 `UNIQUE (tenant_id)
 *    WHERE state = 'VERIFIED'`）。未検証は登録順で先頭の 1 件を代表として示す。
 */
export type SendingDomainFact =
  | { readonly kind: 'NOT_REQUIRED' }
  | { readonly kind: 'UNSET' }
  | { readonly kind: 'SET'; readonly domain: string; readonly state: TenantSendingDomainState };

/**
 * 🔴 `S-035` / `S-003` の帯（`SendingDomainGuardBanner`）を出すべきか（`docs/04` §S-036 1298 行）。
 *    `NOT_REQUIRED`（sandbox / demo / development）と `VERIFIED` では出さない —— どちらも
 *    「取引先へ送信できる状態」であるため。
 */
export function isSendingDomainUnverified(fact: SendingDomainFact): boolean {
  return fact.kind === 'UNSET' || (fact.kind === 'SET' && fact.state !== 'VERIFIED');
}

export function resolveSendingDomainFact(view: SendingDomainListView): SendingDomainFact {
  if (!view.required) return { kind: 'NOT_REQUIRED' };

  const verified = view.domains.find((domain) => domain.state === 'VERIFIED');
  const representative = verified ?? view.domains[0];
  if (representative === undefined) return { kind: 'UNSET' };

  return {
    kind: 'SET',
    domain: representative.domain,
    // 🔴 `SendingDomainView.state` の型は `SendingDomainResponseState`（`NOT_REQUIRED` を
    //    含む）だが、この分岐（`view.required === true`）では行の実際の値は 4 値しか来ない
    //    （`NOT_REQUIRED` は #72 の応答専用であり、行には書かれない。`evaluateSendingDomain`
    //    と同じ理由）。
    state: representative.state as TenantSendingDomainState,
  };
}
