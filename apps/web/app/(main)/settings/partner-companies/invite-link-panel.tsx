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
import { Button } from '@ses/ui';

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
    <div
      className="mt-3 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900"
      data-testid="partner-company-invite-link"
    >
      <p className="mb-1 font-medium">{messages.inviteLinkHeading}</p>
      <p className="mb-2">{messages.inviteLinkNotice}</p>
      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-sky-800">{messages.inviteLinkLabel}</span>
        {/* 🔴 読み取り専用の入力に出す（長い URL をモバイルでも選択・コピーできる）。 */}
        <input
          type="text"
          readOnly
          value={inviteUrl}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-md border border-sky-300 bg-white px-3 py-2 font-mono text-xs"
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
            className={copy === 'copied' ? 'text-xs text-emerald-700' : 'text-xs text-red-700'}
            data-testid="partner-company-invite-link-copy-status"
          >
            {copy === 'copied' ? messages.inviteLinkCopied : messages.inviteLinkCopyFailed}
          </span>
        )}
      </div>
      {/* 🔴 `production` の招待と同じ規律であることを明示する（期限 / 1 回限り / 再表示不可）。 */}
      <p className="mt-2 text-xs text-sky-800" data-testid="partner-company-invite-link-once-only">
        {messages.inviteLinkOnceOnly}
      </p>
    </div>
  );
}
