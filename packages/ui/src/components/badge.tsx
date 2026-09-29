// packages/ui/src/components/badge.tsx
// shadcn/ui の `Badge` を取り込み（docs/03 §2「UI」/ CLAUDE.md §2.1）。SP-21 T-21-02 / SP-22 T-22-01。
//
// 照合日 2026-09-10 / `https://ui.shadcn.com/r/styles/new-york-v4/badge.json`。
// upstream の基底（原文）:
//   inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full
//   border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap
//   transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px]
//   focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20
//   dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3
//
// ⚠️ **「ここ」の列は T-22-01（デザイントークン）で更新した。判断の記録は 1 行も消していない。**
//
// | upstream の語 | ここ | 判断と理由 |
// |---|---|---|
// | `inline-flex` `items-center` `justify-center` `gap-1` `px-2` | 同じ | `gap-1`（4px）/ `px-2`（8px）は `docs/04` §7.9 の spacing 7 段のうち「バッジの内側」に一致する |
// | 🔴 `w-fit` `shrink-0` `whitespace-nowrap` `overflow-hidden` | 同じ | **1 語も落とさない。** T-21-01 で `Button` からこの 2 語（`shrink-0` / `whitespace-nowrap`）が落ちていたために、狭い flex コンテナで**ラベルが 1 文字ずつ折り返して隣の要素と重なる**実害が出た。バッジは表のセルと flex 行の中にしか置かれないため、同じ壊れ方をする位置にある |
// | `rounded-full` | **`rounded-sm`**（4px） | 🔴 T-22-01。§7.9: radius は **2 段だけ**で、**円形（`rounded-full`）はアバターとカウンタのみ**。バッジは 4px の段（入力欄 / ボタン / バッジ / セル）である。**状態バッジは「色 + 形状 + 語」の 3 点で区別する**（§5-1）ので、形状が円形から角丸に変わっても弁別の要素は減らない |
// | `py-0.5`（2px） | **`py-1`**（4px） | T-22-01。§7.9 の spacing は 7 段（4 / 8 / 12 / 16 / 24 / 32 / 48）であり、2px はどの段でもない。「バッジの内側（縦）」に当たるのは `--space-1` = 4px である |
// | `text-xs`（12px） | **`text-micro`**（11px） | T-22-01。§7.3 の最下段「最小（バッジ内・`Phase N`・カウンタ）= 11px / 500」。🔴 **11px を本文に使わない**（バッジの中だけ） |
// | `font-medium` | 同じ（**T-22-01 で `font-semibold` から戻した**） | T-21-02 は既存 3 箇所（`sending-domain-status.tsx` / 管理平面 2 画面）の `font-semibold` に合わせていた。§7.3 が最小段の weight を **500** と定めたため upstream と同じ `font-medium` に戻る（トークン表が既存実装より上位である） |
// | `border border-transparent` | `border` のみを基底に置き、**色はバリアント側**が持つ | ⚠️ T-21-02 の時点では「`cn()` が競合解決をしないため両方載せるとどちらが勝つか読めない」という理由だった。**`tailwind-merge` を入れた T-22-01 以降は後勝ちで解決される**が、**色をバリアント 1 箇所に集める**という理由（§5-13 / §7.4）は変わらないので構成は同じである |
// | `transition-[color,box-shadow]` | `transition-colors` | 影を変えるバリアントが無い。§7.9 も遷移の対象を background-color / border-color / color / opacity に限っている |
// | `focus-visible:*` `aria-invalid:*` `dark:*` | 取り込まない | 本リポジトリのバッジは状態表示であり、フォーカスを受けない（§7.10 の 8 状態のうちバッジが取るのは default だけ。下の表）。`dark:` はダークテーマ非対応（`Q-04-3` 既定 ①） |
// | `[&>svg]:pointer-events-none` `[&>svg]:size-3` | 取り込まない | 🔴 **状態バッジにアイコンを付けない**（§7.5 / §5-1。`Phase N` の Badge も同じ）。`lucide-react` は Phase 3b |
// | `asChild`（`radix-ui` の `Slot`） | 取り込まない | リンクとして使いたくなったら `<a>` の中にバッジを置く |
// | バリアント名 `default` / `secondary` / `destructive` / `outline` / `ghost` / `link` | `neutral` / `brand` / `info` / `success` / `warning` / `danger` / `outline` | 🔴 本リポジトリのバッジは**状態**を色で示す用途しかなく、upstream の `default`（primary 色）に対応するものが無い。**名前は `docs/04` §7.4 の 6 系統と 1 対 1** である（下の表） |
//
// ============================================================================
// 🔴 `docs/04` §7.4 の 6 系統との対応（**意味を入れ替えない**）
// ============================================================================
// | バリアント | §7.4 の系統 | 割り当てられた意味（この列を画面側で解釈し直さない） |
// |---|---|---|
// | `brand` | ブランド藍 | **いま進行中・次はあなたの番**（`APPROVAL_PENDING` / `SUBMITTING` / `REQUESTED`） |
// | `danger` | 障害（赤） | 🔴 **`SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` のみ**（赤を乱用すると本当に危ない 3 状態が埋もれる） |
// | `warning` | 注意（橙） | `GATE_FAILED` / `EXTENSION_REVIEW` / `CLOSING` / 上限 80% 到達（**直せば / 動けば進む**もの） |
// | `success` | 成果（緑） | `WON` / `SUBMITTED` / `ACTIVE` / `EXECUTED` / `ACCEPTED`（**多用しない**） |
// | `info` | 情報（青） | `SANDBOX` / 環境バナー / お知らせ帯。**業務の状態色と混ぜない** |
// | `neutral` / `outline` | 無彩色 | 🔴 **終わったもの・確定したものは色を持たない**（`DRAFT` / `LOST` / `DECLINED` / `WITHDRAWN` / `EXPIRED` / `ENDED` / `PURGED`）/ `Phase N` |
//
// 🔴 **`brand` と `info` は T-22-01 で新設した**（§7.4 の実装漏れの記録: ブランド藍・成果（緑）・
//    情報（青）は実装に 0 箇所だった）。**使う画面は Phase 4 以降**であり、ここでは色の所在だけを作る。
// 🔴 **`StatusBadge` を別部品として作らない**（§5-13）。§5-1 の 36 状態 + 公開の状態 4 値 +
//    `Phase N` は **`Badge` のバリアント**として Phase 3b で足す（状態名から表示を導出し、
//    画面側で色を指定させない）。
//
// ⚠️ §7.10 の 8 状態のうち `Badge` が取るのは **default だけ**である。バッジは表示であって
//    操作ではなく、hover / active / focus-visible / disabled / loading / error を持たない
//    （持たせると「押せるもの」に見える）。
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';
import { TRANSITION_CLASSES } from '../lib/state-classes.js';

