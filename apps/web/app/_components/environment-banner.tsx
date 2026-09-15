// apps/web/app/_components/environment-banner.tsx
// `F-028` 非本番環境バナーの、`apps/web` 側の配線（docs/05 §13.5 / docs/04 §3.5。T-10-05）。
//
// 🔴 責務は 2 つだけである: ①文言を `packages/i18n` から解決して `@ses/ui` の
//    `EnvironmentBanner` に渡す（CLAUDE.md §3.5 / BR-32。`packages/ui` は文言を持たない）
//    ②E2E / render テストが掴む `data-testid` を付ける。
//    🔴 **`APP_ENV` をここで読まない・分岐しない。** 値は `app/layout.tsx` が
//    `lib/db/bootstrap.ts` の `currentAppEnv()`（起動時に `packages/config` が検証した値の
//    唯一の読み出し口）から受け取って props で渡し、分岐は `@ses/ui` の `switch` 1 箇所で行う
//    （CLAUDE.md §11.1「リクエストごとの `if (APP_ENV === ...)` を散らさない」）。
// 🔴 `'use client'` を付けない。サーバコンポーネントのまま（状態もイベントも無い）。
// 🔴 `production` の文言は存在しない —— `EnvironmentBannerMessages` が `production` を
//    キーに持たないため、`t('env.production')` のようなキーを足しても型が受け付けない
//    （`F-028 AC-3` を props の形で守る）。
import type { AppEnvKind } from '@ses/config';
import { t } from '@ses/i18n';
import { EnvironmentBanner, type EnvironmentBannerMessages } from '@ses/ui';

/**
 * 🔴 キーの集合は型で固定されている（`Record<Exclude<AppEnvKind, 'production'>, string>`）。
 *    `packages/config` に環境が増えると、`@ses/ui` 側に枝を足すまで `env` の代入が通らず、
 *    ここに文言を足すまでこの定数が通らない。**どちらか片方だけ直して黙って空になる経路は無い。**
 */
const MESSAGES: EnvironmentBannerMessages = {
  development: t('env.development'),
  demo: t('env.demo'),
  sandbox: t('env.sandbox'),
  staging: t('env.staging'),
};

export type AppEnvironmentBannerProps = {
  /** `currentAppEnv()` の値。🔴 リクエスト入力から取らない。 */
  readonly env: AppEnvKind;
};

export function AppEnvironmentBanner({ env }: AppEnvironmentBannerProps) {
  return <EnvironmentBanner env={env} messages={MESSAGES} data-testid="environment-banner" />;
}
