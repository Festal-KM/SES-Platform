// packages/ui/src/components/sidebar.tsx
// 主平面のグローバルナビ（`docs/04` §3.1 のサイドバーの項目表 / §3.4 の「その他」/ §7.5 ③）。SP-22 `T-22-05`。
//
// ============================================================================
// 🔴 この部品が守るもの（`docs/04` §3.1 / §7.10 / `SP-22` `T-22-05` の条文 2〜7）
// ============================================================================
// 1. ✅ **2026-10-13: 上端は「ロゴ + 開閉トグル」の 1 本の帯である。** 高さは Top Header と
//    同じ 56px（`HEADER_HEIGHT_CLASS`）なので、**画面の最上段が左右で 1 本に揃う**。
//    🔴 **「製品名を出す箇所は 1 つだけ」（`U-01`）という条文は不変**であり、場所が Top Header から
//       ここへ移っただけである（ヘッダからは外した）。
//    🔴 **帯だけが白い**（`--color-surface`）。理由は**受け取ったロゴの文字が濃紺**
//       （実測 `#001040` 付近）だからで、濃紺の柱（`--color-sidebar-bg` = `#0B2447`）に
//       載せると **1.1:1 で読めない**。🔴 **ロゴを塗り替えて解決しない** —— ブランドの図版を
//       実装側が作り直すと、原本と少しずつ違うものが増える（2026-10-13 の人間の指示
//       「ロゴはこれにしてって言ったじゃん」はまさにそれを正したものである）。
// 2. 🔴 **2 形態**（展開 / アイコンのみ）。**境界は Tailwind 既定の `xl` の 1 本だけ**で、
//    `xl` 未満は既定でアイコンのみ / `xl` 以上は既定で展開（`docs/04` §3.1 / §7.1）。
//    🔴 **アイコンのみでも項目の順序とグループの区切りを変えない**（順序が業務ループを教える）。
// 3. 🔴 **群は `営業` / `連絡` / `分析` / `設定` の 4 つ**（`U-20` / §11-21）。**ホームは群に属さず最上段**。
//    区切りは**線ではなく余白 + 小さな群名**で表す（罫線を増やして画面を分割しない）。
// 4. 🔴 **全項目に Lucide アイコン**（`./../icons.ts` の閉じた写像）。比喩アイコンは構造的に入らない。
// 5. 🔴 **未実装の項目はリンクにしない**（`<span>` で描き `href` を持たせない）。**404 を作らない。**
//    印は**無彩色の `Badge`**（`Phase 2` / `Phase 3`）であり、注記テキストを置き換えたものである。
// 6. **現在地** = 背景 `--color-sidebar-selected-bg` + 文字 `--color-sidebar-selected-fg` の **2 点**。
//    ✅ **2026-10-04（人間の明示指示「ハイライトの左端に色がついているのはなくして」）: 左端 2px の
//    色帯をやめた**（旧 `--color-sidebar-selected-bar`。トークンの宣言ごと消した）。
//    🔴 **背景と文字色は残す**（これが無いと現在地が分からなくなる）。
//    ⚠️ `docs/04` §3.1 / §7.10 は依然として「背景 + 文字色 + **左端 2px**」の 3 点を定めており、
//       **本実装が先行する**（設計書の追随はオーケストレーターが行う。`CLAUDE.md` §8.7。
//       本タスクは `docs/**` を触らない）。
//    🔴 **太字だけで示さない**（日本語ゴシックは太字の差が弱く、10 項目以上の縦並びでは走査できない）。
// 6b. 🔴 **現在地は「初回描画の値」と「クライアントの上書き」の 2 段で決まる**（2026-10-04）——
//    App Router のレイアウトはソフトナビゲーションで再描画されないので、`currentPath`（ヘッダ由来）
//    だけでは**最初に着地した画面が光り続ける**（`../lib/current-nav-path.ts` 冒頭の実測表）。
//    そこでこの部品は `SidebarLinkProps` に **`matchPaths` と `currentClassName`** を載せて渡し、
//    `linkComponent`（`apps/web` の `'use client'` の島）が `usePathname()` で**上書きする**。
//    🔴 **判定は `../lib/current-nav-path.ts` の 1 実装のまま**であり、この部品は
//       **初回描画ぶんを計算して `aria-current` に載せる**だけである。
// 7. 🔴 **hover は 150ms の色変化のみ**（拡大・浮き上がり・影・下線を出さない。§7.10）。
// 8. 🔴 **`'use client'` を宣言しない。** 状態もイベントハンドラもフックも持たない（下の 🔴）。
// 9. 🔴 **文言を持たない**（`../index.ts` の共通規約 5）。語は呼び出し側が `packages/i18n` から渡す。
//
// ============================================================================
// 🔴 なぜ 2 形態の切り替えを「チェックボックス + CSS」で作るのか（`T-22-05` 条文 3 の括弧）
// ============================================================================
// 条文は「**切替は利用者の明示操作で選択を保持する**（🔴 `'use client'` を増やさず `<details>` /
// CSS で実現できる範囲に収める）」と定めている。外枠に `'use client'` を付けると、**それに包まれる
// 主平面の全画面**がクライアントバンドルへ移る（`tests/static/client-db-boundary.test.ts` の前提が
// 崩れる）ため、JS を使わずに済ませなければならない。
//
// 🔴 **`<details>` は使えない。** `<details>` は閉じたとき `<summary>` 以外の子を**隠す**
//    （新しい Chromium は `::details-content` の `content-visibility: hidden` で実装しており、
//    子側の `display` では覆せない）。アイコンのみの形態は「隠れる」ではなく「ラベルが消えて
//    アイコンが残る」なので、ナビを `<details>` の中に置くと**閉じた瞬間にナビが消える。**
//    したがって開閉の状態は**ナビの外側に持つ**しかなく、`<input type="checkbox">`（+ `<label>`）が
//    JS 無しで状態を持てる唯一の要素である。**選択はレイアウトの DOM が生き続ける限り保たれる**
//    （App Router の画面遷移ではレイアウトが再生成されない ＝ `app-tab-more` の `<details>` と同じ）。
//
// 🔴 **チェックの意味は「既定と逆の形態にする」である**（`xl` 以上では折りたたみ、`xl` 未満では展開）。
//    1 ビットの状態で「既定が幅によって違う」2 形態を両方向に切り替えるには、これしかない
//    （`checked` を「展開」に固定すると、既定が展開である `xl` 以上で**折りたためなくなる**）。
//    読み上げの語（`labels.toggle`）も方向を断定せず「切り替える」にすること。
//
// 🔴 **4 クラスの優先順は特異度で決まり、宣言順に依存しない**（実測。`tailwind` 4 の出力）:
//      `hidden`                        … (0,1,0)
//      `group-has-checked:block`       … (0,2,0) —— `:is(:where(.group):has(*:checked) *)`
//      `xl:block`                      … (0,1,0) / `@media`
//      `xl:group-has-checked:hidden`   … (0,2,0) / `@media`（**同特異度で後に出る**）
//    → `xl` 未満: 未チェック = アイコンのみ / チェック = 展開。`xl` 以上: 逆。**両方向に効く。**
//
// 🔴 **`:has(*:checked)` の射程を外枠全体にしない。** `group` はサイドバーを包む**専用の器**に
//    付ける（`SIDEBAR_SHELL_CLASSES`）。外枠のルートに付けると、**本文のフォームのチェックボックス
//    1 つでサイドバーの形が変わる**（`S-013` の公開範囲のチェックボックスが実例になる）。
import type { ComponentType, ReactNode } from 'react';
import { Avatar } from './avatar.js';
import { Badge } from './badge.js';
import { Icon, type IconName } from '../icons.js';
import { cn } from '../lib/cn.js';
import { HEADER_HEIGHT_CLASS, SIDEBAR_NAV_ITEM_HEIGHT_CLASS } from '../lib/layout-tokens.js';
import { ICON_CONTROL_CLASSES } from './button.js';
import { matchesCurrentNavPath, navLinkClassName } from '../lib/current-nav-path.js';
import { FOCUS_RING_CLASSES, TRANSITION_CLASSES } from '../lib/state-classes.js';