const badgeVariants = cva(
  cn(
    'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-2 py-1 text-micro font-medium whitespace-nowrap',
    TRANSITION_CLASSES,
  ),
  {
    variants: {
      /** 🔴 枠線色・背景色・文字色は**すべてここが持つ**（基底に置かない。上の表 / §7.4）。 */
      variant: {
        neutral: 'border-transparent bg-neutral-bg text-fg',
        brand: 'border-transparent bg-brand-bg text-brand',
        info: 'border-transparent bg-info-bg text-info',
        success: 'border-transparent bg-success-bg text-success',
        warning: 'border-transparent bg-warning-bg text-warning',
        danger: 'border-transparent bg-danger-bg text-danger',
        outline: 'border-neutral-border bg-transparent text-fg',
      },
      /**
       * 🔴 **形状**（`docs/04` §5-1: **色 + 形状 + 語の 3 点で区別する**。SP-22 `T-22-04` で新設）。
       *
       * 色覚特性に依存しないために形状が要る。§5-1 は 36 状態を
       * **塗り（`solid`）/ 枠線（`outline`）/ 点線枠（`dashed`）**の 3 形で書き分けており、
       * 例えば `Assignment.ACTIVE`（緑 / 塗り）と `Tenant.ACTIVE`（緑 / 枠線）は
       * **同じ色で形だけが違う**。形状が無いと、この 2 つが同じ見た目になる。
       *
       * ⚠️ ここに置くのは `dashed` の 1 語だけである（枠線色は tone ごとに違うので
       *    `compoundVariants` が持つ。下）。
       */
      shape: {
        solid: '',
        outline: '',
        dashed: 'border-dashed',
      },
    },
    /**
     * 🔴 **`outline` / `dashed` の枠線色・背景・文字色**（tone × shape）。
     * ⚠️ `cn()`（`tailwind-merge`）が後勝ちで解決するため、基底 + `variant` の
     *    `border-transparent bg-*-bg` はここで上書きされる（`../lib/cn.ts` の規律 1）。
     * 🔴 **12 行を手で書く。** 生成すると「どの組み合わせが在るか」を読めなくなり、
     *    §7.4 の意味の割り当てが機械の中に隠れる。
     */
    compoundVariants: [
      { variant: 'neutral', shape: 'outline', class: 'border-neutral-border bg-transparent text-fg' },
      { variant: 'neutral', shape: 'dashed', class: 'border-neutral-border bg-transparent text-fg' },
      // ⚠️ ブランド藍には `--color-brand-border` が無い（§7.9 の 27 トークン）。枠線には
      //    文字色と同じ `--color-brand` を使う（semantic に無い色を実装側で作らない）。
      { variant: 'brand', shape: 'outline', class: 'border-brand bg-transparent text-brand' },
      { variant: 'brand', shape: 'dashed', class: 'border-brand bg-transparent text-brand' },
      { variant: 'info', shape: 'outline', class: 'border-info-border bg-transparent text-info' },
      { variant: 'info', shape: 'dashed', class: 'border-info-border bg-transparent text-info' },
      { variant: 'success', shape: 'outline', class: 'border-success-border bg-transparent text-success' },
      { variant: 'success', shape: 'dashed', class: 'border-success-border bg-transparent text-success' },
      { variant: 'warning', shape: 'outline', class: 'border-warning-border bg-transparent text-warning' },
      { variant: 'warning', shape: 'dashed', class: 'border-warning-border bg-transparent text-warning' },
      { variant: 'danger', shape: 'outline', class: 'border-danger-border bg-transparent text-danger' },
      { variant: 'danger', shape: 'dashed', class: 'border-danger-border bg-transparent text-danger' },
    ],
    defaultVariants: { variant: 'neutral', shape: 'solid' },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;
/** 🔴 §5-1 の形状（塗り / 枠線 / 点線枠）。 */
export type BadgeShape = NonNullable<VariantProps<typeof badgeVariants>['shape']>;

export type BadgeProps = ComponentProps<'span'> & {
  readonly variant?: BadgeVariant;
  readonly shape?: BadgeShape;
};

export function Badge({ className, variant = 'neutral', shape = 'solid', ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, shape }), className)} {...props} />;
}

