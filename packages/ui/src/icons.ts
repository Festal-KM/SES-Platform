// packages/ui/src/icons.ts
// 🔴 **`lucide-react` の唯一の入口**（`docs/05` §2.3.3 / §17.7.1 (i)①。SP-22 `T-22-05`）。
//
// ============================================================================
// 🔴 なぜ 1 本に閉じるのか
// ============================================================================
// `docs/04` §3.1 / §7.5 / §11-22 は、アイコンについて 3 つを定めている。
//
//   ① **セットを 1 つに固定する**（画面ごとに別のセットを混ぜない。線の太さ・視覚重量が
//      揃っていないと、同じ大きさでも重さが違って「偶然の強調」が生まれる）
//   ② 🔴 **比喩アイコン（きらめき / 稲妻 / ロケット / 脳 / 電球）を使わない**
//   ③ **使ってよい場所は 3 つだけ**（テキストなしで意味が通る操作 / 同種項目の視覚的な弁別 /
//      グローバルナビの全項目）。🔴 **見出し・ボタン・状態バッジ・管理平面の横並びタブには
//      付けない**（アイコンの有無そのものが平面の差になる）
//
// 画面から `lucide-react` を直接 import できるなら、この 3 つは「気をつける」に戻る。
// 🔴 **写像に無い名前が型エラーになること**が唯一の構造的な担保である。
// 機械検査は `tests/static/ui-dependency-single-path.test.ts` (i)①（この 1 ファイルの外に
// `lucide-react` の import が無い）。
//
// ============================================================================
// 🔴 `docs/04` §3.1 の表との突き合わせ（**キーは表のアイコン名をそのまま写す**）
// ============================================================================
// 🔴 **キー（`IconName`）は `docs/04` §3.1 の表の綴りである。** 実装が参照する lucide の
//    コンポーネント名は upstream の改名で表と食い違うものが 3 つあるので、下表に記録する
//    （`packages/ui` の他の部品と同じ「upstream との突き合わせ表」の作法。照合日 2026-09-30 /
//    `lucide-react` 0.577.0）。🔴 **表の綴りを実装に合わせて書き換えない** —— 一次資料は
//    `docs/04` §3.1 であり、キーが動くと「表と 1 対 1」を機械で確かめられなくなる。
//
// | `docs/04` §3.1 の名前 | lucide 0.577.0 の export | 理由 |
// |---|---|---|
// | `home` | `House` | upstream が `home` を `house` に改名し、旧名の別名を削除した（同じ絵） |
// | `file-signature` | `FilePenLine` | 同上（`file-signature` → `file-pen-line`） |
// | `bar-chart-3` | `ChartColumn` | 同上（`bar-chart-3` → `chart-column`） |
//
// 🔴 **表に無いアイコンを足さない。** 表の外に在るのは次の 6 つだけである。
//
//  (1) §7.5 の**許可①（テキストなしで意味が通る操作）**の 3 つ:
//      - `panel-left` … サイドバーの開閉トグル（§3.1「上端は開閉トグルだけ」）
//      - `menu` … モバイルのボトムタブの「その他」（§3.4。ラベルは 3 文字に切り詰まっており
//        アイコンが弁別の主役になる）
//      - `eye` … 🔴 **要対応キューの行の `内容を見る`（`Drawer`）**（✅ T-22-10 で追加）。
//        §7.5 の許可① の列挙が **「閉じる / 展開・折りたたみ / 並び替え / コピー / 外部リンク /
//        検索 / 行の `内容を見る`（`Drawer`）」** と名指ししている操作であり、`docs/05` §2.3.3 も
//        本ファイルの中身を「ナビ項目のアイコン + 操作アイコン（閉じる / 展開 / コピー /
//        **`内容を見る`** / 並び替え / 検索）」と定めている。**新しい用途の区分を作ったのではなく、
//        既に許可されている操作にアイコンを与えただけ**である。
//        🔴 **比喩ではない**（§7.5 の禁止は きらめき / 稲妻 / ロケット / 脳 / 電球）—— 目は
//        「見る」そのものを指し、語（`内容を見る`）と 1 対 1 である。
//        🔴 **他の意味で使い回していない**（§3.1。1 アイコン = 1 項目）。
//  (2) 🔴 **§3.1 の表が `設定` の 1 行に畳んでいる 3 画面**の 3 つ（`mail` / `archive` / `scroll-text`）。
//      表は `設定` の中身を 4 項目（取引先企業 / 利用量と上限 / スキル辞書 / 組織設定）しか
//      列挙していないが、**リポジトリにはこの 3 画面（`S-036` 送信ドメイン / `S-042` データの返却と
//      保持期間 / `S-041` 監査ログ）が実在し、ナビが唯一の入口である**
//      （`apps/web/lib/shell/nav.ts` の `settingsChildren` の 🔴。`T-12-20` で人間のレビューを通った
//      判断であり、`T-22-05` の受け入れ基準 1「ロール別の項目集合が 1 つも変わっていない」により
//      **項目を減らせない**）。🔴 **項目を増やしたのではなく、実在する項目にアイコンを与えただけ**である。
//      🔴 **いずれも比喩ではなく対象そのものを指す**（封筒 = 送信ドメイン / 箱 = データの返却と保持 /
//      巻物 = 記録）。§7.5 の禁止（きらめき / 稲妻 / ロケット / 脳 / 電球）に当たらない。
//      🔴 **同じアイコンを別の意味で使い回していない**（§3.1。17 + 6 = 23 個すべてが 1 項目に固定）。
//
// 🔴 これ以外を足すときは `docs/04` の改訂（= 人間の判断。`CLAUDE.md` §8.6）を経る。
import { createElement } from 'react';
import {
  Archive,
  BookOpen,
  Briefcase,
  Building2,
  CalendarClock,
  ChartColumn,
  Clock,
  Eye,
  FilePenLine,
  Gauge,
  Handshake,
  House,
  Inbox,
  ListChecks,
  Mail,
  Menu,
  MessageSquare,
  PanelLeft,
  ScrollText,
  Search,
  Send,
  Settings,
  Share2,
  UserSearch,
  Users,
} from 'lucide-react';
import { cn } from './lib/cn.js';