/**
 * リンクを描く要素（`docs/05` §2.3.1）。🔴 **`packages/ui` は `next/*` に依存しない**ので、
 * `apps/web` が `next/link`（を包んだ島）を渡す。未指定なら素の `<a>`。
 */
export type SidebarLinkProps = {
  readonly href: string;
  /** 現在地**でない**ときのクラス。 */
  readonly className?: string;
  /**
   * 🔴 現在地のときのクラス（2026-10-04）。**未指定なら現在地の表現を持たない**
   *    （「その他」のパネルとボトムタブが現にそうである）。
   */
  readonly currentClassName?: string;
  /**
   * 🔴 **この項目が現在地になるパスの全体**（自分の遷移先 + 第 2 階層 / 索引の射程）。
   *
   * 🔴 これを渡すのは、`linkComponent` がクライアントで `usePathname()` から**現在地を
   *    作り直せる**ようにするためである（App Router のレイアウトはソフトナビゲーションで
   *    再描画されない。`../lib/current-nav-path.ts` 冒頭）。**判定の実装は渡さない**
   *    （判定は 1 箇所にしかなく、島はそれを呼ぶ）。
   */
  readonly matchPaths?: readonly string[];
  readonly children: ReactNode;
  readonly title?: string;
  /** 🔴 **初回描画（水和前）の現在地**。クライアントはこれを上書きする。 */
  readonly 'aria-current'?: 'page';
  readonly 'data-testid'?: string;
};

/**
 * 🔴 `linkComponent` 未指定のときの既定（素の `<a>`。`docs/05` §2.3.1）。
 *
 * 🔴 **`usePathname()` を持たない**ので、現在地は渡された `aria-current`（= サーバが計算した
 *    初回描画の値）をそのまま使う。**ここで判定をやり直さない。**
 * 🔴 クラスの選び方は `navLinkClassName` の 1 実装で行う（島と同じ関数）。
 */
export function SidebarDefaultLink({
  href,
  className,
  currentClassName,
  matchPaths,
  children,
  ...rest
}: SidebarLinkProps) {
  // 🔴 `matchPaths` は島のためのものであり、素の `<a>` には属性として出さない
  //    （DOM に未知の属性を流すと React が警告を出す）。
  void matchPaths;
  return (
    <a
      href={href}
      className={navLinkClassName(rest['aria-current'] === 'page', className, currentClassName)}
      {...rest}
    >
      {children}
    </a>
  );
}

/** 遷移先（🔴 `LINK` 以外は `<a>` を作らない ＝ 404 に飛ぶリンクを 1 つも作らない）。 */
export type SidebarReach =
  | { readonly kind: 'LINK'; readonly href: string }
  | { readonly kind: 'UNAVAILABLE' };

/**
 * 項目に添えるバッジ（`提案依頼` の返答期限。`docs/04` §3.1 取引先列）。
 * 🔴 **件数を入れない**（件数は他社情報の示唆になりうる。`CLAUDE.md` §3.1 / `F-004 AC-4`）。
 */
export type SidebarBadge = {
  /** 読み上げのための見出し語（画面では項目名の隣にあるので文脈で読める）。 */
  readonly label: string;
  /** 値（`残り 2 日`）。🔴 組み立ては呼び出し側の 1 実装が行う。 */
  readonly text: string;
  /**
   * 🔴 **アイコンのみの形態で点（dot）に添える読み上げの語**（`返答期限が近い依頼があります`）。
   *
   * 🔴 **件数も期限の文字も入れない。** 点が伝えるのは「対応が要るものがある」だけである
   *    （`CLAUDE.md` §3.1 / `F-004 AC-4`「件数バッジ・間接的な示唆も作らない」）。
   * 🔴 語が要る理由: 点は `aria-hidden` の装飾なので、**添えないとアイコンのみの形態で
   *    スクリーンリーダ利用者だけが期限に気づけない**（1024–1279px は既定でアイコンのみ）。
   */
  readonly dotLabel: string;
};

export type SidebarItem = {
  /** `data-testid` の接尾辞（kebab-case）。 */
  readonly id: string;
  /** 解決済みのラベル（🔴 `packages/i18n` は呼び出し側）。 */
  readonly label: string;
  /** 🔴 `docs/04` §3.1 の表のアイコン名（写像に無い名前は型エラー）。 */
  readonly icon: IconName;
  readonly reach: SidebarReach;
  /**
   * 🔴 未実装の印（`Phase 2` / `Phase 3`）。**解決済みの語**を渡す（`null` なら描かない）。
   * 🔴 **無彩色の Badge で描く**（未実装は障害でも注意でもない。`docs/04` §3.1 / §7.4）。
   * ⚠️ 語をこの部品に持たせない（`../index.ts` の共通規約 5）—— 呼び出し側が
   *    `packages/i18n`（`shell.nav.note.phase2` / `phase3`）から解決して渡す。
   */
  readonly phase: string | null;
  /**
   * 実在するが単独の URL を持たない項目の注記（`案件から開きます`）。
   * 🔴 **`Phase N` とは別物である** —— あちらは「まだ無い」、こちらは「別の入口から開く」。
   */
  readonly note: string | null;
  readonly badge: SidebarBadge | null;
  /**
   * 🔴 **その項目が「現在地」になる追加のパス**（第 2 階層 / 索引の遷移先）。SP-22（2026-10-03）。
   *
   * 🔴 サイドバーが畳まれ、`提案`（`/proposals`）/ `提案依頼`（`/proposal-requests`）/
   *    `共有の設定`（`/engineer-shares`）/ `監査ログ`（`/audit-logs`）/ `スキル辞書`（`/skills`）が
   *    第 2 階層と索引へ移った。**`reach.href` の前方一致だけでは、それらの画面を開いている間
   *    項目が 1 つも光らない**（`docs/04` §3.1 の現在地の表現が成立しない）。
   * 🔴 **どのパスが射程かは呼び出し側が決める**（`apps/web/lib/shell/nav.ts` の `sectionPaths`）。
   *    この部品は `reach.href` と併せて `matchPaths` に組み、判定（`../lib/current-nav-path.ts`）を
   *    適用するだけである。✅ 2026-10-04: **同じ `matchPaths` を `linkComponent` にも渡す**
   *    （クライアントで現在地を作り直せるようにするため。ファイル冒頭の 6b）。
   * ⚠️ 未指定（`undefined`）は「追加の射程なし」である（`reach.href` だけで判定する）。
   */
  readonly sectionPaths?: readonly string[];
};

/**
 * 群（`docs/04` §3.1 の 4 群 + 群名なしの最上段）。
 * 🔴 **群の順序と項目の順序は呼び出し側の項目表が持つ**（この部品は並べ替えない）。
 */
export type SidebarGroup = {
  readonly id: string;
  /** 群名。🔴 `null` = 群名なし（最上段のホーム）。 */
  readonly label: string | null;
  /**
   * 🔴 **この群の上に罫線を引く**（✅ 2026-10-13。人間の指示「区切り線を入れる」）。
   *
   * ⚠️ 既定は `false`（= 条文 3 の「区切りは余白」のまま）。**線を引くかどうかを群ごとに
   *    呼び出し側が明示する**ことで、群が増えるたびに線が増えるのを止めている
   *    （`SIDEBAR_GROUP_DIVIDED_CLASSES` の ⚠️）。
   */
  readonly divided?: boolean;
  readonly items: readonly SidebarItem[];
};

