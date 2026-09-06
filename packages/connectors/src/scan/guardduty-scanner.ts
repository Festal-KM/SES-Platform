// packages/connectors/src/scan/guardduty-scanner.ts
// 🔴 `MalwareScanner` の GuardDuty 実装（docs/05 §8.1 / §13.1）。T-05-05。
//
// 🔴 `enqueue()` は **no-op** である（docs/05 §8.1 の注記）。GuardDuty Malware Protection for S3 は
//    S3 の `PutObject` を契機に自動でスキャンし、アプリが起動する API を持たない（docs/03 §3.4.1）。
//    **「呼んだのに何も起きない」ではなく「呼ぶ必要が無い」** であり、`ObjectStore.presignPut` で
//    出した署名でブラウザが `PUT` した時点でスキャンは始まっている。
//    🔴 ここで例外を投げないこと —— 呼び出し側（将来の #19）が実装の種別で分岐しないためである。
//
// 🔴 `getResult()` は**保険**である（docs/03 §3.4.3-5「アプリはタグではなく EventBridge を正とする」）。
//    通常経路は `POST /api/webhooks/guardduty` → `scan.apply-result` であり、
//    ここが呼ばれるのは `scan.poll` が滞留（`SCAN_STALL_ALERT_MINUTES` 超）を見つけたときだけである。

import type { MalwareScanner } from '../interfaces.js';
import type { ScanResultReading } from '../types.js';
import type { ObjectTagApi } from './api.js';
import { GUARDDUTY_SCAN_STATUS_TAG, normalizeScanStatus } from './guardduty.js';

export type GuardDutyMalwareScannerOptions = {
  readonly api: ObjectTagApi;
  /** `S3_BUCKET`。🔴 全テナントで 1 つ（docs/05 §14.1 / docs/03 §3.4.3-1）。 */
  readonly bucket: string;
};

export class GuardDutyMalwareScanner implements MalwareScanner {
  private calls = 0;

  constructor(private readonly options: GuardDutyMalwareScannerOptions) {}

  /**
   * 🔴 no-op（S3 の Put が契機。ファイル冒頭の理由）。呼び出し回数だけは数える。
   *
   * 🔴 引数 `key` を使わないのは実装の手抜きではない —— GuardDuty には「この鍵をスキャンせよ」
   *    という API が存在しないためである（docs/03 §3.4.1）。`void key` で明示する。
   */
  async enqueue(key: string): Promise<void> {
    void key;
    this.calls += 1;
  }

  async getResult(key: string, versionId: string | null): Promise<ScanResultReading | null> {
    this.calls += 1;
    const response = await this.options.api.getObjectTagging({
      Bucket: this.options.bucket,
      Key: key,
      ...(versionId === null ? {} : { VersionId: versionId }),
    });
    // オブジェクトが無い（削除済み）→ 判定しようがない。
    if (response === null) return null;

    const rawStatus = response.Tags[GUARDDUTY_SCAN_STATUS_TAG];
    // 🔴 タグが無い = **まだ判定が付いていない**。`CLEAN` にも `FAILED` にも寄せない
    //    （タグ付与はバケット作成時に有効化する設定であり、無効な環境でも `null` になるだけで
    //    「安全」にはならない。docs/03 §3.4.3-4）。
    if (rawStatus === undefined || rawStatus === '') return null;

    const status = normalizeScanStatus(rawStatus);
    // 🔴 未知のタグ値も `null`（判定不能）。ファイルは `SCANNING` のまま滞留として残る。
    if (status === null || status === 'SCANNING') return null;

    return { status, rawStatus, objectVersionId: response.VersionId };
  }

  callCount(): number {
    return this.calls;
  }
}
