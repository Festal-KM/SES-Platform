// packages/ui/src/components/kpi-card.tsx
// 🔴 ホーム（`S-003` / `S-004`）の上部に並ぶ **KPI カード**（2026-10-02 の人間のブリーフ）。
//    ⚠️ **`docs/04` §7.9 / §7.3 改訂 23 はこの部品を `MetricCard` と呼んでいる。**
//    本タスクの指示が `KpiCard` を名指ししたのでこちらに合わせた（**同一物である**）。
//    🔴 名前の食い違いは `docs/04` 側の訂正事項として報告する。
//
// ============================================================================
// 🔴 §7.2 の「KPI カード 4 枚を並べない」との関係（**ここを読まずに流用しない**）
// ============================================================================
// §7.2 は長く「KPI カード 4 枚 → グラフ → 最近のアクティビティ → テーブル」の型を**採らない**と
// 定めてきた。防ぎたいのは **「朝一番に目に入るものが、行動の変わらない数値であること」**である。
// 2026-10-02 に人間がモックアップでカード 4 枚を提示し、実装することを決めた。🔴 **禁止の本体
// （要対応キューより視覚的に強くしない）は捨てていない。** 守り方はこの部品に組み込んである:
//
//   | 守るもの | この部品での実装 |
//   |---|---|
//   | グラフ・スパークライン・達成率を置かない | **受け取る prop が無い**（型として渡せない） |
//   | 「良し悪し」を色で断定しない | 🔴 差分は**常に無彩色**（`--color-fg-muted`）。`up` / `down` の prop も色の prop も無い —— **「未返信が減った」と「提案が減った」は意味が逆**であり、色を付けると必ずどちらかを誤って断定する |
//   | 系統色を装飾に使わない | アイコンの四角は**無彩色**（`--color-bg-inset`）。§7.4 の 6 系統は意味と 1 対 1 であり、**装飾に系統色を使わない**（色を付けるには §7.4 の割り当て = 人間の判断が要る） |
//   | 横スクロールにしない | `grid`（`md` 未満は **2×2**）。🔴 `overflow-x` を 1 語も書かない —— 画面外の指標に気づけないまま「全部見た」と思うため（§5-13） |
//   | 枚数を増やさない | 🔴 **2〜4 枚**（5 枚目は実行時に落とす。下の壁） |
//
// 🔴 **数値の整形は呼び出し側が済ませる**（`1,284` / `12`）。部品は文字列を並べるだけで、
//    桁区切り・丸め・単位の判断をしない（`SummaryStrip` と同じ分担）。
// 🔴 **文言を持たない**（`../index.ts` の共通規約 5）。🔴 **`'use client'` を宣言しない**（規約 4）。
// 🔴 **`children` / `ReactNode` の prop を持たない**（`./drawer.tsx` と同じ理由 —— 任意の JSX を
//    入れられる器は、規約がコメントだけになる）。
import type { ComponentType } from 'react';
import { cn } from '../lib/cn.js';
import type { SidebarLinkProps } from './sidebar.js';
import { CARD_SURFACE_CLASSES } from '../lib/surface-classes.js';
import { Icon, type IconName } from '../icons.js';
import {
  KPI_CARD_HEIGHT_CLASS,
  KPI_ICON_TILE_CLASSES,
} from '../lib/layout-tokens.js';

/** 🔴 1 行に並べる上限（ブリーフの 4 枚）。5 枚目は実行時に落とす。 */
export const KPI_CARD_ROW_MAX_ITEMS = 4;
/**
 * 🔴 下限。1 枚だけの「KPI カード」は**ただの大きな数字**であり、比較の文脈を失う
 * （`SummaryStrip` の下限と同じ構えである）。0 枚のときは `KpiCardRow` を描かない。
 */
export const KPI_CARD_ROW_MIN_ITEMS = 2;