// ============================================================================
// 🔴 `StatusBadge` — §5-1 の 36 状態 + 公開の状態 4 値 + `Phase N`（SP-22 `T-22-04`）
// ============================================================================
// 🔴 **`Badge` のバリアントとして実装し、独立ファイルを起こさない**（§5-13 の 🔴。
//    機械検査は `tests/static/ui-primitive-single-impl.test.ts` (b)④ が
//    `status-badge.tsx` の不在を見る）。
//
// 🔴 **状態名から表示を導出し、画面側で色を指定させない。**
//    **1 箇所でしか色が決まらないことが、§7.4 の意味の対応を守る唯一の方法である**（§5-13）。
//    着手前は `BadgeVariant` への写像が**画面ごとに 12 箇所**在り（`proposal-list-screen.tsx` /
//    `proposal-approval-screen.tsx` / `admin-usage-table.tsx` …）、同じ状態が画面によって
//    違う色になりうる形だった。段②〜⑤ でそれらを `StatusBadge` に寄せる。
//
// ============================================================================
// 🔴 「色は部品 / 語は呼び出し側」の分け方（**この分割が本部品の設計の要点である**）
// ============================================================================
// `packages/ui` は **`@ses/i18n` を import できない**（`docs/05` §2.3.1 / 検査 (i)④）。
// したがって §5-13 の「状態名から表示を導出する」を次のように割る。
//
//   | 何を | どこが決めるか | 根拠 |
//   |---|---|---|
//   | **色（意味）と形状** | 🔴 **この部品**（`STATUS_BADGE_APPEARANCES`） | §5-13: 1 箇所でしか色が決まらないこと。§7.4 の 6 系統の意味 |
//   | **語（ラベル）** | 呼び出し側が `packages/i18n` から解決して渡す | `CLAUDE.md` §3.5 / `BR-32`。`../index.ts` の共通規約 5 |
//
// 🔴 **画面は色を渡せない**（`variant` / `shape` の prop を持たない）。渡せるのは
//    `entity` / `state` / `label` だけである。**状態が同じなら、どの画面でも必ず同じ色になる。**
// 🔴 **アイコンを付けない**（§5-1 / §7.5 の「引き続き使わない場所」）。36 状態 × アイコンの
//    対応表を作らない。**アイコンを受け取る prop を持たない。**
//
// ⚠️ 状態名の集合は `packages/domain`（`PROPOSAL_STATES` 等）と**同じ語**でなければならないが、
//    `packages/ui` は `@ses/domain` に依存しない（依存を増やさない）。**一致は render テスト
//    （`apps/web/app/_components/ui-display.render.test.tsx`）が `@ses/domain` の定数と
//    突き合わせて固定する** —— `apps/web` は両方を import できる唯一の層である。