/**
 * 🔴 **閉じた写像。** キーは `docs/04` §3.1 の表のアイコン名（+ 許可① の 3 つ）。
 *
 * 🔴 `as const satisfies` にすることで、**キーの集合がそのまま型になる**（`IconName`）。
 *    写像に無い名前を渡した呼び出しは型エラーになる。
 */
export const ICONS = {
  // ── `docs/04` §3.1 の表（グローバルナビの全項目。上から表の順）
  home: House,
  users: Users,
  'share-2': Share2,
  briefcase: Briefcase,
  'user-search': UserSearch,
  send: Send,
  inbox: Inbox,
  handshake: Handshake,
  'file-signature': FilePenLine,
  'calendar-clock': CalendarClock,
  'message-square': MessageSquare,
  'list-checks': ListChecks,
  'bar-chart-3': ChartColumn,
  'building-2': Building2,
  gauge: Gauge,
  'book-open': BookOpen,
  settings: Settings,
  // ── 🔴 §3.1 の表が `設定` の 1 行に畳んでいる 3 画面（上の (2)）
  mail: Mail, // S-036 送信ドメインの設定と検証
  archive: Archive, // S-042 データの返却と保持期間
  'scroll-text': ScrollText, // S-041 監査ログ（自テナント）
  // ── §7.5 の許可①（テキストなしで意味が通る操作。上の (1)）
  'panel-left': PanelLeft,
  menu: Menu,
  eye: Eye, // ✅ T-22-10: 要対応キューの行の `内容を見る`（`Drawer`）
  // ✅ 2026-10-02: `GlobalSearchBox`（上部バーの検索の入口）。
  // 🔴 **§7.5 の許可① の列挙に「検索」が名指しで在り**、本ファイル冒頭の (1) も `docs/05` §2.3.3 も
  //    操作アイコンとして「検索」を挙げている。**新しい用途の区分を作ったのではなく、既に
  //    許可されている操作にアイコンを与えただけ**である（`eye` を足したときと同じ扱い）。
  // 🔴 **比喩ではない**（虫めがね = 検索そのもの）。🔴 **他の意味で使い回していない。**
  search: Search,
  // ✅ 2026-10-02（`docs/04` 改訂 23 / §7.5 の許可④）: ホームのセクション見出しと KPI カードの印。
  // 🔴 **§7.5 ④ が `clock` を名指しで列挙している**（`S-003` / `S-004` の `返信待ち`）。
  //    新しい用途の区分を作ったのではなく、**条文が挙げた名前にアイコンを与えただけ**である。
  // 🔴 **比喩ではない**（時計 = 時間が経っていること）。🔴 **他の意味で使い回していない。**
  clock: Clock,
} as const;

/** 🔴 写像に無い名前は**型エラー**になる（`docs/05` §17.7.1 (i)①）。 */
export type IconName = keyof typeof ICONS;