/**
 * サイドバーの最下部に出す**サインインしている本人**（✅ 2026-10-13。人間の指示
 * 「サイドバー最下部にログインアカウントを表示させる」）。
 *
 * 🔴 **自分の所属と自分の氏名だけである。** 他社の名前も、他の利用者の名前も出ない
 *    （`CLAUDE.md` §3.1 の第二境界。ここは「いまどの立場で見ているか」の常時表示であり、
 *    `docs/04` §3.2 のスコープ表示と同じ役割を柱の側で担う）。
 * 🔴 **ロール名は持たない** —— 上部バーの「自分」メニューが氏名 + ロールを持っており、
 *    **同じことを 2 箇所で違う粒度で書かない**（ロールは「なぜこの操作ができないか」の
 *    一次説明なので、操作の在る側 = ヘッダのメニューに置いたままにする）。
 * 🔴 **押せない。** サインアウト等の操作は上部バーのメニューが 1 箇所で持つ
 *    （`Sidebar` は `'use client'` を持てないので、ここにメニューは置けない）。
 */
export type SidebarAccount = {
  /** 所属（組織名）。 */
  readonly organizationName: string;
  /** 氏名。 */
  readonly userName: string;
  /** 🔴 **解決済みのイニシャル 1〜2 文字**（切り出しは呼び出し側。`./avatar.tsx` の 🔴）。 */
  readonly initials: string;
};

/** サイドバーと「その他」は**同じ項目表**を描くので、`data-testid` の接頭辞を分ける。 */
export type SidebarVariant = 'sidebar' | 'more';

/**
 * ロゴのブロックに出す語（🔴 **文言は呼び出し側が `packages/i18n` から渡す**）。
 * ✅ 2026-10-13（[Issue #93](https://github.com/Festal-KM/SES-Platform/issues/93) = B）。
 */
export type SidebarBrand = {
  /**
   * ロゴ（ロックアップ）の画像（`apps/web/public` 配下のパス）。
   * 🔴 **受け取った原本をそのまま使う**（`BrandLogo` の 🔴）。
   * 🔴 **製品名を表示する唯一の箇所**（`U-01` の置き場所がヘッダからここへ移った）。
   *    画像の中に `BizOrch` と `for Engineering Service` が組まれているので、
   *    **製品名もタグラインも文字としては描かない。**
   */
  readonly logoSrc: string;
  /**
   * ロゴの代替テキスト。
   * 🔴 **正式名称（`product.name`）を入れる** —— 読み上げでは略称ではなくサービス名を読む。
   *    `U-01` の「1 箇所」を機械で確かめているのもこの文字列である
   *    （`main-shell.render.test.tsx` の `brandRow` の検査）。
   */
  readonly logoAlt: string;
  /** 版表記。🔴 **手で書かない**（呼び出し側がビルド時の値を渡す）。 */
  readonly version: string;
  /** ロゴを押したときの遷移先（ホーム）。 */
  readonly homeHref: string;
};

export type SidebarLabels = {
  /** `<nav aria-label>`。 */
  readonly nav: string;
  /** 🔴 開閉トグルの語。**方向を断定しない**（上の 🔴）。 */
  readonly toggle: string;
};

// ============================================================================
// 🔴 component 層のクラス（`docs/04` §7.9 の ③。semantic トークンだけを参照する）
// ============================================================================

/** 開閉トグルの `<input>` と `<label>` を結ぶ id。🔴 外枠は 1 リクエストに 1 つだけ描かれる。 */
const SIDEBAR_TOGGLE_ID = 'ses-sidebar-form';

/**
 * ロゴ（🔴 **人間から受け取ったロックアップをそのまま使う**。2026-10-13）。
 *
 * 🔴 **マーク + `BizOrch` + `for Engineering Service` が 1 枚の画像に組まれている。**
 *    したがって**製品名もタグラインも、別の `<span>` として描かない**（二重になる）。
 * 🔴 **自前で描き起こさない / 塗り替えない。** 実装側がブランドの図版を再現すると、原本と
 *    少しずつ違うものが増える。**読めるようにするのは地の側の仕事**であり、それが
 *    ファイル冒頭の 1 の「帯だけが白い」理由である。
 * 🔴 **`Icon`（lucide の閉じた写像）には入れない** —— これは図版であってアイコンの段ではない。
 * 🔴 **`src` は呼び出し側が渡す** —— `packages/ui` は `apps/web` の公開ディレクトリを知らない。
 * ⚠️ 原寸は 257 × 80（透明部分を切り落とした実寸）。`h-9`（36px）で**幅は 116px** になり、
 *    展開時の内寸 184px（208 − 左右 12）にトグル 32 + gap 8 と並べても収まる（実測 164px）。
 */
function BrandLogo({ src, alt }: { readonly src: string; readonly alt: string }) {
  // 🔴 `packages/ui` は `next/*` に依存しない（`docs/05` §2.3.1）ので `next/image` を使わない。
  // 🔴 `block` にするのは、インライン画像の行下がり（descender 分の余白）で帯の中心がずれるため。
  return <img className="block h-9 w-auto" src={src} alt={alt} width={257} height={80} />;
}

/**
 * サイドバーを包む器。🔴 **`group` はここに付ける**（`:has(*:checked)` の射程を
 * 「サイドバーの中のチェックボックス」に限るため。上の 🔴）。
 * 🔴 `md:` 未満はボトムタブに置き換わる（`docs/04` §3.4。**T-12-20 の境界を変えない**）。
 */
const SIDEBAR_SHELL_CLASSES = 'group hidden shrink-0 md:block';

/**
 * 柱そのもの。🔴 **環境バナー直下から画面下端までの 1 本**（§3.1 の改訂 16）。
 *
 * ✅ **2026-10-02: 濃色（濃紺）にした**（`docs/04` `U-25` / §7.9 改訂 23 / 人間のブリーフ）。
 *    理由は §3.1 の改訂 23 にある: **ナビは「毎日何十回も走る柱」であり、本体（白地の一覧・承認・
 *    設定）と面として分離していることが走査の起点になる。** 項目が 15〜16 に増えたため、白地の
 *    ままでは本体のテーブルとの境界が border 1 本しか無く、幅の広い画面で**視線が柱に入ったのか
 *    本体に入ったのかが読めない**（§7.1 でクラス A を全幅にしたことの副作用）。
 * 🔴 **色は `--color-sidebar-*` の 8 トークンだけから取る**（階調を直書きしない）。
 *    🔴 **白地用の semantic（`--color-fg` / `--color-bg` / `--color-bg-subtle`）を濃色の面に
 *    載せない** —— 意味と見た目が逆転する（`tailwind.css` の 🔴。検査が落とす）。
 * 🔴 **ダークテーマではない。** 濃色なのは**この部品だけ**であり、他の画面・管理平面のナビを
 *    濃色にしない（§3.3。**色を平面の差にしない**）。
 *
 * - 幅: 🔴 **アイコンのみ 56px / 展開 224px**。切り替えは上の 4 クラスの規則で行う。
 * - 🔴 **影を足さない**（階層は border と背景の差で表す。§7.9）。
 * - `sticky top-0 h-dvh` … 50 行の一覧を読んでいる間もナビに戻れる（`overflow-y-auto` は
 *   16 項目が縦に収まらない小さな高さのため）。
 *   🔴 **sticky が成立している理由**: 器（`SIDEBAR_SHELL_CLASSES`）が外枠の **flex item** として
 *   既定の `align-items: stretch` でページ全高まで伸び、**その内側で `md:sticky top-0 h-dvh` の
 *   `<nav>` が動ける**。🔴 **器に `self-start` を付けないこと** —— 付けると器の高さが内容で
 *   確定し、スクロールしても追従する余地が無くなって sticky が死ぬ。
 *   ⚠️ `<nav>` 自身に `self-start` を書いても**効かない**（`align-self` は flex / grid item に
 *   しか効き、器は `md:block` なので `<nav>` は item ではない）。T-22-05 のレビューで除去した。
 */