/** 1 つの状態の見え方（🔴 色 = §7.4 の意味 / 形状 = §5-1 の塗り・枠線・点線枠）。 */
export type StatusBadgeAppearance = {
  readonly variant: BadgeVariant;
  readonly shape: BadgeShape;
};

/**
 * 🔴 **§5-1 の全 36 状態 + 公開の状態 4 値 + `Phase N` の見え方**（記法: `状態 = 表示ラベル（色 / 形状）`）。
 *    **1 つも省略しない**（1 つでも表現できないと UI で状況が読めなくなる）。
 *
 * 🔴 区別の要点（§5-1 / `BR-23` / `BR-60`）:
 *    - **障害（`danger`・塗り）= `SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` のみ。**
 *      赤は「外部に何かが起きたか、起きたか分からない」状態に限る（乱用すると本当に危ない 3 状態が埋もれる）。
 *    - **ゲート差し戻し（`GATE_FAILED`）は `warning`（橙）** —— 「直せば進む」ものであり、外部に何も
 *      起きていない。**赤にすると「品質管理を強化するほど画面が赤くなる」逆の動機が生まれる。**
 *    - **業務的な終わり（`LOST` / `DECLINED` / `WITHDRAWN` / `EXPIRED` / `ENDED` / `PURGED`）は
 *      すべて `neutral`・枠線**だが、🔴 **ラベルの語は 1 つずつ違う**（語は呼び出し側が渡す）。
 *    - **点線枠（`dashed`）= 進行中・保留**（`GATE_RUNNING` / `SUBMITTING` / `SENDING` / `EXPIRED`〔依頼の期限切れ〕/
 *      公開の再検査の保留）。`elapsed`（経過時間）を添えるのはこの形の状態である。
 *
 * 🔴 **同じ状態名なら、どのエンティティでも同じ色である**（形状だけが違う）:
 *    `ACTIVE` = 緑（`Assignment` は塗り / `Tenant` は枠線）/ `DRAFT` = 無彩色 / `WITHDRAWN` = 無彩色 /
 *    `EXPIRED` = 無彩色（`ProposalRequest` は点線枠 / `Contract` は枠線）。
 *    **render テストがこれを固定する**（色が状態名で決まらないと、画面をまたいだ読み方が崩れる）。
 */
