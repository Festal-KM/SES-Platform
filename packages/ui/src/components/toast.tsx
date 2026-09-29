'use client';
// packages/ui/src/components/toast.tsx
// 🔴 `docs/04` §5-13 の `Toast`: **非同期ジョブの受付と完了の通知。**
//
// ============================================================================
// 🔴 なぜ Radix ではないのか（依存を増やさない）
// ============================================================================
// §5-13 が承認した依存は **`@radix-ui/react-{dialog,dropdown-menu,tooltip,tabs}` の 4 つ**である
// （`docs/05` §2.3.3 の表）。**`@radix-ui/react-toast` は承認の列挙に無い**ので入れない
// （依存の追加は人間の承認事項。`CLAUDE.md` §8.6）。
//
// 🔴 それで問題が無いのは、**本部品が「自作してはならないもの」を 1 つも自作しないから**である
//    （§5-13 の 🔴「キーボード操作・フォーカストラップ・スクリーンリーダ対応を自作しない」）:
//
//   - **フォーカストラップを持たない** —— Toast は補助であり、**フォーカスを奪ってはならない**
//     （奪うと入力中の手が止まる）。したがってトラップの実装がそもそも要らない。
//   - **キーボード操作を持たない** —— 中にある操作は「対象へ行く」リンクと「閉じる」だけで、
//     どちらも素のフォーカス順で到達できる。ロービング tabindex も方向キーも無い。
//   - **スクリーンリーダ対応は `role="status"` + `aria-live="polite"` の 1 行**である
//     （WAI-ARIA の live region そのものであり、`packages/ui` 固有の作り込みではない）。
//     🔴 **`aria-live="assertive"` / `role="alert"` にしない** —— 割り込みで読み上げを止める
//     必要は無く、下の「エラーを Toast だけで出さない」と整合しない。
//
// ============================================================================
// 🔴 §5-13 の 2 つの規約を、どう**型と API の名前**で守ったか
// ============================================================================
// **① 🔴 「送信しました」と書かず「送信を受け付けました」**（§4.4。ジョブは押した瞬間に終わらない）。
//    文言は呼び出し側が `packages/i18n` から渡す（本部品は文言を持たない。`../index.ts` 規約 5）ので、
//    **API の名前で促す**:
//    - 種別を `kind: 'accepted' | 'completed'` とし、**`accepted`（受け付けた）を既定の用法**に
//      する。押した直後に出すのは常に `accepted` である。
//    - `completed` は**ジョブの完了をアプリが観測したとき**だけ使う（送信直後ではない）。
//
// **② 🔴 Toast だけで完了を伝えない / エラーを Toast だけで出さない**（§5-13）。
//    - **`subject`（対象への遷移）を必須にした。** 離脱・再訪でも状態が読めるよう、
//      **一次の伝達経路は対象の状態バッジ（§5-1）と `S-032` の通知**であり Toast は補助である。
//      必須にすることで「Toast を出して終わり」という呼び出し方が**型で書けなくなる**。
//    - 🔴 **`kind` に `error` を持たない。** エラーを Toast で出す口をそもそも作らない
//      （消えると原因が読めない。§7.10 の error は**画面内に残す**）。
//      ⚠️ **`danger` 色を持たない**のも同じ理由である（`--color-danger` は `SUBMIT_FAILED` /
//      `SEND_FAILED` / `SUSPENDED` だけの色。§7.4 / §7.9）。
//
// 🔴 **自動で消さない。** `setTimeout` での自動退場を**持たない** ——
//    ①消えるまでの時間が「読めたか」の保証にならない ②`CLAUDE.md` §13.1 の「移動中に操作する」
//    前提では画面を見ていない時間がある。閉じるのは利用者の操作（`onDismiss`）だけで、
//    表示の寿命は呼び出し側（画面の状態）が持つ。**これによりフックを 1 つも使わない**ので、
//    `'use client'` はクライアント境界の宣言としてだけ必要で、状態は画面側に在る。
// 🔴 **文言を持たない**（`../index.ts` 規約 5）。
import { cn } from '../lib/cn.js';
import { SECONDARY_LINK_CLASSES } from '../lib/link-classes.js';
import {
  OVERLAY_BODY_CLASSES,
  OVERLAY_FOOTER_CLASSES,
  OVERLAY_LABEL_CLASSES,
  OVERLAY_LINK_CLASSES,
  TOAST_PANEL_CLASSES,
  TOAST_VIEWPORT_CLASSES,
  type OverlayLinkProps,
} from '../lib/overlay-classes.js';
import type { ComponentType } from 'react';

