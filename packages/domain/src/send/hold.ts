// packages/domain/src/send/hold.ts
// 🔴 外部送信の「保留」（docs/05 §10.4 / §10.5 / §8.3-Q ⑥ / `CLAUDE.md` §4.2「状態を増やさない」）。T-09-06。
//
// ============================================================================
// 🔴 保留は状態ではなく属性である
// ============================================================================
// `Proposal` / `Contract` の状態機械（`CLAUDE.md` §4.2）に状態を足すことは禁じられている。
// したがって「事前判定に抵触したので送っていない」は `sendHoldReasonKey` / `sendHoldSince` の 2 列で表し、
// 状態は `APPROVED`（契約書は `DRAFT`）のまま動かさない。`SUBMITTING` に入れず、`SUBMIT_FAILED` にも落とさない。
//
// 🔴 値集合は **`proposals.send_hold_reason_key` / `contracts.send_hold_reason_key` の CHECK と同じ 7 値**
//    でなければならない（`tests/static/schema-enum-drift.test.ts` が migration.sql と突合する。`packages/db` の
//    `SEND_HOLD_REASON_KEYS` は本定数の re-export であり、独自に宣言しない）。
//
// 🔴 純粋関数である。現在時刻・I/O を持ち込まない（`tests/static/domain-purity.test.ts`）。

/**
 * 保留の理由（docs/05 §10.4 の 7 値）。
 *
 * - `RATE_LIMIT` … テナントの日次上限（`decideEmailRate` の `BLOCK`）。対処するのはテナント（`S-038`）
 * - `DOMAIN_UNVERIFIED` … 送信元ドメインが未検証（§8.3）。対処するのはテナント管理者（`S-036`）
 * - `ESIGN_DISCONNECTED` … 電子署名の未接続（契約書のみ。Phase 3）
 * - `TENANT_SUSPENDED` … テナントが実行不可の状態（`SUSPENDED` 等）
 * - `GATE_STALE` … 承認後に内容が変わった / 実行が遅延しすぎた（§10.5）。🔴 **自動復帰しない**
 * - `AI_COST_LIMIT` … AI の日次コスト上限（契約書のみ。Phase 3）
 * - `PROVIDER_QUOTA` … 送信基盤（環境全体）の 24h 枠（§8.3-Q）。🔴 `RATE_LIMIT` と別の値。対処するのは運営者
 */
export const SEND_HOLD_REASON_KEYS = [
  'RATE_LIMIT',
  'DOMAIN_UNVERIFIED',
  'ESIGN_DISCONNECTED',
  'TENANT_SUSPENDED',
  'GATE_STALE',
  'AI_COST_LIMIT',
  'PROVIDER_QUOTA',
] as const;

export type SendHoldReasonKey = (typeof SEND_HOLD_REASON_KEYS)[number];

export function isSendHoldReasonKey(value: string): value is SendHoldReasonKey {
  return (SEND_HOLD_REASON_KEYS as readonly string[]).includes(value);
}

/**
 * 🔴 `send.hold-release`（docs/05 §9.4）が**自動で復帰させてよい**理由。
 *
 * `GATE_STALE` だけが対象外である（§10.5「自動復帰しない。人間が `S-021` / `S-022` から再度『送信』を選ぶまで待つ」）。
 * 🔴 判定は「`GATE_STALE` 以外」ではなく**列挙**で持つ —— 値が増えたとき「自動で送ってよいか」を人間が決めるまで、
 *    黙って自動復帰の側に倒れない（`CLAUDE.md` §11.1 と同じ向き。安全側 = 送らない）。
 */
export const AUTO_RELEASABLE_SEND_HOLD_REASON_KEYS = [
  'RATE_LIMIT',
  'DOMAIN_UNVERIFIED',
  'ESIGN_DISCONNECTED',
  'TENANT_SUSPENDED',
  'AI_COST_LIMIT',
  'PROVIDER_QUOTA',
] as const satisfies readonly SendHoldReasonKey[];

export function isAutoReleasableSendHoldReason(key: SendHoldReasonKey): boolean {
  return (AUTO_RELEASABLE_SEND_HOLD_REASON_KEYS as readonly SendHoldReasonKey[]).includes(key);
}

/**
 * 🔴 送信基盤の枠（`PROVIDER_QUOTA`）は**テナントの利用量ではない**（§8.3-Q ⑥ / `F-059 AC-7`）。
 *    利用者への提示で `S-038`（残量）への導線を出してよいのはテナント側で解消できる理由だけである。
 *    `PROVIDER_QUOTA` に `S-038` を案内しても打つ手が無い（残量は潤沢）。
 */
export function isTenantResolvableSendHoldReason(key: SendHoldReasonKey): boolean {
  return key === 'RATE_LIMIT' || key === 'DOMAIN_UNVERIFIED' || key === 'ESIGN_DISCONNECTED';
}

export type SendStalenessInput = {
  /** enqueue された時刻（payload の `enqueuedAt`）。 */
  readonly enqueuedAt: Date;
  /** 🔴 現在時刻は引数で受け取る（本パッケージは `Date.now` を参照しない）。 */
  readonly now: Date;
  /** `SEND_STALE_THRESHOLD_MINUTES`（`packages/config`。既定 30）。 */
  readonly thresholdMinutes: number;
};

/**
 * 🔴 遅延保留の判定（docs/05 §10.2 ②-a / §10.5）。enqueue から実行までに閾値を超えていれば **送らずに見送る**。
 *
 * 承認から時間が経つと内容・提案先・エンジニアの前提が変わっている可能性があり、時間が経ったものを黙って送る
 * ほうが危険である。閾値を**超えた**ときだけ真（ちょうど閾値は送る）。
 *
 * @throws {RangeError} 閾値が正の整数でないとき（0 を通すと全件が保留になり、負数を通すと全件が送られる）。
 */
export function isSendStale(input: SendStalenessInput): boolean {
  if (!Number.isInteger(input.thresholdMinutes) || input.thresholdMinutes <= 0) {
    throw new RangeError(
      `thresholdMinutes は 1 以上の整数である必要があります（受け取った値: ${String(input.thresholdMinutes)}）。`,
    );
  }
  const elapsedMs = input.now.getTime() - input.enqueuedAt.getTime();
  if (Number.isNaN(elapsedMs)) {
    throw new RangeError('enqueuedAt / now が有効な日時ではありません。');
  }
  return elapsedMs > input.thresholdMinutes * 60_000;
}