export const STATUS_BADGE_APPEARANCES = {
  /** `Proposal`（14。`CLAUDE.md` §4.2） */
  proposal: {
    DRAFT: { variant: 'neutral', shape: 'outline' },
    /** 🔴 AI の日次コスト上限で停止中も同じ `検査中` のままで、`GATE_FAILED` の橙に変えない（`F-027 AC-5`）。 */
    GATE_RUNNING: { variant: 'neutral', shape: 'dashed' },
    GATE_FAILED: { variant: 'warning', shape: 'solid' },
    APPROVAL_PENDING: { variant: 'brand', shape: 'solid' },
    APPROVED: { variant: 'brand', shape: 'outline' },
    SUBMITTING: { variant: 'brand', shape: 'dashed' },
    SUBMITTED: { variant: 'success', shape: 'outline' },
    SUBMIT_FAILED: { variant: 'danger', shape: 'solid' },
    INTERVIEW_SCHEDULED: { variant: 'brand', shape: 'outline' },
    INTERVIEWED: { variant: 'brand', shape: 'outline' },
    RESULT_PENDING: { variant: 'brand', shape: 'outline' },
    WON: { variant: 'success', shape: 'solid' },
    LOST: { variant: 'neutral', shape: 'outline' },
    WITHDRAWN: { variant: 'neutral', shape: 'outline' },
  },
  /** `Assignment`（5）。🔴 `S-044`（取引先ビュー）でも同じバッジを使う（§5-1）。 */
  assignment: {
    SCHEDULED: { variant: 'brand', shape: 'outline' },
    ACTIVE: { variant: 'success', shape: 'solid' },
    EXTENSION_REVIEW: { variant: 'warning', shape: 'solid' },
    ENDING: { variant: 'neutral', shape: 'solid' },
    ENDED: { variant: 'neutral', shape: 'outline' },
  },
  /** `ProposalRequest`（5。§3.1 経路 4） */
  proposalRequest: {
    REQUESTED: { variant: 'brand', shape: 'solid' },
    ACCEPTED: { variant: 'success', shape: 'outline' },
    DECLINED: { variant: 'neutral', shape: 'outline' },
    WITHDRAWN_BY_HOST: { variant: 'neutral', shape: 'outline' },
    EXPIRED: { variant: 'neutral', shape: 'dashed' },
  },
  /** `Tenant`（5。契約のライフサイクル） */
  tenant: {
    SANDBOX: { variant: 'info', shape: 'solid' },
    ACTIVE: { variant: 'success', shape: 'outline' },
    SUSPENDED: { variant: 'danger', shape: 'solid' },
    CLOSING: { variant: 'warning', shape: 'solid' },
    PURGED: { variant: 'neutral', shape: 'outline' },
  },
  /** `Contract`（7。Phase 3） */
  contract: {
    DRAFT: { variant: 'neutral', shape: 'outline' },
    SENDING: { variant: 'brand', shape: 'dashed' },
    SEND_FAILED: { variant: 'danger', shape: 'solid' },
    UNDER_REVIEW: { variant: 'brand', shape: 'outline' },
    EXECUTED: { variant: 'success', shape: 'solid' },
    WITHDRAWN: { variant: 'neutral', shape: 'outline' },
    EXPIRED: { variant: 'neutral', shape: 'outline' },
  },
  /**
   * 案件の「公開の状態」4 値（`docs/04` §S-011 / §5-1 の 🔴。改訂 14）。
   * 🔴 **これは 5 エンティティの状態機械ではない** —— `Project` に状態を足したのではなく、
   *    公開範囲（`ProjectVisibility`）と直近のゲート結果から**導かれる表示**である。
   * 🔴 **自動解除と保留を同じバッジで描かない**（`F-014 AC-12`）。解除は「公開が落ちている」、
   *    保留は「公開が続いている」であり、利用者が取るべき行動が逆になる。🔴 **赤は使わない**
   *    （外部で事故が起きたわけではない）。
   */
  projectPublication: {
    UNSET: { variant: 'neutral', shape: 'outline' },
    PUBLISHED: { variant: 'success', shape: 'outline' },
    AUTO_REVOKED: { variant: 'warning', shape: 'solid' },
    RECHECK_HELD: { variant: 'neutral', shape: 'dashed' },
  },
  /**
   * サイドバーの未実装項目の `Phase N`（`docs/04` §3.1 / `T-22-05`）。
   * 🔴 **無彩色**（§7.9 の `--color-neutral-bg`）。🔴 **アイコンを付けない**（§7.5）。
   */
  phase: {
    PHASE_2: { variant: 'neutral', shape: 'solid' },
    PHASE_3: { variant: 'neutral', shape: 'solid' },
  },
} as const satisfies Readonly<Record<string, Readonly<Record<string, StatusBadgeAppearance>>>>;

