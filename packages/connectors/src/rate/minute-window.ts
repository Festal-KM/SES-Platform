// packages/connectors/src/rate/minute-window.ts
// 🔴 テナント単位の**分次**スライディングウィンドウ（docs/05 §8.7「分次は Redis の
//    スライディングウィンドウ（60 秒、`ZADD`/`ZREMRANGEBYSCORE`）」）。T-04-03。
//
// 🔴 日次（500 通 / 日）はここではない。**日次は `UsageCounter`（DB）が正**であり
//    （docs/05 §8.7）、`packages/db` の `reserveEmailDailyQuota` が原子的に予約する。
//    2 つを 1 つの仕組みに寄せない —— 日次は請求・監視の根拠でもあり、揮発してはならない。
//    分次は平準化が目的なので揮発してよい。
//
// 🔴 判定そのもの（DEFER / BLOCK の区別と `retryAfterSec`）は `packages/domain` の
//    `decideEmailRate` が持つ。ここは「窓の中に何件あるか」を答えるだけである。

/** 直近 60 秒の観測結果（`decideEmailRate` の入力になる）。 */
export type MinuteWindowState = {
  readonly count: number;
  /** ウィンドウ内で最も古い送信の時刻（空なら `null`）。`retryAfterSec` の根拠。 */
  readonly oldestAt: Date | null;
};

/**
 * 分次ウィンドウ。
 *
 * 🔴 `peek` と `record` を分ける理由: 判定の時点では枠を消費しない。判定 → 予約 → 送信の
 *    順に進み、送信しないと決めた（DEFER / BLOCK）ものが窓を埋めてはならない。
 *    「観測したら消費する」1 メソッドにすると、保留のたびに窓が詰まって復帰しなくなる。
 */
export interface MinuteWindowCounter {
  peek(tenantId: string, at: Date): Promise<MinuteWindowState>;
  record(tenantId: string, at: Date): Promise<void>;
}

const WINDOW_MS = 60_000;

/**
 * 単一プロセス用の実装。
 * 🔴 `production` では Redis 版に差し替える（プロセスが複数あると窓を過小評価する）。
 *    差し替えは起動時 DI の 1 箇所で行い、ここに `APP_ENV` の分岐は無い。
 */
export class InMemoryMinuteWindowCounter implements MinuteWindowCounter {
  private readonly windows = new Map<string, number[]>();

  async peek(tenantId: string, at: Date): Promise<MinuteWindowState> {
    const entries = this.prune(tenantId, at);
    return {
      count: entries.length,
      oldestAt: entries.length === 0 ? null : new Date(entries[0] ?? at.getTime()),
    };
  }

  async record(tenantId: string, at: Date): Promise<void> {
    const entries = this.prune(tenantId, at);
    entries.push(at.getTime());
    entries.sort((a, b) => a - b);
  }

  private prune(tenantId: string, at: Date): number[] {
    const threshold = at.getTime() - WINDOW_MS;
    const entries = this.windows.get(tenantId) ?? [];
    const kept = entries.filter((value) => value > threshold);
    this.windows.set(tenantId, kept);
    return kept;
  }
}