/**
 * 開閉の動き（✅ **2026-10-13**。人間の指摘「サイドバーの開閉の動きが不自然です」）。
 *
 * 🔴 **幅だけを遷移させる。** `docs/04` §7.9 は遷移の対象を background-color / border-color /
 *    color / opacity に限っているが、あの条文が止めているのは
 *    **hover で 50 行の一覧が波打つこと**である（`../lib/state-classes.ts` 冒頭の 🔴）。
 *    **利用者が明示的に 1 回押した開閉**はその射程ではなく、むしろ幅が一瞬で 56 ↔ 208 に飛ぶと
 *    **本体が横に跳ねたように見えて、何が起きたのかが読めない**（これが「不自然」の正体）。
 * 🔴 **200ms / `ease-out`。** §7.9 の 150ms より 1 段だけ長い —— 152px を動かすので 150ms では
 *    跳ねたままに見える。🔴 **300ms 以上にしない**（§7.9: 毎日何百回も見る遷移は短いほどよい）。
 * 🔴 **`transition-all` にしない**（色・影まで巻き込むと §7.9 の条文が崩れる）。
 * 🔴 **`motion-reduce` で切る** —— 動きを減らす設定の利用者には最初から最終状態を見せる。
 * ⚠️ 併せて `overflow-x-hidden` を持たせている: 広がる途中の 1〜2 フレームは**語のほうが先に
 *    現れる**（`display` は遷移できない）ので、はみ出した語は柱の縁で切る。
 */
const SIDEBAR_WIDTH_TRANSITION_CLASSES =
  'transition-[width] duration-200 ease-out motion-reduce:transition-none';

const SIDEBAR_CLASSES = cn(
  // ✅ **2026-10-13（`docs/design-system.md` §2 / §3.1）: 幅 224 → 208、地を濃紺の
  //    グラデーション（`#0B2447` → `#122E57`）にした。** 🔴 **グラデーションが許されるのは
  //    この 1 面だけである**（`docs/design-system.md` §5-8）。
  // 🔴 枠線を外した —— グラデーションの面と白い本体の境は、面の差だけで十分に読める。
  'flex flex-col overflow-x-hidden overflow-y-auto bg-linear-to-b from-sidebar-bg to-sidebar-bg-end pb-5',
  // 🔴 **バナーのぶんだけ短くする**（✅ 2026-10-13）。`sticky top-0 h-dvh` のままだと、
  //    `sticky top-0` のバナーがある環境（`demo` / `sandbox` / `staging` / `development`）で
  //    **柱が viewport より 40px 長くなり、最下部の本人の箱が切れる**（実測で下 19px 欠けた）。
  // 🔴 **変種付きなので文字列リテラルで書く**（組み立てると CSS が生成されない。上の 🔴）。
  //    値は `../lib/layout-tokens.ts` の `ENV_BANNER_HEIGHT_*` と対であり、
  //    `tests/static/layout-tokens.test.ts` が一致を固定する。
  // ⚠️ `production` では `<body>` に変数が無く、既定の `0px` が効く（＝ 従来どおり `100dvh`）。
  'md:sticky md:top-[var(--app-banner-h,0px)] md:h-[calc(100dvh-var(--app-banner-h,0px))]',
  // 🔴 **変種付きのクラスは文字列リテラルで書く** —— Tailwind の走査は
  //    `group-has-checked:${定数}` のような組み立てを候補として拾えず、**CSS が生成されない**
  //    （テストは緑のまま見た目だけ壊れる）。値は `../lib/layout-tokens.ts` と対であり、
  //    一致は `tests/static/layout-tokens.test.ts` が固定する。
  'w-14 group-has-checked:w-52 xl:w-52 xl:group-has-checked:w-14',
  SIDEBAR_WIDTH_TRANSITION_CLASSES,
);

/**
 * 上端の帯（**ロゴ + 開閉トグル**）。✅ 2026-10-13。詳細はファイル冒頭の 1。
 *
 * - 🔴 **高さは Top Header と同じ**（`HEADER_HEIGHT_CLASS` = 56px）。左右で最上段が 1 本に揃う。
 * - 🔴 **地は白**（ロゴの文字が濃紺なので、濃紺の柱の上では読めない。冒頭の 1）。
 *   下端の罫線もヘッダのものと同じ `--color-border` で、**1 本の線として continue する**。
 * - 🔴 **`px-3`（12px）は「畳んだときにトグルがちょうど中央に来る」値**である
 *   （56 − 12 × 2 = 32 = `IconButton` の寸法）。広げたときは群の左右（`px-3`）とも揃う。
 * - 🔴 **余白は `mb-4`（margin）で取る。** 柱の `padding-top` にすると**帯そのものが下がって
 *   Top Header と揃わなくなる**（罫線は帯の下端に残り、本文だけが 16px 下がる）。
 * - 🔴 **罫線は外側、`h-14` は内側の行に当てる**（`TopBar` と同じ組み方）。
 *   ⚠️ **1 枚にまとめると 1px ずれる** —— `border-box` では `h-14` の 56px に罫線の 1px が
 *   **含まれる**ので帯は 56px になるが、Top Header は「56px の行 + 罫線 1px」で **57px** である
 *   （実測で確かめた: 帯 56 / ヘッダ 57）。**揃えるために帯を置いたのに 1px ずれる**のでは
 *   本末転倒なので、組み方のほうを合わせる。
 */
const SIDEBAR_HEAD_CLASSES = 'mb-4 shrink-0 border-b border-border bg-surface';
const SIDEBAR_HEAD_ROW_CLASSES = cn('flex items-center gap-2 px-3', HEADER_HEIGHT_CLASS);

/**
 * ロゴのリンク（ホームへ）。
 * 🔴 **畳んだ形態では消す** —— 56px の帯に 103px のロックアップは入らない（`BrandLogo` の ⚠️）。
 * 🔴 **display は `SIDEBAR_EXPANDED_ONLY_CLASSES` が決める**ので、ここに `flex` / `block` を
 *    書かない（`cn()` = `tailwind-merge` が同じ群を後勝ちで畳むため、書くと必ずどちらかが死ぬ）。
 */
const SIDEBAR_BRAND_LINK_CLASSES = cn('min-w-0 rounded-sm', FOCUS_RING_CLASSES);

/**
 * 下端（版表記 + 本人）。
 * ✅ **2026-10-13: メッセージの箱（`可能性を、もっとシンプルに。`）を外した**（人間の指示
 *    「サイドバーの下の『可能性を、もっとシンプルに。』ってパーツはいらない」）。
 *    ⚠️ 文言キー `shell.sidebar.note` / `shell.sidebar.tagline` は**カタログに残す**
 *    （`tests/static/i18n-key-freeze.test.ts`: 追加は可、改名と削除は不可）。
 * 🔴 **器そのものは畳んだ形態でも畳まない**（アバターは 56px の柱にも入る）。畳むのは
 *    版の行と氏名・所属の語だけである。
 */
const SIDEBAR_FOOT_CLASSES = 'mt-auto pt-6';
const SIDEBAR_FOOT_VERSION_CLASSES = 'm-0 px-3 pb-2 text-cell text-sidebar-fg-muted';
/**
 * 本人の箱（`SidebarAccount`）。🔴 **上に罫線**（人間のモックアップ）。
 * 🔴 `px-3` は群と同じ値なので、**畳んだ柱ではアバター（32px）がちょうど中央に来る**
 *    （56 − 12 × 2 = 32）。
 */
