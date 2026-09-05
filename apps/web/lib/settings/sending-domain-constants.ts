// apps/web/lib/settings/sending-domain-constants.ts
// 🔴 P0 修正（T-04-06 Iteration 3。e2e-tester 報告）: `sending-domain-fact.ts`
//    （クライアントコンポーネントから import される）が `SENDING_DOMAIN_NOT_REQUIRED` を
//    **値**として `./sending-domains`（`@ses/db` に依存するサーバ専用モジュール）から
//    import していたため、その値 import 1 本のせいでモジュール全体がクライアントバンドルに
//    含まれ、`packages/db` のトップレベル `Prisma.sql`` `` がブラウザで throw していた
//    （`sqltag is unable to run in this browser environment`。ハイドレーション時に crash）。
//
// 🔴 この定数だけを、**何にも依存しない**モジュールへ切り出す（`packages/domain` と同じ規律）。
//    `sending-domains.ts`（サーバ専用）と `sending-domain-fact.ts`（クライアントからも import
//    される）の両方がここから読む。`sending-domain-fact.ts` 側は `./sending-domains` から
//    **型のみ**（`import type`）を読むようにし、実行時の import 文自体が消える形にした
//    （`tests/static/client-db-boundary.test.ts` が再発を固定する）。
export const SENDING_DOMAIN_NOT_REQUIRED = 'NOT_REQUIRED' as const;
