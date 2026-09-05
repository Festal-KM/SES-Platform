// packages/domain/src/quota/index.ts
// 上限判定の純粋関数（docs/05 §8.7 / §8.3-Q）。
// 🔴 `decideProviderQuota`（送信基盤全体の 24h 枠。docs/05 §8.3-Q）は T-04-04 が
//    `provider.ts` として同じディレクトリに置いた。**2 実装にしない** ——
//    `send.*`（`Proposal` / `Contract`）側の `PROVIDER_QUOTA` 保留（SP-09 T-09-06）も
//    ここを再利用する（SP-04 完了判定 8-③）。
export {
  decideEmailRate,
  EMAIL_MINUTE_WINDOW_MS,
  type EmailRateDecision,
  type EmailRateInput,
} from './email-rate.js';
export {
  decideProviderQuota,
  isProviderQuotaWarning,
  providerQuotaUsage,
  type ProviderQuotaDecision,
  type ProviderQuotaInput,
  type ProviderQuotaObservation,
  type ProviderQuotaUsage,
} from './provider.js';
