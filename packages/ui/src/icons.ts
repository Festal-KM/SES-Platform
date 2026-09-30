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
// 🔴 **表に無いアイコンを足さない。** 表の外に在るのは次の 5 つだけである。
//
//  (1) §7.5 の**許可①（テキストなしで意味が通る操作）**の 2 つ:
//      - `panel-left` … サイドバーの開閉トグル（§3.1「上端は開閉トグルだけ」）
//      - `menu` … モバイルのボトムタブの「その他」（§3.4。ラベルは 3 文字に切り詰まっており
//        アイコンが弁別の主役になる）
//  (2) 🔴 **§3.1 の表が `設定` の 1 行に畳んでいる 3 画面**の 3 つ（`mail` / `archive` / `scroll-text`）。
//      表は `設定` の中身を 4 項目（取引先企業 / 利用量と上限 / スキル辞書 / 組織設定）しか
//      列挙していないが、**リポジトリにはこの 3 画面（`S-036` 送信ドメイン / `S-042` データの返却と
//      保持期間 / `S-041` 監査ログ）が実在し、ナビが唯一の入口である**
//      （`apps/web/lib/shell/nav.ts` の `settingsChildren` の 🔴。`T-12-20` で人間のレビューを通った
//      判断であり、`T-22-05` の受け入れ基準 1「ロール別の項目集合が 1 つも変わっていない」により
//      **項目を減らせない**）。🔴 **項目を増やしたのではなく、実在する項目にアイコンを与えただけ**である。
//      🔴 **いずれも比喩ではなく対象そのものを指す**（封筒 = 送信ドメイン / 箱 = データの返却と保持 /
//      巻物 = 記録）。§7.5 の禁止（きらめき / 稲妻 / ロケット / 脳 / 電球）に当たらない。
//      🔴 **同じアイコンを別の意味で使い回していない**（§3.1。17 + 5 = 22 個すべてが 1 項目に固定）。
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
  Send,
  Settings,
  Share2,
  UserSearch,
  Users,
} from 'lucide-react';
import { cn } from './lib/cn.js';

/**
 * 🔴 **閉じた写像。** キーは `docs/04` §3.1 の表のアイコン名（+ 許可① の 2 つ）。
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
 * 🔴 **16px（`size-4`）に固定する。** 縦に 15〜16 項目が並ぶ列で 1 日に何十回も走査する道具
 *    （`docs/04` §11-22）であり、**大きさが項目ごとに違うと「偶然の強調」が生まれる**。
 *    `shrink-0` は狭い幅でアイコンが潰れないための当たり判定（`components/button.tsx` の
 *    `shrink-0` と同じ理由）。
 * 🔴 太さ（`strokeWidth`）を指定しない —— lucide の既定（24px グリッドで 2）をそのまま使う。
 *    セット内で視覚重量が揃っていることが ① の根拠であり、こちらで触ると揃わなくなる。
 */
export const ICON_CLASSES = 'size-4 shrink-0';

export type IconProps = {
  readonly name: IconName;
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
export function Icon({ name, className }: IconProps) {
  return createElement(ICONS[name], {
    className: cn(ICON_CLASSES, className),
    'aria-hidden': true,
    focusable: 'false',
  });
}