const SIDEBAR_ACCOUNT_CLASSES = 'flex flex-col gap-1 border-t border-sidebar-border px-3 pt-3';
const SIDEBAR_ACCOUNT_ORG_CLASSES = 'm-0 truncate text-micro text-sidebar-fg-muted';
const SIDEBAR_ACCOUNT_ROW_CLASSES = 'flex items-center gap-2';
const SIDEBAR_ACCOUNT_NAME_CLASSES = 'min-w-0 truncate text-row text-sidebar-fg';

/**
 * 開閉トグルの見た目。
 *
 * 🔴 **`IconButton` を使えない** —— `<button>` は押しても何も起きない（ハンドラを持てば
 *    `'use client'` になる）。**見た目は `IconButton` と同じ 1 実装から取る**
 *    （`ICON_CONTROL_CLASSES`。同じ見た目のローカル実装を 2 つ作らない。SP-21 `T-21-02` ①）。
 * 🔴 フォーカスリングは**隣の `<input>`（`peer`）から**当てる —— 実際にフォーカスを受けるのは
 *    `sr-only` の `<input>` であり、`<label>` は受けない。リングが無いとキーボードで
 *    トグルの位置を見失う（§7.10 の focus-visible は全プリミティブで同一）。
 */
const SIDEBAR_TOGGLE_CLASSES = cn(
  ICON_CONTROL_CLASSES,
  // ✅ **2026-10-13: 濃色側のトークンによる上書きを外した。** トグルが載っているのは
  //    **白い帯**（`SIDEBAR_HEAD_CLASSES`）になったので、`ghost` の既定（`--color-fg` /
  //    `--color-bg-subtle`）がそのまま正しい。🔴 **上書きを残すと、白地に `slate-100` の
  //    アイコンが載って見えなくなる**（2026-10-02 とちょうど逆向きの事故）。
  // 🔴 右端に寄せる（**広げているときの × は右上**。2026-10-13 の人間の指示）。畳んだときは
  //    自由幅が 0 なので `ml-auto` は効かず、帯の中央に収まる（`SIDEBAR_HEAD_CLASSES` の 🔴）。
  'ml-auto cursor-pointer',
  'peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2',
);

/**
 * 群。🔴 **区切りは線ではなく余白**（`mt-4`）で表す（罫線を増やして画面を分割しない）。
 * 最初の群（ホーム）には余白を付けない。
 */
const SIDEBAR_GROUP_CLASSES = 'flex flex-col gap-1.5 px-3';
const SIDEBAR_GROUP_SPACED_CLASSES = 'mt-7 flex flex-col gap-1.5 px-3';
/**
 * 🔴 **罫線で区切る群**（✅ 2026-10-13。人間の指示「区切り線を入れる。その他と入れる」）。
 *
 * ⚠️ **この部品の条文 3 は「区切りは線ではなく余白 + 小さな群名で表す」である。** 人間が
 *    モックアップ付きで線を指示したので**その 1 箇所だけ**例外にする。🔴 **既定を変えたのでは
 *    ない** —— 群が増えるたびに線を足すと、条文が守ろうとしていた「罫線で画面を分割しない」が
 *    崩れる。線を引くかどうかは**呼び出し側が群ごとに明示する**（`SidebarGroup.divided`）。
 * 🔴 **面ごとに色が違う**（濃色の柱 = `--color-sidebar-border` / 白地の「その他」= `--color-border`）。
 *    濃色側の線を白地に出すと黒い罫線になる。
 * ⚠️ `--color-sidebar-border` は 3:1 を満たさない（`design-tokens.test.ts` が事実として固定して
 *    いる）。**区切りは装飾であって情報ではない**（情報は群名が持つ）ので、これでよい。
 */
const SIDEBAR_GROUP_DIVIDED_CLASSES: Readonly<Record<SidebarVariant, string>> = {
  sidebar: 'mt-5 flex flex-col gap-1.5 border-t border-sidebar-border px-3 pt-5',
  more: 'mt-5 flex flex-col gap-1.5 border-t border-border px-3 pt-5',
};

/**
 * 群名。🔴 **`--text-micro` + 補助色**（§7.3 の最小段）。
 * 🔴 アイコンのみの形態では語が消える（余白だけが残って区切りは保たれる）。
 * ✅ 2026-10-02: 面が 2 種類になったので variant ごとに補助色を持つ（濃色 =
 *    `--color-sidebar-fg-muted`（実測 6.64:1）/ 白地（「その他」）= `--color-fg-muted`）。
 * 🔴 **項目のラベルをこの色で描かない**（§7.9: `--sidebar-fg-muted` は 3:1 水準の非走査要素用）。
 */
const SIDEBAR_GROUP_LABEL_CLASSES: Readonly<Record<SidebarVariant, string>> = {
  sidebar: 'mb-1 px-2 text-micro text-sidebar-fg-muted',
  more: 'mb-1 px-2 text-micro text-fg-muted',
};

/**
 * 1 項目の行。🔴 **密に**（`docs/04` §7.1 の「一覧はファーストビューに 12 行以上」と同じ思想で、
 * 16 項目が縦に走査できる高さにする）。
 *
 * ✅ **2026-10-04: 左端 2px の場所取り（`border-l-2 border-l-transparent`）をやめた** ——
 *    現在地の色帯を外した（上の 6）ので、**取る場所が無い**。🔴 帯を外したうえで透明な
 *    2px を残すと、全項目が 2px だけ右へずれたまま理由の無い余白を持つ。
 *    🔴 **選択で行がずれないという §7.10 の性質は保たれている**（現在地と既定の差は
 *    背景色と文字色だけであり、box の寸法を 1px も変えない）。
 * - 🔴 hover は**背景の色変化だけ**（150ms）。拡大・浮き上がり・影・下線を出さない（§7.10）。
 */
const SIDEBAR_ITEM_BASE_CLASSES = cn(
  // ✅ **2026-10-13（`docs/design-system.md` §4）: 184 × 46 / radius 8 / padding-left 16 /
  //    アイコン↔語 gap 12 / 語 15・500。** 幅は「サイドバー 208 − 群の左右 margin 12 × 2」。
  // 🔴 **左右の padding はここに置かない**（下の `SIDEBAR_RAIL_ITEM_CLASSES` / `more` 側が持つ）。
  `flex items-center gap-3 rounded-md text-row font-medium ${SIDEBAR_NAV_ITEM_HEIGHT_CLASS}`,
  TRANSITION_CLASSES,
);

/**
 * 🔴 **畳んだ形態では項目を中央に寄せる**（✅ 2026-10-13。人間の指摘「サイドバーを閉じたときの
 * ハイライト位置がずれている。ハイライトが左に寄ってるように見える」）。
 *
 * 🔴 **原因は `padding-left: 16px` が形態によらず効いていたことである。** 畳んだ柱（56px）では
 *    群の左右 12px を引いた **32px が項目の幅**になるが、そこに `px-4`（左右 16px）が当たるため
 *    **アイコン（16px）は項目の右端に押し出され**、ハイライトの箱だけが左に 16px はみ出して
 *    見えていた（実測: 柱 0–56 / 箱 12–44 / アイコン 28–44 ＝ 柱の中心 28 に対して +8 ずれ）。
 * 🔴 **直し方は「右に幅を足す」ではなく「畳んだときは padding を外して中央寄せ」**である ——
 *    幅を足すと**広げた形態の 184 × 46**（`docs/design-system.md` §4）が動く。
 * 🔴 **4 クラスの規則**（ファイル冒頭の 🔴）で書く。`xl` 以上と未満で**既定の形態が逆**なので、
 *    `justify-*` と `px-*` の両方を 4 状態ぶん書かないと、どちらかの幅で必ず崩れる。
 * ⚠️ **広げた形態の右の padding は 8px**（`pr-2`）である。`docs/design-system.md` §4 が定めて
 *    いるのは **`padding-left: 16`** だけであり、右を 16 にすると
 *    **`Phase 2` Badge を持つ項目（`お知らせ`）で語が `お知...` に切れる**（実測）。
 *    語はナビの主役なので、**余白のほうを詰める。**
 */
