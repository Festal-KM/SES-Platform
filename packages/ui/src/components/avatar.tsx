// packages/ui/src/components/avatar.tsx
// 🔴 上部バーの自分の印（2026-10-02 の人間のブリーフ）。**氏名のイニシャルだけ。**
//
// ============================================================================
// 🔴 画像を扱わない（型として受け取れない）
// ============================================================================
// `src` / `imageUrl` / `children` の prop を**持たない**。理由は 2 つある。
//
//   1. **Phase 1 に顔写真は存在しない。** `CLAUDE.md` §3.2 はスキルシートの顔写真を
//      **マスキング対象**として列挙しており、人物の画像は本プロダクトが持たない情報である。
//      口を開けておくと、いずれ「エンジニアの顔写真を一覧に出す」実装が生える。
//   2. **外部 URL の画像を描く口は、情報境界の穴になる**（取引先のロゴ URL から参照元が漏れる /
//      `<img>` の読み込み失敗で崩れる）。**必要になったら設計の改訂を経て足す。**
//
// 🔴 **イニシャルの切り出しもしない。** 「山田太郎 → 山」の規則は言語と氏名の持ち方に依存する
//    （姓名の順・ミドルネーム・英字）。部品が勝手に切ると、画面ごとに違う規則が生まれる。
//    **呼び出し側が解決済みの 1〜2 文字を渡す。**
//
// 🔴 **読み上げには出さない**（`aria-hidden`）。上部バーには氏名とロールのテキスト
//    （`app-header-account`）が隣に在り、印まで読み上げると**同じ名が 2 回読まれる**。
//    🔴 したがって **氏名のテキストと必ず並べて置く**（この印だけを置かない）。
//
// 🔴 **`'use client'` を宣言しない / 文言を持たない**（`../index.ts` の共通規約 4・5）。
import { cn } from '../lib/cn.js';

export type AvatarProps = {
  /**
   * 🔴 **解決済みのイニシャル 1〜2 文字**（`山` / `YT`）。
   * ⚠️ 3 文字以上は実行時に落とす（下の壁）—— 円の中で文字が潰れ、`rounded-full` の寸法が
   *    内容で変わる（行の高さが内容量で変わるのは `HANDOFF.md` §3.3 の 1 件目と同じ性質の問題）。
   */
  readonly initials: string;
  /**
   * ポインタを置いたときの語（氏名）。🔴 **読み上げには出ない**（上の 🔴）。
   */
  readonly title: string;
  readonly className?: string;
};

/** 🔴 イニシャルの上限（2 文字）。 */
export const AVATAR_MAX_INITIALS = 2;

/**
 * 🔴 **円形が許されるのはアバターとカウンタだけ**（`docs/04` §7.9 の radius の 🔴）。
 *    ここはその「アバター」そのものである。
 * 🔴 寸法は 32px（`--control-h-sm` と同じ段）—— 上部バーの 1 段の高さを押し広げない。
 * 🔴 無彩色（§7.4 の 6 系統を人の印に使わない。**brand は「いま進行中」の意味**である）。
 */
const AVATAR_CLASSES =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-bg-inset text-xs font-medium text-fg';

export function Avatar({ initials, title, className }: AvatarProps) {
  if (initials.length > AVATAR_MAX_INITIALS) {
    throw new Error(
      `Avatar: initials は ${String(AVATAR_MAX_INITIALS)} 文字までです（渡された値: ${initials}）。氏名からの切り出しは呼び出し側の責務です。`,
    );
  }
  return (
    <span
      className={cn(AVATAR_CLASSES, className)}
      title={title}
      aria-hidden="true"
      data-testid="app-header-avatar"
    >
      {initials}
    </span>
  );
}
