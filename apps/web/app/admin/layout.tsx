// apps/web/app/admin/layout.tsx
// `A-001`〜`A-014` の共通レイアウト（docs/04 §A-001 セクション 1「平面帯（`運営者コンソール`）」）。
//
// 🔴 主平面（`app/(main)/**`）とはルートが別である（`CLAUDE.md` §10.5「別ルート」）。
//    認可はレイアウトではなく各ページ / API が `requirePlatformCtx` で行う
//    （レイアウトは Next.js のレンダリング境界であって認可の境界ではない）。
//    `/admin` の**別ミドルウェア**は T-03-08 が追加する。
// 🔴 文言は `packages/i18n` から引く（CLAUDE.md §3.5 / BR-32）。
import type { ReactNode } from 'react';
import { t } from '@ses/i18n';

/**
 * 🔴 **平面帯（`docs/04` §3.3 の区別手段 #1）。** 「いまどちらの平面にいるか」を一目で
 *    判別できないと、運営者は read-only の前提を忘れて操作しようとする（代理閲覧・停止操作の
 *    誤爆）。Phase 2 の `F-060`（代理閲覧）はこの区別の上に乗る。
 *
 * 🔴 **`docs/04` は「色でなく『帯という構造の有無』で区別する」と定めている**（色覚特性に
 *    依存しないため）。したがって守るべきは**全幅のブロックが最上部に常時在ること**であり、
 *    色はその補助である。**折りたたみ・条件付き表示・装飾扱いの縮小をしない。**
 *
 * T-21-03 で手書き CSS（`.ses-plane-band`）から Tailwind のユーティリティへ移した。
 * 旧宣言との対応（本番ビルドの出力 CSS で 1 つずつ照合済み）:
 *
 *   `background:#1e293b`      → `bg-slate-800`（v4.3 の実値は `#1d293d`。**唯一の差分**）
 *   `color:#f8fafc`           → `text-slate-50`（実値 `#f8fafc`。完全一致）
 *   `font-size:0.8125rem`     → `text-[0.8125rem]`
 *   `font-weight:700`         → `font-bold`（`--font-weight-bold: 700`）
 *   `letter-spacing:0.08em`   → `tracking-[0.08em]`
 *   `padding:0.5rem 1rem`     → `py-2 px-4`（`--spacing: .25rem`）
 *   `text-align:center`       → `text-center`
 *
 * 🔴 既定スケールに無い 2 値（`0.8125rem` / `0.08em`）は**任意値のまま持ち越す** ——
 *    ここは「維持されること」自体が受け入れ基準であり（SP-21 T-21-03 ①）、
 *    スケールに寄せる利得より、帯の見え方が動かないことが優先する。
 *    ⚠️ 任意値の**画面幅バリアント**（`min-[…]:` / `max-[…]:`）とは別物である。あれは独自
 *    ブレークポイントそのもので禁止（`CLAUDE.md` §13.3）だが、これは font-size と
 *    letter-spacing であり、Tier の共通語には関係しない。
 * ⚠️ 背景色だけは Tailwind のパレットに寄せたため厳密には同値でない（`#1e293b` →
 *    `#1d293d`。RGB で 1〜2 の差）。**帯であることの識別性には影響しない**一方、
 *    旧値をハードコードで持ち越すと、以後この 1 色だけがパレット外に取り残される。
 */
const PLANE_BAND_CLASS =
  'bg-slate-800 px-4 py-2 text-center text-[0.8125rem] font-bold tracking-[0.08em] text-slate-50';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    // 🔴 外側の `div` はスタイルを持たない（旧 `.ses-admin-plane` にも CSS 規則は無かった）。
    //    「平面帯 + 中身」を 1 つの平面としてまとめる入れ物であり、**DOM を変えないために
    //    残している**（`docs/sprints/SP-21` §5「要素の並びを変えない」）。ここに背景色や
    //    高さを足すと、それは T-21-05（管理平面 3 画面）の判断を先取りすることになる。
    <div>
      <p className={PLANE_BAND_CLASS}>{t('admin.plane.band')}</p>
      {children}
    </div>
  );
}