/**
 * 写像に在る名前の一覧（テストが `docs/04` §3.1 の表と突き合わせるために使う）。
 * 🔴 **宣言順 = 表の順**である（`Object.keys` はリテラルの順序を保つ）。
 */
export const ICON_NAMES = Object.keys(ICONS) as readonly IconName[];

/**
 * アイコン 1 つの寸法。
 *
 * 🔴 **既定は 16px（`size-4`）である。** 縦に 15〜16 項目が並ぶ列で 1 日に何十回も走査する道具
 *    （`docs/04` §11-22）であり、**大きさが項目ごとに違うと「偶然の強調」が生まれる**。
 *    `shrink-0` は狭い幅でアイコンが潰れないための当たり判定（`components/button.tsx` の
 *    `shrink-0` と同じ理由）。
 * 🔴 太さ（`strokeWidth`）を指定しない —— lucide の既定（24px グリッドで 2）をそのまま使う。
 *    セット内で視覚重量が揃っていることが ① の根拠であり、こちらで触ると揃わなくなる。
 */
export const ICON_CLASSES = 'size-4 shrink-0';

/**
 * 🔴 **寸法は 2 段だけ**（`docs/04` §7.9 の `--icon-sm` / `--icon-md`。✅ 改訂 23 で名前が付いた）。
 *    **リポジトリでアイコンの大きさを決めているのはここ 1 箇所である。**
 *
 * 🔴 **`@theme` のトークンにはできない。** 寸法の名前空間は Tailwind v4 に無く、`--icon-md` を
 *    宣言しても `size-icon-md` は 1 行も生成されない（`apps/web/app/tailwind.css` の食い違い表）。
 *    代わりに **`size` prop の閉じた union** にしてある ＝ 🔴 **段外は型エラーで書けない**
 *    （`<Icon size="lg" />` も `<Icon className="size-6" />` も通らない。後者は
 *    `tests/static/ui-shadow-and-size.test.ts` が落とす）。
 *
 * 🔴 **24px 以上を作らない**（装飾になる。§7.5）。
 * 🔴 **`md`（20px）を使ってよいのは `KpiCard` の角丸の四角の中だけ**である。
 *    ⚠️ `docs/04` §7.9 は「サイドバーの項目も `--icon-md`」とするが、**サイドバーは 16px のまま**に
 *    した —— 上の 🔴（15〜16 項目の列で大きさが揃っていること）が `T-22-05` の判断として
 *    記録されており、20px に上げると 56px 幅のアイコンのみ形態の重心も変わる。
 *    **食い違いは `docs/04` 側の訂正事項として報告する。**
 */
export const ICON_SIZE_CLASSES = {
  /** 16px … 行内 / ボタン内 / `SectionHeader` の見出し横 / グローバルナビの項目。 */
  sm: 'size-4',
  /** 20px … `KpiCard` の角丸の四角の中だけ。 */
  md: 'size-5',
} as const;

/** 🔴 段外（`lg` / 任意の px）は**型として存在しない**。 */
export type IconSize = keyof typeof ICON_SIZE_CLASSES;

export type IconProps = {
  readonly name: IconName;
  /** 🔴 既定は `sm`（16px）。`md` を使ってよい場所は上の 🔴 に限る。 */
  readonly size?: IconSize;
  readonly className?: string;
};

/**
 * アイコン 1 つ。
 *
 * 🔴 **意味はラベルが担い、アイコンは印にすぎない**（`docs/04` §7.5 / §11-22）。したがって
 *    `aria-hidden` を必ず立て、**読み上げには出さない** —— 語は項目のラベル
 *    （`title` / `aria-label`）が持つ（アイコンのみの形態でも意味が失われない。§3.1）。
 * 🔴 `focusable="false"` は IE 由来の保険ではなく、**SVG がタブ順に入らないこと**の明示である
 *    （入ると、ナビ 1 項目につきフォーカスが 2 回止まる）。
 */
export function Icon({ name, size = 'sm', className }: IconProps) {
  return createElement(ICONS[name], {
    // 🔴 `ICON_CLASSES`（= `sm` + `shrink-0`）を基底に置き、`size` が後から上書きする
    //    （`cn()` = `tailwind-merge` が同じ群を後勝ちで畳む。`lib/cn.ts`）。
    className: cn(ICON_CLASSES, ICON_SIZE_CLASSES[size], className),
    'aria-hidden': true,
    focusable: 'false',
  });
}