const SIDEBAR_RAIL_ITEM_CLASSES =
  'justify-center group-has-checked:justify-start group-has-checked:pl-4 group-has-checked:pr-2 ' +
  'xl:justify-start xl:pl-4 xl:pr-2 xl:group-has-checked:justify-center xl:group-has-checked:px-0';
/**
 * 1 項目のリンク。
 *
 * ✅ **2026-10-02: variant ごとに面が違う**（`sidebar` = 濃色の柱 / `more` = 白地のパネル）。
 * 🔴 **同じ定数に 2 つの面を混ぜない** —— 濃色側に `hover:bg-bg-subtle`（白）が 1 つ残ると、
 *    ポインタを乗せた瞬間に行が白く光る。
 * 🔴 **濃色側は `active` を持たない。** §7.10 の active は「背景をもう 1 段暗く」だが、
 *    §7.9 改訂 23 が定めた濃色の 8 トークンに**その 1 段が無い**（`--sidebar-hover-bg` までしか
 *    無い）。🔴 **階調を実装側で作らない**（`U-25`）ので、**段を増やすには §7.9 の改訂（人間の
 *    判断）を要する**。ナビ項目は押した瞬間に遷移するリンクであり、押下中の面の差が無くても
 *    「押せたかどうか」は遷移そのものが返す。
 */
const SIDEBAR_LINK_CLASSES: Readonly<Record<SidebarVariant, string>> = {
  sidebar: cn(
    SIDEBAR_ITEM_BASE_CLASSES,
    SIDEBAR_RAIL_ITEM_CLASSES,
    'text-sidebar-fg hover:bg-sidebar-hover-bg',
    FOCUS_RING_CLASSES,
  ),
  // 🔴 「その他」のパネルは**常に広げた形**なので、左右 16px を素のまま持つ。
  more: cn(SIDEBAR_ITEM_BASE_CLASSES, 'px-4 text-fg hover:bg-bg-subtle active:bg-bg-inset', FOCUS_RING_CLASSES),
};
/** 🔴 未実装の項目（`<span>`）。押せないので hover を持たない。 */
const SIDEBAR_UNAVAILABLE_CLASSES: Readonly<Record<SidebarVariant, string>> = {
  sidebar: cn(SIDEBAR_ITEM_BASE_CLASSES, SIDEBAR_RAIL_ITEM_CLASSES, 'text-sidebar-fg-muted'),
  more: cn(SIDEBAR_ITEM_BASE_CLASSES, 'px-4 text-fg-muted'),
};
/**
 * 🔴 現在地 = 背景 + 文字色の **2 点**（§7.10 の selected）。**太字だけで示さない。**
 *
 * ✅ **2026-10-04（人間の明示指示）: 左端 2px の色帯を外した。** 残したのは背景と文字色であり、
 *    **これが無いと現在地が分からなくなる**ので外さない。⚠️ `docs/04` §3.1 / §7.10 の「3 点」との
 *    食い違いは完了報告で申し送る（本タスクは `docs/**` を触らない）。
 *
 * 🔴 **`hover:` を selected の色で塗り直す。** `SIDEBAR_LINK_CLASSES.sidebar` が持つ
 *    `hover:bg-sidebar-hover-bg`（特異度 0,2,0）は `bg-sidebar-selected-bg`（0,1,0）より強く、
 *    そのままでは**現在地の項目にポインタが乗った瞬間に背景が hover 色に置き換わる**。
 *    §7.10 の組み合わせ優先順は `selected > active > hover` であり、
 *    「hover と selected を同じ見た目にしない」（`lib/state-classes.ts` の 🔴）に反する。
 * ⚠️ 塗り直しの語は `hover:bg-sidebar-hover-bg` と**同特異度**なので、勝敗は生成 CSS の順序が
 *    決める（`cn` の並びではない）。その順序は
 *    `tests/static/sidebar-form-css-order.test.ts` がビルド出力上で固定している。
 *    ✅ 2026-10-02: 語が `bg-bg-subtle` / `bg-brand-bg` から濃色のトークンに替わったので、
 *    あちらの照合対象も同時に更新した（**順序を見るという判定は 1 つも変えていない**）。
 */
const SIDEBAR_CURRENT_CLASSES = cn(
  SIDEBAR_LINK_CLASSES.sidebar,
  // ✅ 2026-10-02: 濃色の面の selected（`SELECTED_CLASSES` の白地版は使えない —— `bg-brand-bg`
  //    （`indigo-50`）は濃色の上では「明るい帯」になり、現在地が**最も強い要素**になってしまう）。
  // ✅ 2026-10-04: 左端 2px（`border-l-sidebar-selected-bar`）を外した（人間の明示指示）。
  'bg-sidebar-selected-bg text-sidebar-selected-fg',
  'hover:bg-sidebar-selected-bg',
);

/**
 * ラベル（**見える語**）。
 * 🔴 アイコンのみの形態では消える（上の 4 クラスの規則）。「その他」の一覧では常に見える。
 * 🔴 `aria-hidden` を立てる —— 読み上げに出すのは隣の `sr-only` の写しである（下の 🔴）。
 */
const SIDEBAR_LABEL_CLASSES: Readonly<Record<SidebarVariant, string>> = {
  sidebar: 'min-w-0 truncate hidden group-has-checked:block xl:block xl:group-has-checked:hidden',
  more: 'min-w-0 truncate',
};

/**
 * 項目の右に添えるもの（`Phase N` / 期限バッジ）。ラベルと同じ規則で出し入れする。
 * 🔴 **アイコンのみの形態ではここが消える。** 期限バッジの代わりに点を出す（`SIDEBAR_DOT_CLASSES`）。
 */
const SIDEBAR_MARK_CLASSES: Readonly<Record<SidebarVariant, string>> = {
  sidebar: 'ml-auto hidden group-has-checked:block xl:block xl:group-has-checked:hidden',
  more: 'ml-auto',
};

/** 期限バッジ（🔴 注意色 = 「直せば / 動けば進む」もの。§7.4）。 */
const SIDEBAR_BADGE_CLASSES = 'ml-1';

/**
 * 注記（`案件から開きます` / `提案から開きます`）。✅ 2026-10-02 で面ごとに分けた。
 * 🔴 **`Phase N` とは別物である**（あちらは無彩色の `Badge`。`ItemMarks`）。
 */
const NOTE_CLASSES: Readonly<Record<SidebarVariant, string>> = {
  sidebar: 'text-micro text-sidebar-fg-muted',
  more: 'text-micro text-fg-muted',
};

/**
 * 🔴 **アイコンのみの形態でだけ現れる**（上のラベル / 印の 4 クラスの**裏返し**。優先順の理屈は
 *    ファイル冒頭の 🔴 と同じで、特異度 (0,2,0) 側が (0,1,0) 側に勝つ）。
 */
const SIDEBAR_ICON_ONLY_CLASSES = 'block group-has-checked:hidden xl:hidden xl:group-has-checked:block';

/**
 * 🔴 **広げている形態でだけ現れる**（上の裏返し。`SIDEBAR_LABEL_CLASSES.sidebar` と同じ 4 クラス）。
 *
 * 🔴 **語を持たない要素のための定数である**（ロゴ / `×` のアイコン）。`SIDEBAR_LABEL_CLASSES` は
 *    `truncate` を併せ持っており、画像やアイコンに当てると `text-ellipsis` が無意味に付く。
 * 🔴 **文字列リテラルで書く** —— Tailwind の走査は組み立てたクラス名を拾えない（冒頭の 🔴）。
 */
const SIDEBAR_EXPANDED_ONLY_CLASSES =
  'hidden group-has-checked:block xl:block xl:group-has-checked:hidden';

