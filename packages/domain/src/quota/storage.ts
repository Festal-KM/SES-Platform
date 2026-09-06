// packages/domain/src/quota/storage.ts
// 🔴 ストレージ上限の判定（`CLAUDE.md` §3.4 / docs/05 §8.7 / §14.2 / docs/03 §4.5）。T-05-04。
//
// 🔴 **判定は「署名付き URL を発行する前」に行う**（docs/03 §4.5 / docs/05 §14.2）。
//    発行してから S3 側で失敗させると、**S3 にオブジェクトが置かれたのにカウンタが増えない**
//    （あるいはその逆）状態が生まれ、`UsageCounter` を正とする前提そのものが崩れる。
//    「発行しない」ことがこの機能の要点であり、「発行して失敗させる」ではない。
//
// 🔴 メール（`decideEmailRate`）と**別の関数**にする。単位も、超過したときの意味も違う ——
//    メールの日次超過は「明日になれば解消する」が、ストレージ超過は**削除するまで解消しない**。
//    同じ形に畳むと、利用者への案内（次に何をすれば送れる / 上げられるのか）が誤る。

/**
 * 判定結果。
 *
 * - `ALLOW`: 発行してよい。`remainingBytes` は発行後の残量（`F-027` の残量表示が使う）。
 * - `BLOCK`: 🔴 **署名付き URL を発行しない**（`reason` は docs/05 §5.8 `QuotaDecision` の `'STORAGE'`）。
 *
 * 🔴 `DEFER`（待機）を持たない。時間が経っても解消しないため、待機は誤った案内になる。
 */
export type StorageQuotaDecision =
  | { readonly kind: 'ALLOW'; readonly remainingBytes: bigint }
  | { readonly kind: 'BLOCK'; readonly reason: 'STORAGE' };

export type StorageQuotaInput = {
  /**
   * テナントのストレージ上限（バイト）。`Plan.storageLimitBytes` か、
   * その既定値（`packages/config` の `STORAGE_LIMIT_BYTES_PER_TENANT`）。
   */
  readonly limitBytes: bigint;
  /** 🔴 `UsageCounter(metric='STORAGE_BYTES')` の確定値が**正**である（docs/03 §4.5）。 */
  readonly usedBytes: bigint;
  /** これから置こうとしているオブジェクトのサイズ。 */
  readonly requestedBytes: bigint;
};

function assertNonNegative(name: string, value: bigint): void {
  if (value < 0n) {
    throw new RangeError(`${name} は 0 以上である必要があります（受け取った値: ${value}）。`);
  }
}

/**
 * 🔴 ストレージ上限の判定（純粋関数）。
 *
 * 🔴 判定は「**現在使用量 + 要求サイズ**が上限を超えるか」で行う（現在使用量だけを見ない）。
 *    現在使用量だけで判定すると、上限の 1 バイト手前から上限の何倍でも置けてしまい、
 *    上限が上限でなくなる。要求サイズは署名に焼き込まれる（`ObjectStore.presignPut` の
 *    `maxBytes`）ため、宣言より大きいものはアップロードできない。
 *
 * 🔴 上限ちょうどは許す（`used + requested <= limit`）。超過の定義を「上限を**超えた**とき」に
 *    そろえる（`decideEmailRate` の `dailySent >= dailyLimit` は「その日にもう送れない」の意味で
 *    枠の消費数を数えているのに対し、こちらは容量そのものを比べている）。
 */
export function decideStorageUpload(input: StorageQuotaInput): StorageQuotaDecision {
  if (input.limitBytes <= 0n) {
    throw new RangeError(
      `limitBytes は 1 以上である必要があります（受け取った値: ${input.limitBytes}）。`,
    );
  }
  if (input.requestedBytes <= 0n) {
    throw new RangeError(
      `requestedBytes は 1 以上である必要があります（受け取った値: ${input.requestedBytes}）。`,
    );
  }
  assertNonNegative('usedBytes', input.usedBytes);

  const after = input.usedBytes + input.requestedBytes;
  if (after > input.limitBytes) return { kind: 'BLOCK', reason: 'STORAGE' };
  return { kind: 'ALLOW', remainingBytes: input.limitBytes - after };
}