/**
 * 🔴 種別は 2 つだけ（ファイル冒頭①②）。**`error` を持たない。**
 * - `accepted` … **受け付けた**（ジョブを積んだ直後。`送信を受け付けました`）。
 * - `completed` … 完了をアプリが観測した（送信直後には使わない）。
 */
export type ToastKind = 'accepted' | 'completed';

/** 対象への遷移（**必須**。ファイル冒頭②）。 */
export type ToastSubject = {
  readonly href: string;
  readonly label: string;
};

export type ToastProps = {
  readonly open: boolean;
  /** 🔴 ファイル冒頭① の種別。既定を置かない（呼び出し側に「どちらか」を必ず考えさせる）。 */
  readonly kind: ToastKind;
  /**
   * 本文（`packages/i18n`）。
   * 🔴 **`kind: 'accepted'` のときは「送信しました」と書かない。「送信を受け付けました」と書く**
   *    （§5-13 / §4.4。押した瞬間にジョブは終わっていない）。
   */
  readonly message: string;
  /** 種別の語（`packages/i18n`。`受付` / `完了` に相当）。読み上げでも種別が伝わる。 */
  readonly kindLabel: string;
  /**
   * 🔴 **対象への遷移（必須）**。Toast だけで完了を伝えないため（ファイル冒頭②）。
   *    一次の伝達経路は対象の**状態バッジ**と `S-032` の通知であり、ここはその入口である。
   */
  readonly subject: ToastSubject;
  /** 遷移を描く部品。既定は素の `<a>`。Next.js の画面は `next/link` の `Link` を渡す。 */
  readonly linkComponent?: ComponentType<OverlayLinkProps>;
  /** 閉じる操作の語（`packages/i18n`）。 */
  readonly dismissLabel: string;
  /** 閉じる。🔴 **自動では消えない**（ファイル冒頭の 🔴）。 */
  readonly onDismiss: () => void;
  readonly className?: string;
  readonly 'data-testid'?: string;
};

function DefaultLink({ href, className, children }: OverlayLinkProps) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export function Toast({
  open,
  kind,
  message,
  kindLabel,
  subject,
  linkComponent: Link = DefaultLink,
  dismissLabel,
  onDismiss,
  className,
  ...passThrough
}: ToastProps) {
  if (!open) return null;
  return (
    <div className={TOAST_VIEWPORT_CLASSES}>
      {/*
        🔴 live region。`polite` で、読み上げに割り込まない（ファイル冒頭）。
        🔴 `data-toast-kind` を持たせるのは、**色で種別を表さない**ため（§7.4 の意味の割り当てを
           増やさない）。種別は `kindLabel` の**語**で伝える（§7.5 / §5-1 の「色 + 形状 + 語」の
           うち、Toast が持てるのは語である）。
      */}
      <div
        className={cn(TOAST_PANEL_CLASSES, className)}
        role="status"
        aria-live="polite"
        data-toast-kind={kind}
        {...passThrough}
      >
        <p className={OVERLAY_LABEL_CLASSES}>{kindLabel}</p>
        <p className={OVERLAY_BODY_CLASSES}>{message}</p>
        <div className={OVERLAY_FOOTER_CLASSES}>
          <button type="button" className={SECONDARY_LINK_CLASSES} onClick={onDismiss}>
            {dismissLabel}
          </button>
          <Link href={subject.href} className={OVERLAY_LINK_CLASSES}>
            {subject.label}
          </Link>
        </div>
      </div>
    </div>
  );
}