/**
 * 期限バッジを持つ項目の**点（dot）**。アイコンの右上に出す。
 *
 * 🔴 **なぜ点が要るか**: `SIDEBAR_MARK_CLASSES.sidebar` はアイコンのみの形態で `Phase N` / 注記と
 *    一緒に**期限バッジも隠す**。`xl` 未満は既定でアイコンのみなので、そのままだと
 *    **1024–1279px の取引先利用者は既定で返答期限を見られない** —— 取引先は 1 日 4〜5 時間の
 *    主利用者である（`CLAUDE.md` §1.2）。
 * 🔴 **点は件数も期限の文字も出さない**（`CLAUDE.md` §3.1 / `F-004 AC-4`）。伝えるのは
 *    「注意すべきものがある」だけで、語は隣の `sr-only` が持つ。
 * 🔴 色は注意色（「直せば / 動けば進む」= 期限。§7.4）。**赤にしない。**
 *    ✅ 2026-10-02: 濃色の面では **`--color-warning-bg`（`amber-50`）** を使う ——
 *    `--color-warning`（`amber-800`）は `--color-sidebar-bg`（`slate-900`）に対して 3:1 を割り、
 *    **8px の点が見えない**（`design-tokens.test.ts` が濃色の組を実測で固定している）。
 *    🔴 **系統（注意 = 橙）は変えていない**。変えたのは面の階調だけである
 *    （点は「文字」ではなく「面」であり、`--color-warning-bg` はその系統の面の色である）。
 * 🔴 **`Phase N` の無彩色 Badge には点を出さない** —— あれは「まだ無い」であって
 *    「対応が要る」ではない（点が出るのは `badge` を持つ項目だけ）。
 * ⚠️ `rounded-sm`（4px）は 8px の箱では真円になる。§7.9 の radius は 2 段だけで
 *    `rounded-full` はアバターとカウンタに限られるため、段の中で円を作る。
 */
const SIDEBAR_DOT_CLASSES = cn(
  'absolute top-0 right-0 size-2 rounded-sm bg-warning-bg',
  SIDEBAR_ICON_ONLY_CLASSES,
);
/** 点に添える読み上げの語。🔴 **点と同じ形態のときだけ読み上げに出す**（展開形ではバッジが読まれる）。 */
const SIDEBAR_DOT_LABEL_CLASSES = cn('sr-only', SIDEBAR_ICON_ONLY_CLASSES);
/** 点を載せるために `<svg>` を包む器（`Icon` の 16px がそのまま位置の基準になる）。 */
const SIDEBAR_DOT_ANCHOR_CLASSES = 'relative flex shrink-0';

// ============================================================================
// 現在地の射程（🔴 判定そのものは `../lib/current-nav-path.ts` の 1 実装）
// ============================================================================
/**
 * その項目が現在地になるパスの全体（**自分の遷移先 + 第 2 階層 / 索引の射程**）。
 *
 * 🔴 **`variant === 'more'` では空を返す**（「その他」のパネルは現在地を表さない。パネルは
 *    開いた瞬間だけ出る一覧であり、柱と同じ選択表示を二重に置くと「どちらが現在地か」が
 *    2 箇所になる）。空を返すことで、**クライアント側の上書きでも現在地にならない。**
 * 🔴 **射程を部品側で推測しない**（`SidebarItem.sectionPaths` の 🔴）。
 */
function navMatchPaths(item: SidebarItem, variant: SidebarVariant): readonly string[] {
  if (variant !== 'sidebar' || item.reach.kind !== 'LINK') return [];
  return [item.reach.href, ...(item.sectionPaths ?? [])];
}

// ============================================================================
// 描画
// ============================================================================

function ItemMarks({ item, variant }: { readonly item: SidebarItem; readonly variant: SidebarVariant }) {
  if (item.phase === null && item.badge === null && item.note === null) return null;
  return (
    <span className={SIDEBAR_MARK_CLASSES[variant]}>
      {/* 注記（`案件から開きます`）。✅ 2026-10-02: 面ごとに補助色を替える（濃色の柱で
          `--color-fg-muted`（`slate-500`）は 2.3:1 まで落ちて読めない）。 */}
      {item.note === null ? null : (
        <span className={variant === 'sidebar' ? NOTE_CLASSES.sidebar : NOTE_CLASSES.more}>{item.note}</span>
      )}
      {item.phase === null ? null : (
        <Badge
          variant="neutral"
          // 🔴 **柱では左右の余白を詰める**（既定は `px-3`）。柱の 1 行は 184px しか無く、
          //    既定のままだと `Phase 2` が **`お知らせ` の語を `お知...` に押し潰す**（実測）。
          //    ⚠️ 変えているのは余白だけで、**色（無彩色）と語は 1 実装のまま**である。
          className={variant === 'sidebar' ? 'px-2' : undefined}
          data-testid={variant === 'sidebar' ? `app-nav-phase-${item.id}` : `app-more-nav-phase-${item.id}`}
        >
          {item.phase}
        </Badge>
      )}
      {item.badge === null ? null : (
        <Badge
          variant="warning"
          className={SIDEBAR_BADGE_CLASSES}
          data-testid={
            variant === 'sidebar' ? 'app-nav-proposal-requests-due' : 'app-more-nav-proposal-requests-due'
          }
        >
          <span className="sr-only">{item.badge.label}</span>
          {item.badge.text}
        </Badge>
      )}
    </span>
  );
}

/**
 * 1 項目。
 *
 * 🔴 **ラベルを 2 つ描く**（見える語 + `sr-only` の写し）。アイコンのみの形態では見える語が
 *    `display: none` になり**読み上げからも消える**ため、語が消えない写しが要る（§3.1 の
 *    「アイコンのみの形態では `title` と `aria-label` に日本語ラベルを必ず持たせる」）。
 *    🔴 `aria-label` を要素に置く形は採らない —— 置くと**子孫の読み上げが打ち消され、
 *    期限バッジ（`最も近い返答期限 残り 2 日`）が読み上げから消える。**
 */
function SidebarEntry({
  item,
  variant,
  currentPath,
  linkComponent,
}: {
  readonly item: SidebarItem;
  readonly variant: SidebarVariant;
  readonly currentPath: string;
  readonly linkComponent: ComponentType<SidebarLinkProps>;
}) {
  // 🔴 アイコンのみの形態では `ItemMarks` が消えるので、**期限バッジの代わりに点**を出す
  //    （`SIDEBAR_DOT_CLASSES` の 🔴）。「その他」（`more`）の一覧は常に語が見えるので不要である。
  const dot = variant === 'sidebar' ? item.badge : null;
  const body = (
    <>
      {dot === null ? (
        <Icon name={item.icon} />
      ) : (
        <span className={SIDEBAR_DOT_ANCHOR_CLASSES}>
          <Icon name={item.icon} />
          <span
            className={SIDEBAR_DOT_CLASSES}
            aria-hidden="true"
            data-testid="app-nav-proposal-requests-due-dot"
          />
        </span>
      )}
      <span className="sr-only">{item.label}</span>
      {dot === null ? null : <span className={SIDEBAR_DOT_LABEL_CLASSES}>{dot.dotLabel}</span>}
      <span className={SIDEBAR_LABEL_CLASSES[variant]} aria-hidden="true">
        {item.label}
      </span>
      <ItemMarks item={item} variant={variant} />
    </>
  );
  if (item.reach.kind === 'UNAVAILABLE') {
    // 🔴 未実装・単独の URL を持たない画面。項目は出すが**リンクにしない**（404 を作らない）。
    return (
      <li>
        <span
          className={SIDEBAR_UNAVAILABLE_CLASSES[variant]}
          aria-disabled="true"
          title={item.label}
          data-testid={variant === 'sidebar' ? `app-nav-${item.id}` : `app-more-nav-${item.id}`}
        >
          {body}
        </span>
      </li>
    );
  }
  // 🔴 現在地は 2 段で決まる（ファイル冒頭の 6b）: ここで計算するのは**初回描画（水和前）**の
  //    ぶんだけであり、クライアントでは `linkComponent`（島）が `matchPaths` から作り直す。
  const matchPaths = navMatchPaths(item, variant);
  const current = matchesCurrentNavPath(currentPath, matchPaths);
  const Link = linkComponent;
  return (
    <li>
      <Link
        className={SIDEBAR_LINK_CLASSES[variant]}
        // 🔴 「その他」（`more`）は現在地の表現を持たない（`navMatchPaths` の 🔴）。
        currentClassName={variant === 'sidebar' ? SIDEBAR_CURRENT_CLASSES : undefined}
        matchPaths={matchPaths}
        href={item.reach.href}
        title={item.label}
        aria-current={current ? 'page' : undefined}
        data-testid={variant === 'sidebar' ? `app-nav-${item.id}` : `app-more-nav-${item.id}`}
      >
        {body}
      </Link>
    </li>
  );
}

