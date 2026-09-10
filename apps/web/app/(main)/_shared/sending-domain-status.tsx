// apps/web/app/(main)/_shared/sending-domain-status.tsx
// 送信画面が常時示す「事実」の表示（`送信元ドメイン: @example.co.jp（検証済み）`。
// `docs/03` `ui-design` 申し送り 2 / `docs/04` §S-036）。T-04-06。
//
// 🔴 `_shared` は `apps/web/app/(main)/_home` と同じ「ルーティングから除外される共有区画」の
//    命名規則である。今回この事実を表示するのは `S-036`（`sending-domains/`）だけだが、
//    後続の送信画面（`S-021` / `S-024` / `S-026` / `S-014`。SP-09 以降）が
//    `GET /api/settings/sending-domains`（#71）の応答を `resolveSendingDomainFact` に通し、
//    ここから同じ表示を再利用できるようにする（**今回は S-036 内で使うところまで**）。
// 🔴 文言は呼び出し側が `packages/i18n` から解決して渡す（このファイルでは `t()` を呼ばない。
//    サーバ／クライアントいずれの親からも同じ形で渡せるようにするため）。
// 🔴 「検証済み」以外を隠さない —— 未検証・未設定も同じ場所に事実として示す（`BR-46`）。
import type { TenantSendingDomainState } from '@ses/db';
import { Badge, type BadgeVariant } from '@ses/ui';
import type { SendingDomainFact } from '../../../lib/settings/sending-domain-fact';

export type SendingDomainStatusFactMessages = {
  readonly domainLabel: string;
  readonly noneLabel: string;
  readonly notRequiredNotice: string;
  readonly stateLabels: Readonly<Record<TenantSendingDomainState, string>>;
};

/**
 * 🔴 T-21-04: 色の実値をここに持たず `@ses/ui` の `Badge` のバリアントへ寄せた。
 *    `packages/ui/src/components/badge.tsx` は**この対応表の色をそのまま取り込んで**作られており
 *    （T-21-02 の照合表に明記）、両方に色を持たせると片方だけ直る状態が生まれる。
 *    バリアント名と色の対応は 1 対 1 で、見え方は移行前と同じである。
 */
const STATE_BADGE_VARIANTS: Readonly<Record<TenantSendingDomainState, BadgeVariant>> = {
  VERIFIED: 'success',
  PENDING: 'warning',
  REGISTERED: 'neutral',
  FAILED: 'danger',
};

export function SendingDomainStatusFact({
  fact,
  messages,
}: {
  readonly fact: SendingDomainFact;
  readonly messages: SendingDomainStatusFactMessages;
}) {
  if (fact.kind === 'NOT_REQUIRED') {
    return (
      <p
        data-testid="sending-domain-fact"
        data-fact-kind="NOT_REQUIRED"
        className="text-sm text-slate-700"
      >
        {messages.notRequiredNotice}
      </p>
    );
  }

  if (fact.kind === 'UNSET') {
    return (
      <p
        data-testid="sending-domain-fact"
        data-fact-kind="UNSET"
        className="text-sm font-medium text-slate-900"
      >
        {messages.domainLabel}: {messages.noneLabel}
      </p>
    );
  }

  return (
    <p
      data-testid="sending-domain-fact"
      data-fact-kind="SET"
      data-state={fact.state}
      className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900"
    >
      <span>
        {messages.domainLabel}: {fact.domain}
      </span>
      <Badge variant={STATE_BADGE_VARIANTS[fact.state]}>{messages.stateLabels[fact.state]}</Badge>
    </p>
  );
}
