// apps/web/next.config.ts
// 🔴 最小構成。設定に APP_ENV による分岐を書かない（差し替えは packages/config の
//    resolveConnectorSelection 1 箇所。CLAUDE.md §11.1 / docs/05 §13.1）。
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 🔴 型エラー・ビルドエラーを握りつぶさない（既定値だが、後から緩められないよう明示する）。
  typescript: { ignoreBuildErrors: false },
  // 🔴 @node-rs/argon2 はネイティブアドオン。サーバ側で外部化してバンドルさせない。
  // 🔴 @anthropic-ai/sdk は `@ses/ai` のバレル経由で載る（T-08-06 が依頼メッセージの商流照合に
  //    `mask()` を使うため）。Web は LLM を呼ばないので、SDK 本体をバンドルへ取り込まない
  //    （docs/05 §7.9 ⑥ / §6.5「#31 / #32 / #35 の実装の決着」）。
  serverExternalPackages: ['@node-rs/argon2', '@prisma/client', '@anthropic-ai/sdk'],
};

export default nextConfig;
