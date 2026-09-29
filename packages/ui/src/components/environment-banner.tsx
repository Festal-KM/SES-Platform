// packages/ui/src/components/environment-banner.tsx
// `F-028` 非本番環境であることの常時表示（docs/05 §13.5 / docs/04 §3.5 / CLAUDE.md §11.1）。
// SP-10 T-10-05。`apps/web/app/layout.tsx` の `ENVIRONMENT_BANNER_SLOT`（T-21-03）に入る。
//
// 🔴 **`APP_ENV` の分岐はこの `switch` 1 箇所である。** 呼び出し側（`apps/web`）は
//    `packages/config` が起動時に検証した値を props で渡すだけで、`if (env === 'demo' || …)`
//    を書かない。`switch` の網羅性検査（`default: assertNever`）により、環境を 1 つ足したときに
//    **表示が漏れたままビルドが通る**ことが無い（漏れても画面は正常に見えるため気づけない。
//    docs/05 §13.5「型で強制する理由」）。
// 🔴 **文言を持たない**（`../index.ts` の規約 5 / CLAUDE.md §3.5）。4 環境ぶんの文言は
//    呼び出し側が `packages/i18n` から解決して `messages` で渡す。`production` の文言は
//    **型の上で存在しない**（`EnvironmentBannerMessages` は `production` を除く）——
//    「本番にも出す文言」を渡せる形にすると、`F-028 AC-3`（本番では出ない）が props の
//    渡し方 1 つで破れる。
// 🔴 **`'use client'` を付けない**（規約 4）。状態もイベントも持たない。
// 🔴 **依存を増やさない**（規約 6）。`AppEnvKind`（`@ses/config`）を import せず同じ 5 値を
//    ここに書く。ずれは `apps/web` 側の `env={currentAppEnv()}`（`AppEnvKind` →
//    `EnvironmentBannerEnv` の代入）が型エラーで検出する —— `config` に環境が増えれば、
//    ここに追加して `switch` の枝を足すまでコンパイルが通らない。
//
// ============================================================================
// 見え方の判断（docs/04 §3.4 / §3.5 / §13.3）
// ============================================================================
// | 語 | 理由 |
// |---|---|
// | `sticky top-0` | 🔴 「スクロールしても消えない」（`F-028 AC-1`）。`fixed` にすると本文の上余白を `body` 側で管理する必要が生じ、バナーの高さ（`sandbox` は折り返して数行）に合わせた値を別の場所に持つことになる。`sticky` は流れの中に高さを持つので、その管理が要らない |
// | `z-20` | 平面帯（`apps/web/app/admin/layout.tsx`。z-index 無し）より上、かつ画面内の `sticky top-0 z-10`（`S-021` の判断ヘッダ）より上。同じ `z-10` にすると DOM 順で後の要素が勝ち、`S-021` のモバイルでスクロール中にバナーが隠れる（`AC-1` 違反） |
// | 折り返し（`whitespace-*` を付けない） | 🔴 **1 行に切り詰めない・折りたたまない**（docs/04 §3.4 / §3.5）。`sandbox` の 3 点構成は狭い画面でも全文が読めなければ意味を失う（`U-07`） |
// | `text-center` `px-4 py-2` | 直下に来る平面帯（`px-4 py-2 text-center`）と同じ律動。帯が 2 段重なっても揃って見える（`px-4` = 16px / `py-2` = 8px は docs/04 §7.9 の spacing 7 段に一致） |
// | `text-sm` → **`text-body`** | T-22-01。実寸は同じ 14px で、§7.9 の 6 トークン（役割名）で参照する |
// | `border-b` + 色 | v4 の border 既定色は `currentColor`。色を書かないと文字色の線が出る（`./alert.tsx` の表に同じ） |
//
// ============================================================================
// 🔴 T-22-01 で色が変わった（`demo` / `sandbox` は amber → **情報（青）**）
// ============================================================================
// T-10-05 の判断はこうだった: 「`demo` / `sandbox` は利用者（見込み客・商談相手）が目にする環境
// なので `Alert` の `warning` と同じ amber、`development` / `staging` は内部向けなので slate」。
//
// 🔴 **`docs/04` §7.4 は環境バナーを「情報（青）」に割り当てている**（`SANDBOX` / 環境バナー /
//    お知らせ帯 = 「**業務の状態ではなく、環境や運営からの連絡である**ことを示す。業務の状態色と
//    混ぜない」）。一方 注意（橙）は `GATE_FAILED` / `EXTENSION_REVIEW` / `CLOSING` / 上限 80% の
//    ように「**直せば / 動けば進む**」業務状態のための色である。環境バナーはそのどれでもない ——
//    直しようがなく、そこに居続ける事実の表示である。
//    **amber のままにすると、ゲート差し戻しや満了間近の行と同じ色が画面最上部に常駐し、
//    「注意」の意味が薄まる**（§7.4 の 🔴「赤を乱用すると本当に危ない状態が埋もれる」と同じ構造）。
// ⚠️ **内部向け（`development` / `staging`）と外部向け（`demo` / `sandbox`）を分ける T-10-05 の
//    判断は残す。** 分け方を「amber / slate」から「情報（青）/ 無彩色」に移しただけである。
// 🔴 **色は補助であり、識別の本体は「帯という構造が最上部に在ること」**（docs/04 §3.3。
//    色覚特性に依存しない）。この原則は変わっていないので、色の変更で `F-028` の成立は動かない。
import { cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn.js';

/**
 * `APP_ENV` の 5 値（`packages/config` の `APP_ENV_KINDS` と同じ集合。冒頭の「依存を増やさない」）。
 */
export type EnvironmentBannerEnv = 'development' | 'demo' | 'sandbox' | 'staging' | 'production';

/** バナーを描く環境（= `production` 以外）。 */
export type EnvironmentBannerVisibleEnv = Exclude<EnvironmentBannerEnv, 'production'>;

/** 🔴 `production` の文言は渡せない（キーが無い）。 */
export type EnvironmentBannerMessages = Readonly<Record<EnvironmentBannerVisibleEnv, string>>;

export type EnvironmentBannerProps = Omit<ComponentProps<'p'>, 'children'> & {
  readonly env: EnvironmentBannerEnv;
  readonly messages: EnvironmentBannerMessages;
};

/**
 * 🔴 環境ごとの見え方は**この 1 箇所**だけが決める（`switch` の網羅性と対で守る）。
 *    トーンは `docs/04` §7.4 の 2 系統だけを使う: **情報（青）= 外部の目に触れる環境** /
 *    **無彩色 = 内部向けの環境**。上の 🔴 のとおり業務の状態色（注意・障害・成果）を使わない。
 */
const bannerVariants = cva(
  'sticky top-0 z-20 w-full border-b px-4 py-2 text-center text-body font-semibold',
  {
    variants: {
      env: {
        development: 'border-neutral-border bg-bg-inset text-fg',
        demo: 'border-info-border bg-info-bg text-info',
        sandbox: 'border-info-border bg-info-bg text-info',
        staging: 'border-neutral-border bg-bg-inset text-fg',
      },
    },
  },
);

function assertNever(value: never): never {
  throw new Error(`EnvironmentBanner: 未対応の環境です: ${String(value)}`);
}

export function EnvironmentBanner({ env, messages, className, ...props }: EnvironmentBannerProps) {
  switch (env) {
    case 'production':
      return null;
    case 'development':
    case 'demo':
    case 'sandbox':
    case 'staging':
      return (
        <p
          className={cn(bannerVariants({ env }), className)}
          data-environment={env}
          {...props}
        >
          {messages[env]}
        </p>
      );
    default:
      return assertNever(env);
  }
}