export type KpiCardItem = {
  /** `data-testid` の接尾辞（kebab-case）。🔴 値は呼び出し側が持つ。 */
  readonly id: string;
  /** 🔴 `../icons.ts` の閉じた写像の名前（写像に無い名前は型エラー）。 */
  readonly icon: IconName;
  /** 指標の名前（解決済み）。 */
  readonly label: string;
  /** 🔴 **整形済みの数**（桁区切りまで済ませて渡す）。 */
  readonly value: string;
  /** 単位（`件` / `社`）。🔴 **金額を渡さない**（`CLAUDE.md` §2 課金 / `BR-24`）。 */
  readonly unit: string;
  /**
   * 差分（`↑ +2（昨日比）`）。🔴 **向きの記号と括弧書きまで含めて解決済みの文字列**を渡す。
   * 🔴 **色は付かない**（上の表）。`null` なら行ごと描かない（「—」を置かない ——
   * 比較できない指標に差分の枠があると、空欄が「0」に見える）。
   */
  readonly delta: string | null;
  /**
   * ✅ 2026-10-03: **件数を `--text-metric`（24px）で描いてよい 1 枚**。
   *
   * 🔴 **既定（`undefined`）は `--text-lg`（16px）であり、セクション見出しより大きくならない。**
   *    `docs/04` §7.2 改訂 23 の「（認めていない）」の行が 🔴 **「件数を、その画面で最も強調される
   *    要素より強くする（サイズ・太さ・色）」**を全画面で禁じており、**`S-003` で最も強調するのは
   *    要対応キュー**だからである。実測（2026-10-03 のデモ巡回）では 24px / 600 の件数が
   *    ホーム内で最大の文字になっており、この条文に反していた。
   * 🔴 **`'primary'` を渡してよいのは `S-004` のカード 1（返答が必要な依頼）だけである** ——
   *    同じ表が 🔴「**KPI カードの件数を、画面の中でいちばん大きい文字にしてよいのは `S-004` の
   *    カード 1 だけ**（返答期限がこの画面の最重要の判断材料であるため）」と名指しで認めている。
   *    **判断は呼び出し側**（`apps/web/lib/home/summary-view.ts` の 1 箇所）に在る。
   */
  readonly emphasis?: 'primary';
  /**
   * ✅ 2026-10-11（人間の仕様: 🔴 **「KPI はクリックでタブ切替やフィルタに遷移できる」**）: 遷移先。
   *
   * 🔴 **`null` のカードは「押せる見た目」にならない**（`docs/04` §4.1 改訂 23:
   *    「遷移先がある枚だけがカーソルと下線を持つ」/ **4 枚すべてを同じ見た目の 4 つの
   *    ボタンにしない**）。判定はこの 1 箇所だけで、画面側に分岐が無い。
   * 🔴 **`onClick` の口を作らない** —— これは遷移であって実行系ではない（KPI から状態機械を
   *    動かせる口が生えると、`CLAUDE.md` §3.3 のゲートを迂回する導線の置き場所になる）。
   * 🔴 **値の出所は API の応答**（`SummaryMetric.href`）である。画面が遷移先を決めない
   *    （`docs/05` §6.11.1「数の意味を 2 箇所で決めない」）。
   */
  readonly href?: string | null;
};

export type KpiCardProps = KpiCardItem & {
  /** testid の接頭辞（例 `home-host-kpi-`）。🔴 部品はローカルで値を作らない。 */
  readonly testIdPrefix: string;
  /**
   * `href` が非 `null` のときに使う遷移部品（`next/link`）。
   * 🔴 **`packages/ui` は `next/link` に依存しない**（`CLAUDE.md` §2.1 の依存方向）。
   */
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
  readonly className?: string;
};

/**
 * アイコンの四角（`docs/04` §7.9: `--icon-sm`（16px）+ `--space-1`（4px）の内側余白 + radius 4px）。
 * 🔴 **寸法を画面側で決めない。** 🔴 **無彩色である**（上の表の 3 行目）。
 *
 * ✅ 2026-10-03: `--icon-md` + `--space-2`（= 36px の四角）→ `--icon-sm` + `--space-1`（= 24px）。
 *    **実測**（1280px / デモ巡回）: カードの器は 134px、内側は `p-4` で 102px しか無く、
 *    36px の四角 + `--space-2` を 1 行目に置くと**ラベルの幅が 56px しか残らず
 *    「今日やるこ / と」「今週の提 / 案」が 2 行に折れていた**（B-1）。四角は印であって
 *    判断材料ではないので、**先に縮めるのは四角の側**である。
 */
