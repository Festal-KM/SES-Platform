'use client';

// apps/web/app/(main)/settings/partner-companies/invite-link-panel.tsx
// 🔴 `sandbox` の招待リンク（docs/04 §S-014 セクション 4 / `F-007 AC-4`）。T-04-08。
//    T-04-09 で `partner-companies-screen.tsx` から切り出した —— ホストの取引先招待（`F-007`）と
//    `PARTNER_ADMIN` の自社アカウント招待（`F-002 AC-4`）の**両方**が同じ表示を要するため。
//    2 箇所に書き分けると、片方だけ「1 回限り・再表示不可」の注意書きが欠ける。
//
// 🔴 表示・コピーの両方を出す。コピーだけにしないのは、`navigator.clipboard` が
//    安全なコンテキスト以外では使えないためである（使えないときに手段が無くなると、
//    見込み客は取引先を招けず `F-054 AC-1` のパートナースコープ検証まで止まる）。
// 🔴 リンクの有効期限・1 回限りの受諾・受諾後の失効は `production` の招待と**同一**である
//    （専用の別トークンでも別経路でもない）。その事実を文言で明示する。
// 🔴 **再表示しない。** 招待の発行直後の応答だけが平文トークンの出口であり、再表示 API を作らない
//    （docs/04 §S-046 の「この画面を離れると再表示できません」と同じ規律）。
import { useState } from 'react';
import { Alert, Button } from '@ses/ui';

export type InviteLinkPanelMessages = {
  readonly inviteLinkHeading: string;
  readonly inviteLinkNotice: string;
  readonly inviteLinkOnceOnly: string;
  readonly inviteLinkLabel: string;
  readonly inviteLinkCopy: string;
  readonly inviteLinkCopied: string;
  readonly inviteLinkCopyFailed: string;
};

export function SandboxInviteLinkPanel({
  inviteUrl,
  messages,
}: {
  readonly inviteUrl: string;
  readonly messages: InviteLinkPanelMessages;
}) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopy('copied');
    } catch {
      // 🔴 握り潰さない。コピーできなかったことを見せ、表示中のリンクを手で選べるようにする。
      setCopy('failed');
    }
  }

  return (
    // 🔴 SP-22 段④: 器を `@ses/ui` の `Alert`（`info` = 青）に寄せた。
    //    §7.4 の割り当てで 青 = 「補足・案内」であり、`sandbox` での手渡しの案内はそれに当たる
    //    （旧実装の sky 系と同じ色系である）。`role` は `status`（成功した発行の結果の提示）。
    <Alert variant="info" role="status" className="mt-3" data-testid="partner-company-invite-link">
      <p className="mb-1 font-medium">{messages.inviteLinkHeading}</p>
      <p className="mb-2">{messages.inviteLinkNotice}</p>
      {/* 🔴 ここは `Field` / `Input` に置き換えていない。理由は色でなく**寸法**である:
          `Input` は高さ 40px 固定・`text-lg md:text-body`（16/14px）であり、ここで欲しいのは
          **12px の等幅で長い招待 URL をできるだけ一度に見せる**ことである（招待は 1 回限りで
          再表示できず、読み違えれば取引先が sandbox に入れない）。**色はトークンで持つ。** */}
      <label className="mb-2 block">
        <span className="mb-1 block text-xs">{messages.inviteLinkLabel}</span>
        {/* 🔴 読み取り専用の入力に出す（長い URL をモバイルでも選択・コピーできる）。 */}
        <input
          type="text"
          readOnly
          value={inviteUrl}
          onFocus={(event) => event.currentTarget.select()}
          /* 🔴 地は**ページ地**（`bg-bg`）を使う —— 面（`bg-surface`）は `packages/ui` の
             部品だけが持つ（`tests/static/ui-shadow-and-size.test.ts`）。**値は同じ白**であり、
             旧実装の `bg-white` と見た目は変わらない。 */
          className="w-full rounded-md border border-info-border bg-bg px-3 py-2 font-mono text-xs text-fg"
          data-testid="partner-company-invite-link-value"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void onCopy()}
          data-testid="partner-company-invite-link-copy"
        >
          {messages.inviteLinkCopy}
        </Button>
        {copy === 'idle' ? null : (
          <span
            role="status"
            className={copy === 'copied' ? 'text-xs text-success' : 'text-xs text-danger'}
            data-testid="partner-company-invite-link-copy-status"
          >
            {copy === 'copied' ? messages.inviteLinkCopied : messages.inviteLinkCopyFailed}
          </span>
        )}
      </div>
      {/* 🔴 `production` の招待と同じ規律であることを明示する（期限 / 1 回限り / 再表示不可）。 */}
      <p className="mt-2 text-xs" data-testid="partner-company-invite-link-once-only">
        {messages.inviteLinkOnceOnly}
      </p>
    </Alert>
  );
}
