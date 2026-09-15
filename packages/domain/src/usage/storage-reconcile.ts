// packages/domain/src/usage/storage-reconcile.ts
// 🔴 ストレージ使用量の**検算**（docs/05 §9.8 `usage.storage-reconcile` / docs/03 §4.5 / §4.15）。T-10-02。
//
// ============================================================================
// 🔴 カウンタが正であり、実測は検算である（自動補正しない）
// ============================================================================
// `UsageCounter(STORAGE_BYTES)` は `PutObject` の確定時に加算・削除の成功時に減算する
// **ゲージ**であり、上限判定（`decideStorageUpload`）はこれを読む。オブジェクトストアの実測
// （S3 Inventory / Storage Lens / プレフィックス走査）は非同期に得られる値であり、
// 停止判定に使えないだけでなく、**進行中のアップロード**（署名済み・未確定）を含みうる。
// したがって乖離が出ても**カウンタを書き換えない**。乖離は `A-005` の材料として出し、
// 原因（確定通知の取りこぼし / 削除ジョブの片側失敗。docs/03 §4.12）を人間が特定する。
//
// 🔴 「突き合わせ結果を正とするのは月末の締めのときのみ」（docs/03 §4.5）は Phase 3 の
//    `A-011` の運用判断であり、本関数は判定だけを返す。

export type StorageReconcileInput = {
  /** 🔴 正: `UsageCounter(MONTH,'STORAGE_BYTES')` の現在値。 */
  readonly counterBytes: bigint;
  /** 検算: オブジェクトストアがテナントのプレフィックス配下で実測したバイト数。 */
  readonly measuredBytes: bigint;
};

export type StorageReconcileDecision =
  | { readonly kind: 'MATCH' }
  | {
      readonly kind: 'DIVERGENCE';
      /** `measured − counter`。正なら実体がカウンタより多い（確定通知の取りこぼし等）、負なら少ない（削除の片側失敗等）。 */
      readonly deltaBytes: bigint;
    };

function assertNonNegative(name: string, value: bigint): void {
  if (value < 0n) throw new RangeError(`${name} は 0 以上である必要があります（受け取った値: ${value}）。`);
}

/**
 * 🔴 乖離の判定（純粋関数）。**許容差は 0** である。
 *
 * 許容差を持たせない理由: 乖離の大きさに閾値を置くと「小さな乖離が毎日積み上がる」経路が
 * 検知されない。翌日の検算で一致すれば finding は解消され（`packages/db` 側の resolve）、
 * 一時的な乖離（進行中のアップロード）は自然に消える。
 */
export function reconcileStorageUsage(input: StorageReconcileInput): StorageReconcileDecision {
  assertNonNegative('counterBytes', input.counterBytes);
  assertNonNegative('measuredBytes', input.measuredBytes);
  const deltaBytes = input.measuredBytes - input.counterBytes;
  return deltaBytes === 0n ? { kind: 'MATCH' } : { kind: 'DIVERGENCE', deltaBytes };
}