// ✅ **2026-10-13（`docs/design-system.md` §4）: 48 × 48 の角丸の面に 24px のアイコン。**
// 🔴 地は `brand-bg`（仕様書 `--primary-soft`）。無彩色（`bg-inset`）に戻さない —— 4 枚の
//    カードの中で唯一の色であり、「ここが数字の意味を表す印である」という手がかりになっている。
const ICON_TILE_CLASSES = `inline-grid shrink-0 place-items-center rounded-md bg-brand-bg text-brand ${KPI_ICON_TILE_CLASSES}`;

/**
 * 件数。
 * 🔴 **既定は `--text-lg`（16px / 600）** —— §7.3 の 2 段目（セクション見出し）と同じ段であり、
 *    **要対応キューの見出しより大きくならない**（§7.2 の「件数を最も強調される要素より強くしない」）。
 * 🔴 ✅ **2026-10-13: `--text-metric`（28px / 700）を 4 枚すべてに使う**（デザインシステム v1.0
 *    §3.4）。従来は `emphasis='primary'` の 1 枚だけだったが、仕様書は 4 枚を**並べて比べる**
 *    ものとして定義しており、1 枚だけ大きいと比較ではなく「1 つの数字 + 3 つの添え物」に見える。
 *    **この部品の 1 箇所だけが `text-metric` を書いてよい**（§7.3 改訂 23。機械検査は
 *    `tests/static/design-tokens.test.ts` / `tests/static/ui-shadow-and-size.test.ts`）。
 */
const VALUE_CLASSES = 'text-metric font-bold text-fg tabular-nums';
/** 単位は数の隣に baseline を揃えて置く（15 / 500。数が主役であることを崩さない）。 */
const UNIT_CLASSES = 'text-row font-medium text-fg';
/** ラベルは 14 / `--text-2`、差分は 13 / 500（デザインシステム v1.0 §3.4）。 */
const LABEL_CLASSES = 'text-body text-fg-muted';
const DELTA_CLASSES = 'text-cell font-medium text-fg-muted tabular-nums';

/**
 * ✅ 2026-10-03: 器の内側を `--space-4`（16px）→ `--space-3`（12px）に落とした。
 * 🔴 **段の外の値を作っていない**（§7.9 の 7 段のうち「セルの内側」と同じ 12px）。
 *    実測（1280px）: カードの高さ 133px → **約 84px**。KPI 帯が要対応キューを 240px 押し下げて
 *    いた状態（S-3）を、**器の高さの側からも**戻す。
 */
const CARD_COMPACT_PADDING_CLASSES = 'p-4';

/**
 * ✅ 2026-10-11: 🔴 **遷移先を持つカードだけが持つ見た目**（`docs/04` §4.1 改訂 23:
 *    「遷移先がある枚だけがカーソルと下線を持つ」）。
 *
 * 🔴 **`hover:` / `focus-visible:` を画面側に書かせない**ためにここに置く（§7.10 / 検査 (j)
 *    `tests/static/ui-state-in-primitives.test.ts` —— 画面が状態の見え方を決めると、
 *    その画面だけ押し心地が変わる）。
 * 🔴 **色は足さない**（面の色は変えず、`--color-row-hover-bg` の 1 トークンだけを使う ——
 *    系統色を装飾に使わない。ファイル冒頭の表 3 行目）。
 */
// ⚠️ 🔴 **`display` のクラス（`block` / `inline-block`）を入れない。**
//    `cn()` は `tailwind-merge` であり、`display` は 1 グループなので**後に来た方が勝つ** ——
//    `cn(frame, CARD_LINK_CLASSES)` の `frame` 側は `flex flex-col gap-1` を持つため、
//    ここに `block` を書くと**カードの縦積みと `gap` が黙って消える**（`../lib/cn.ts` の規律 1）。
const CARD_LINK_CLASSES =
  'hover:bg-row-hover-bg outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';
/** 🔴 遷移できることは**下線**でも示す（色だけに依らせない）。 */
const VALUE_LINK_CLASSES = 'underline';

