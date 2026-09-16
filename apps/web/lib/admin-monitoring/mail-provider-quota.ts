// apps/web/lib/admin-monitoring/mail-provider-quota.ts
// 🔴 `A-005` 項目 13「メール送信基盤の上限到達・接近（環境全体）」の組み立て（docs/02 `F-059 AC-7` / docs/05 §8.3-Q / §16.5 項目 13 /
//    §6.9 API-A8 / docs/04 申し送り 16）。T-11-04。
//
// ============================================================================
// 🔴 判定と表示で別々に計算しない
// ============================================================================
// 実効上限・消費量・消費率は `packages/domain` の `providerQuotaUsage`（`decideProviderQuota` の内部計算そのもの）から取る。
// 別々に書くと「保留されているのに残量が余って見える」食い違いが起きる（`provider.ts` の注記）。接近の判定も
// `isProviderQuotaWarning`（`send.hold-release` が `warning` を出すのと同じ 1 実装）。
//
// ============================================================================
// 🔴 `getQuota()` が取れないときは `available: false` であり、0 で埋めない
// ============================================================================
// `max24h` / `consumptionRate` を 0 で返すと画面は「上限 0 通」「0%」と読み、**枠が空いているのに保留されている**（あるいは
// その逆）に見える。`available: false` だけが「上限を確認できていません」の根拠であり、手元のカウンタ（`localSentLast24h`）は
// 参考値として併記する（docs/05 §6.9 API-A8）。
//
// 🔴 これは**テナント単位の日次上限（`F-027`。`A-004` のメール列）とは別の枠**である。`tenantId` を型に持たない。
import { isProviderQuotaWarning, providerQuotaUsage, type ProviderQuotaObservation } from '@ses/domain';
import type { MailProviderQuotaPayload } from './view';

/**
 * 送信基盤の枠を読む口（起動時 DI = `apps/web/lib/db/bootstrap.ts` の `mailProviderQuotaRuntime()` が実体を渡す）。
 *
 * - `readQuota` … `EmailSender.getQuota()`。🔴 取得に失敗したら throw する（0 を返さない。docs/05 §8.1）
 * - `readLocalSent24h` … Redis ZSET `mail:provider:sent24h` の件数（`ProviderSendCounter.countLast24h`）
 * - `observeNearing` … `mail:provider:nearingSince` の目印（`ProviderQuotaNearingMarker.observe`。表示専用）
 */
export type MailProviderQuotaReader = {
  /** `MAIL_PROVIDER_DAILY_QUOTA`（`packages/config`）。 */
  readonly envLimit: number;
  /** `MAIL_PROVIDER_QUOTA_WARN_RATIO`（`packages/config`。既定 0.8）。 */
  readonly warnRatio: number;
  readQuota(): Promise<ProviderQuotaObservation>;
  readLocalSent24h(now: Date): Promise<number>;
  observeNearing(nearing: boolean, now: Date): Promise<Date | null>;
};

export type MailProviderHeldInput = {
  readonly heldCount: number;
  /** `email_dispatches(status='HELD_PROVIDER_QUOTA')` の `MIN(held_at)` = 枠に到達して最初に保留した時刻。 */
  readonly oldestHeldAt: Date | null;
};

export type MailProviderQuotaSummaryInput = {
  readonly envLimit: number;
  readonly warnRatio: number;
  /** `getQuota()` の結果。🔴 取得に失敗したら `null`（`available: false` に落とす）。 */
  readonly provider: ProviderQuotaObservation | null;
  readonly localSent24h: number;
  /** `getQuota()` が最後に成功した時刻（プロセス内の記憶）。無ければ `null`。 */
  readonly lastObservedAt: Date | null;
  readonly held: MailProviderHeldInput;
  /** 接近を最初に観測した時刻（目印）。接近していなければ `null`。 */
  readonly nearingSince: Date | null;
  readonly now: Date;
};

const toIso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/**
 * 🔴 接近しているか（`send.hold-release` の `warning` と同じ判定）。`provider` が無いときは手元のカウンタだけで判定する
 *    （`decideProviderQuota` が `null` を「枠が無限」と解釈しないのと同じ向き）。
 */
export function isMailProviderNearing(input: {
  readonly envLimit: number;
  readonly warnRatio: number;
  readonly provider: ProviderQuotaObservation | null;
  readonly localSent24h: number;
  readonly now: Date;
}): boolean {
  const usage = providerQuotaUsage({
    envLimit: input.envLimit,
    provider: input.provider,
    localSent24h: input.localSent24h,
    now: input.now,
  });
  return isProviderQuotaWarning(usage, input.warnRatio);
}

/** 🔴 観測値 → API-A8 の項目 13（純粋関数）。 */
export function summarizeMailProviderQuota(input: MailProviderQuotaSummaryInput): MailProviderQuotaPayload {
  const base = {
    scope: 'ENVIRONMENT' as const,
    warnRatio: input.warnRatio,
    reachedAt: toIso(input.held.oldestHeldAt),
    nearingSince: toIso(input.nearingSince),
    heldCount: input.held.heldCount,
  };
  if (input.provider === null) {
    return {
      ...base,
      // 🔴 `max24h` / `consumptionRate` を持たない枝。参考値は手元のカウンタと設定値だけ。
      envLimit: input.envLimit,
      providerReading: {
        available: false,
        localSentLast24h: input.localSent24h,
        lastObservedAt: toIso(input.lastObservedAt),
      },
    };
  }
  const usage = providerQuotaUsage({
    envLimit: input.envLimit,
    provider: input.provider,
    localSent24h: input.localSent24h,
    now: input.now,
  });
  return {
    ...base,
    envLimit: usage.limit,
    providerReading: {
      available: true,
      max24h: input.provider.max24h,
      sentLast24h: usage.consumed,
      consumptionRate: usage.consumptionRate,
      observedAt: input.provider.observedAt.toISOString(),
    },
  };
}

/**
 * 🔴 口から読んで組み立てる（I/O の順序と失敗の扱いを 1 箇所に置く）。
 *
 * - `readQuota()` の失敗 → `available: false`（この関数は throw しない。他の材料を巻き込まない）
 * - `readLocalSent24h()` の失敗 → throw（呼び出し側が `PROVIDER_READ_FAILED` に落とす。手元のカウンタも無ければ何も言えない）
 * - `observeNearing()` の失敗 → `nearingSince: null`（表示専用の目印。項目 13 は成立する）
 */
export async function readMailProviderQuota(
  reader: MailProviderQuotaReader,
  held: MailProviderHeldInput,
  now: Date,
  memory: { lastObservedAt: Date | null },
): Promise<MailProviderQuotaPayload> {
  let provider: ProviderQuotaObservation | null;
  try {
    provider = await reader.readQuota();
    memory.lastObservedAt = provider.observedAt;
  } catch {
    // 🔴 握り潰しではない —— `available: false` として画面に「上限を確認できていません」を出す（0 件と表示しない）。
    provider = null;
  }
  const localSent24h = await reader.readLocalSent24h(now);
  const nearing = isMailProviderNearing({ envLimit: reader.envLimit, warnRatio: reader.warnRatio, provider, localSent24h, now });
  let nearingSince: Date | null;
  try {
    nearingSince = await reader.observeNearing(nearing, now);
  } catch {
    nearingSince = null;
  }
  return summarizeMailProviderQuota({
    envLimit: reader.envLimit,
    warnRatio: reader.warnRatio,
    provider,
    localSent24h,
    lastObservedAt: memory.lastObservedAt,
    held,
    nearingSince,
    now,
  });
}