export type SidebarNavListProps = {
  readonly groups: readonly SidebarGroup[];
  readonly variant: SidebarVariant;
  readonly currentPath: string;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
};

/**
 * 群と項目の一覧。🔴 **サイドバーと「その他」が同じ関数を通る**（2 本持つと、どちらかにだけ
 *    項目が増えた状態が必ず生まれる。`docs/04` §3.4「業務ループの順序は『その他』の中で保つ」）。
 */
export function SidebarNavList({
  groups,
  variant,
  currentPath,
  linkComponent = SidebarDefaultLink,
}: SidebarNavListProps) {
  return (
    <>
      {groups.map((group, index) => (
        <div
          key={group.id}
          className={
            index === 0
              ? SIDEBAR_GROUP_CLASSES
              : group.divided === true
                ? SIDEBAR_GROUP_DIVIDED_CLASSES[variant]
                : SIDEBAR_GROUP_SPACED_CLASSES
          }
          data-sidebar-group={group.id}
        >
          {group.label === null ? null : (
            <p
              className={cn(SIDEBAR_GROUP_LABEL_CLASSES[variant], SIDEBAR_LABEL_CLASSES[variant])}
              data-testid={variant === 'sidebar' ? `app-nav-${group.id}` : `app-more-nav-${group.id}`}
            >
              {group.label}
            </p>
          )}
          <ul>
            {group.items.map((item) => (
              <SidebarEntry
                key={item.id}
                item={item}
                variant={variant}
                currentPath={currentPath}
                linkComponent={linkComponent}
              />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export type SidebarProps = {
  /**
   * 🔴 **`null` ならロゴのブロックを描かない。** 管理平面（`/admin`。§10）は主平面とは別の外枠で
   *    あり、デザインシステム v1.0 の射程外である（運営者の画面に製品のタグラインは要らない）。
   */
  readonly brand?: SidebarBrand | null;
  /** 🔴 **`null` なら本人の箱を描かない**（`SidebarAccount` の 🔴）。 */
  readonly account?: SidebarAccount | null;
  readonly groups: readonly SidebarGroup[];
  /**
   * **初回描画（水和前）の現在地**（🔴 `next/navigation` を使わない。`docs/05` §2.3.1）。
   * 🔴 クライアントでは `linkComponent` の島が `usePathname()` で上書きする（ファイル冒頭の 6b）。
   */
  readonly currentPath: string;
  readonly labels: SidebarLabels;
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
};

export function Sidebar({
  brand = null,
  account = null,
  groups,
  currentPath,
  labels,
  linkComponent: BrandLink = SidebarDefaultLink,
}: SidebarProps) {
  return (
    <div className={SIDEBAR_SHELL_CLASSES}>
      <nav className={SIDEBAR_CLASSES} aria-label={labels.nav} data-testid="app-sidebar">
        <div className={SIDEBAR_HEAD_CLASSES}>
          <div className={SIDEBAR_HEAD_ROW_CLASSES}>
            {/* 🔴 開閉の状態はここ 1 つだけが持つ（JS を使わない。ファイル冒頭の 🔴）。 */}
            <input
              id={SIDEBAR_TOGGLE_ID}
              type="checkbox"
              className="peer sr-only"
              aria-label={labels.toggle}
              data-testid="app-sidebar-toggle"
            />
            {brand === null ? null : (
              <BrandLink
                className={cn(SIDEBAR_BRAND_LINK_CLASSES, SIDEBAR_EXPANDED_ONLY_CLASSES)}
                href={brand.homeHref}
                data-testid="app-header-wordmark"
              >
                <BrandLogo src={brand.logoSrc} alt={brand.logoAlt} />
              </BrandLink>
            )}
            <label
              htmlFor={SIDEBAR_TOGGLE_ID}
              className={SIDEBAR_TOGGLE_CLASSES}
              data-testid="app-sidebar-toggle-control"
            >
              {/* ✅ **2026-10-13（人間の指示）: トグルが形態そのものを図で返す。**
                畳んでいる = ハンバーガー（押すと開く）/ 広げている = `×`（押すと閉じる）。
                🔴 **`panel-left` の 1 枚だけにしない** —— 同じ図のままだと「いま押すと開くのか
                   閉じるのか」が図から読めず、**既定の形態が幅で変わる**ぶん余計に分からない
                   （ファイル冒頭の「チェックの意味は『既定と逆の形態にする』」）。
                🔴 **語（`labels.toggle`）は方向を断定しない**ままである（同）—— 読み上げは
                   `<input>` 側の `aria-label` が持ち、ここの 2 枚は装飾ではなく**状態の図**である。 */}
              <Icon name="menu" className={SIDEBAR_ICON_ONLY_CLASSES} />
              <Icon name="x" className={SIDEBAR_EXPANDED_ONLY_CLASSES} />
            </label>
          </div>
        </div>
        <SidebarNavList
          groups={groups}
          variant="sidebar"
          currentPath={currentPath}
          linkComponent={BrandLink}
        />
        {/* 🔴 下端（§3.1）= 版 + 本人。版と語は畳んだ形態で消え、**アバターだけが残る**。 */}
        {brand === null && account === null ? null : (
          <div className={SIDEBAR_FOOT_CLASSES} data-testid="app-sidebar-foot">
            {brand === null ? null : (
              <p className={cn(SIDEBAR_FOOT_VERSION_CLASSES, SIDEBAR_EXPANDED_ONLY_CLASSES)}>
                {brand.version}
              </p>
            )}
            {account === null ? null : (
              <div className={SIDEBAR_ACCOUNT_CLASSES} data-testid="app-sidebar-account">
                {/* 🔴 所属は補助色の 1 行（`docs/04` §3.2 のスコープ表示と同じ役割）。 */}
                <p className={cn(SIDEBAR_ACCOUNT_ORG_CLASSES, SIDEBAR_EXPANDED_ONLY_CLASSES)}>
                  {account.organizationName}
                </p>
                <div className={SIDEBAR_ACCOUNT_ROW_CLASSES}>
                  {/* 🔴 `Avatar` は `aria-hidden` の装飾である（読み上げは隣の氏名が持つ）。 */}
                  <Avatar initials={account.initials} title={account.userName} />
                  <span className={cn(SIDEBAR_ACCOUNT_NAME_CLASSES, SIDEBAR_EXPANDED_ONLY_CLASSES)}>
                    {account.userName}
                  </span>
                  {/* 🔴 畳んだ形態では語が `display:none` になり**読み上げからも消える**ので、
                      消えない写しを置く（項目のラベルと同じ理由。この部品の 🔴）。 */}
                  <span className={cn('sr-only', SIDEBAR_ICON_ONLY_CLASSES)}>
                    {account.organizationName} {account.userName}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </nav>
    </div>
  );
}
