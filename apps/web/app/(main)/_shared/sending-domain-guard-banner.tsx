// apps/web/app/(main)/_shared/sending-domain-guard-banner.tsx
// `S-035` / `S-003` の最上部に出す「取引先へまだ 1 通も送れません」の帯（docs/04 §S-036 1298 行
// 「`S-035` と `S-003` の最上部に、検証が未完了である間だけ...帯を出し、本画面へ導く」）。T-04-06。
//
// 🔴 表示条件は呼び出し側が `resolveSendingDomainFact` の結果から決める（本コンポーネントは
//    `visible: boolean` を受け取るだけの純粋な表示。データ取得・判定ロジックを持たない）。
// 🔴 対象は **ホスト所属の `OWNER` / `ADMIN` に限る**（呼び出し側が絞り込む）。理由:
//    ①リンク先の `S-036` 自体が `OWNER` / `ADMIN` 以外を到達させず（ホームへ戻す）、
//    他ロールに出すと行き止まりの導線になる ②登録・検証を実行できるのもこの 2 ロールだけで、
//    それ以外のロールに出しても取れる行動が無い。`SALES` が `F-022`（提案の送信）で
//    実際にこの制約へ突き当たるのは `S-021` 実装時（SP-09）であり、そのときは送信導線側
//    （`docs/04` `program-design` 申し送り 8 の 422 表示）で理由を示す設計になっている
//    （`CLAUDE.md` §13.3「判断材料を隠さない」は狭い画面のための規律であり、ここは
//    「その場で行動できる相手にだけ導線を見せる」という別の観点）。パートナー所属ユーザーは
//    そもそも `TenantSendingDomain` を読めない（RLS C2 HOST_ONLY）ため対象外。
// 🔴 SP-22 段④: 器を `@ses/ui` の `Alert`（`variant="warning"`）に寄せた。色・枠線・余白・
//    文字サイズの決定を画面から取り除く（§7.4 の「橙 = 期限が近い・要注意」。**赤にしない** ——
//    外部で事故が起きたのではなく「まだ送れる状態になっていない」である）。
//    ⚠️ **`role` は `status` のまま**（`Alert` の既定は `alert` だが、ここは利用者の操作に
//    対する即時の警告ではなく、画面を開いた時点の事実の提示である。`Alert` は `role` を
//    呼び出し側から上書きできる形で取り込まれている。`packages/ui/.../alert.tsx` の照合表）。
import Link from 'next/link';
import { Alert } from '@ses/ui';

export type SendingDomainGuardBannerMessages = {
  readonly text: string;
  readonly linkLabel: string;
};

export function SendingDomainGuardBanner({
  visible,
  messages,
}: {
  readonly visible: boolean;
  readonly messages: SendingDomainGuardBannerMessages;
}) {
  if (!visible) return null;
  return (
    <Alert
      variant="warning"
      role="status"
      data-testid="sending-domain-guard-banner"
      className="mb-6 flex flex-wrap items-center justify-between gap-2"
    >
      <p>{messages.text}</p>
      <Link
        href="/settings/sending-domains"
        className="font-medium underline underline-offset-2"
        data-testid="sending-domain-guard-banner-link"
      >
        {messages.linkLabel}
      </Link>
    </Alert>
  );
}
