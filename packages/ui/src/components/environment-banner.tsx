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
// | `text-center` `px-4 py-2` | 直下に来る平面帯（`px-4 py-2 text-center`）と同じ律動。帯が 2 段重なっても揃って見える |
// | 色（`TONE_CLASSES`） | `demo` / `sandbox` は利用者（見込み客・商談相手）が目にする環境なので `Alert` の `warning` と同じ amber、`development` / `staging` は内部向けなので slate。🔴 **色は補助であり、識別の本体は「帯という構造が最上部に在ること」**（docs/04 §3.3。色覚特性に依存しない） |
// | `border-b` + 色 | v4 の border 既定色は `currentColor`。色を書かないと文字色の線が出る（`./alert.tsx` の表に同じ） |
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

const BASE_CLASSES = 'sticky top-0 z-20 w-full border-b px-4 py-2 text-center text-sm font-semibold';

const TONE_CLASSES: Readonly<Record<EnvironmentBannerVisibleEnv, string>> = {
  development: 'border-slate-300 bg-slate-200 text-slate-900',
  demo: 'border-amber-300 bg-amber-50 text-amber-900',
  sandbox: 'border-amber-300 bg-amber-50 text-amber-900',
  staging: 'border-slate-300 bg-slate-200 text-slate-900',
};

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
          className={cn(BASE_CLASSES, TONE_CLASSES[env], className)}
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
