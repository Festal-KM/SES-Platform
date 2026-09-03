// apps/web/next.config.ts
// 🔴 最小構成。設定に APP_ENV による分岐を書かない（差し替えは packages/config の
//    resolveConnectorSelection 1 箇所。CLAUDE.md §11.1 / docs/05 §13.1）。
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 🔴 型エラー・ビルドエラーを握りつぶさない（既定値だが、後から緩められないよう明示する）。
  typescript: { ignoreBuildErrors: false },
  // 🔴 @node-rs/argon2 はネイティブアドオン。サーバ側で外部化してバンドルさせない。
  serverExternalPackages: ['@node-rs/argon2', '@prisma/client'],
};

export default nextConfig;