/** 見え方の表を持つ対象（5 エンティティ + 公開の状態 + `Phase N`）。 */
export type StatusBadgeEntity = keyof typeof STATUS_BADGE_APPEARANCES;
/** その対象が取りうる状態名。🔴 表に無い名前は**型エラー**になる。 */
export type StatusBadgeState<E extends StatusBadgeEntity> = keyof (typeof STATUS_BADGE_APPEARANCES)[E] & string;

/** 型を落とした参照（`entity` が generic のまま添字を引くため）。 */
const APPEARANCE_LOOKUP: Readonly<Record<string, Readonly<Record<string, StatusBadgeAppearance>>>> =
  STATUS_BADGE_APPEARANCES;

export type StatusBadgeProps<E extends StatusBadgeEntity> = Omit<
  ComponentProps<'span'>,
  'children' | 'color'
> & {
  readonly entity: E;
  readonly state: StatusBadgeState<E>;
  /**
   * 🔴 **語（ラベル）は呼び出し側が `packages/i18n` から解決して渡す**（`../index.ts` の共通規約 5）。
   *    **色（意味）と形状は渡せない** —— それがこの部品の存在理由である。
   */
  readonly label: string;
  /**
   * 経過時間（§5-1: 点線枠の状態〔`GATE_RUNNING` / `SUBMITTING` / `SENDING`〕に添える）。
   * 🔴 解決済みの文字列（「3 分」の組み立ては呼び出し側）。
   */
  readonly elapsed?: string;
};

/**
 * 状態バッジ。🔴 **色は状態名から導出され、画面側は指定できない。**
 *
 *   <StatusBadge entity="proposal" state="GATE_FAILED" label={t('proposal.state.GATE_FAILED')} />
 */
export function StatusBadge<E extends StatusBadgeEntity>({
  entity,
  state,
  label,
  elapsed,
  className,
  ...props
}: StatusBadgeProps<E>) {
  const appearance = APPEARANCE_LOOKUP[entity]?.[state];
  // 🔴 実行時の壁。表に無い状態を**無彩色で黙って描かない** —— §5-1 は「1 つでも表現できないと
  //    UI で状況が読めなくなる」と定めており、既定色へのフォールバックはその欠落を隠す。
  if (appearance === undefined) {
    throw new Error(
      `StatusBadge: ${entity} に状態 ${state} の見え方が定義されていません（docs/04 §5-1 の表に足してください）。`,
    );
  }
  return (
    <Badge
      variant={appearance.variant}
      shape={appearance.shape}
      className={className}
      data-entity={entity}
      data-state={state}
      {...props}
    >
      {label}
      {elapsed === undefined ? null : <span className="font-normal">{elapsed}</span>}
    </Badge>
  );
}