function DefaultCardLink({ href, children, ...rest }: SidebarLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

export function KpiCard({
  id,
  icon,
  label,
  value,
  unit,
  delta,
  emphasis,
  href = null,
  testIdPrefix,
  linkComponent: Link = DefaultCardLink,
  className,
}: KpiCardProps) {
  const body = (
    <>
      {/* 🔴 アイコンは印にすぎない（`aria-hidden` は `Icon` が立てる）。意味はラベルが担う。
          🔴 **左に置く**（デザインシステム v1.0 §3.4）—— 4 枚並んだときに印の列が縦に通り、
             ラベルと数字の左端も揃う。 */}
      <span className={ICON_TILE_CLASSES}>
        <Icon name={icon} size="lg" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className={LABEL_CLASSES}>{label}</span>
        <span className="flex items-baseline gap-1">
          <span className={cn(VALUE_CLASSES, href === null ? null : VALUE_LINK_CLASSES)}>
            {value}
          </span>
          <span className={UNIT_CLASSES}>{unit}</span>
        </span>
        {/* 🔴 差分は無彩色（良し悪しを決めつけない）。無ければ行ごと描かない。 */}
        {delta === null ? null : (
          <span className={DELTA_CLASSES} data-testid={`${testIdPrefix}${id}-delta`}>
            {delta}
          </span>
        )}
      </span>
    </>
  );
  const frame = cn(
    CARD_SURFACE_CLASSES,
    CARD_COMPACT_PADDING_CLASSES,
    // 🔴 高さ 105 / 面と文字の間 20（デザインシステム v1.0 §3.4）。`min-h` にするのは、
    //    デルタが無い枚と在る枚が混ざっても **4 枚の高さが揃う**ようにするためである。
    `flex items-center gap-5 ${KPI_CARD_HEIGHT_CLASS}`,
    className,
  );
  // 🔴 **遷移先が無いカードは `<a>` にしない**（押せる見た目にならない = 上の 🔴）。
  if (href === null) {
    return (
      <div data-testid={`${testIdPrefix}${id}`} data-emphasis={emphasis ?? 'default'} className={frame}>
        {body}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className={cn(frame, CARD_LINK_CLASSES)}
      data-testid={`${testIdPrefix}${id}`}
      data-emphasis={emphasis ?? 'default'}
    >
      {body}
    </Link>
  );
}

export type KpiCardRowProps = {
  /** 🔴 2〜4 枚（下の壁）。0 枚なら描かない（`null` を返す）。 */
  readonly items: readonly KpiCardItem[];
  /** testid の接頭辞（例 `home-host-kpi-`）。 */
  readonly testIdPrefix: string;
  /** `href` を持つ項目の遷移部品（`next/link`）。 */
  readonly linkComponent?: ComponentType<SidebarLinkProps>;
  readonly className?: string;
};

/**
 * 4 枚を横に並べる器。
 *
 * 🔴 **`md` 未満は 2×2 のグリッドで、横スクロールにしない**（§5-13 / `CLAUDE.md` §13.3
 *    「狭い画面を理由に判断材料を隠さない」）。`sm` でも 2 列のままにする —— 1 列に積むと
 *    ファーストビューが KPI で埋まり、**要対応キューが画面外へ出る**（§7.2 の禁止の本体）。
 */
export function KpiCardRow({ items, testIdPrefix, linkComponent, className }: KpiCardRowProps) {
  if (items.length === 0) return null;
  // 🔴 実行時の壁（`./summary-strip.tsx` / `./dropdown-menu.tsx` と同じ形）。
  if (items.length > KPI_CARD_ROW_MAX_ITEMS) {
    throw new Error(
      `KpiCardRow: KPI カードは ${String(KPI_CARD_ROW_MAX_ITEMS)} 枚までです（2026-10-02 のブリーフ）。${String(items.length)} 枚渡されました。`,
    );
  }
  if (items.length < KPI_CARD_ROW_MIN_ITEMS) {
    throw new Error(
      `KpiCardRow: KPI カードは ${String(KPI_CARD_ROW_MIN_ITEMS)} 枚以上です（1 枚では比較の文脈が無く、ただの大きな数字になります）。${String(items.length)} 枚渡されました。0 枚のときは描かない（空配列を渡す）でください。`,
    );
  }
  return (
    <div
      data-testid={`${testIdPrefix}root`}
      data-item-count={items.length}
      className={cn('grid grid-cols-2 gap-4 md:grid-cols-4', className)}
    >
      {items.map((item) => (
        <KpiCard key={item.id} {...item} testIdPrefix={testIdPrefix} linkComponent={linkComponent} />
      ))}
    </div>
  );
}
