// packages/connectors/src/scan/api.ts
// 🔴 GuardDuty の判定を**照会**するための外部境界（docs/03 §3.4.1 / §3.4.3-5）。T-05-05。
//
// ============================================================================
// 🔴 なぜ「GuardDuty の API」ではなく「S3 のオブジェクトタグ」なのか
// ============================================================================
// GuardDuty Malware Protection for S3 は、結果を **EventBridge に発行**し、
// **オプションでオブジェクトに `GuardDutyMalwareScanStatus` タグを付与**する（docs/03 §3.4.1）。
// 「この鍵の判定を教えろ」という照会 API は存在しない。したがって保険のポーリング
// （`scan.poll`。docs/05 §8.5「Webhook が届かない場合の保険」）で読めるのはタグだけである。
//
// 🔴 **アプリはタグではなく EventBridge を正とする**（docs/03 §3.4.3-5）。タグは
//    「EventBridge が届かなかったとき」にだけ見る二次的な確認手段であり、
//    通常の経路（`POST /api/webhooks/guardduty` → `scan.apply-result`）を置き換えない。
//
// 🔴 本ポートの実装は AWS SDK のアダプタ 1 ファイル（`storage/aws-sdk-s3.ts`）だけである
//    （`tests/static/aws-sdk-single-path.test.ts` が import 元を固定する）。
//    `S3Api` と分けてあるのは、`S3ObjectStore`（保管という機能）と
//    `GuardDutyMalwareScanner`（スキャンという機能）で必要な操作が違うためである。

export type ObjectTagRequest = {
  readonly Bucket: string;
  readonly Key: string;
  /** 版を指定して読む（`null` なら最新版）。 */
  readonly VersionId?: string;
};

export type ObjectTagResponse = {
  /** タグ名 → 値。タグが 1 つも無ければ空オブジェクト。 */
  readonly Tags: Readonly<Record<string, string>>;
  /** 🔴 実際に読んだ版（`FileScanResult.objectVersionId` の出所）。 */
  readonly VersionId: string;
};

/**
 * 🔴 `GuardDutyMalwareScanner` が依存する唯一の外部境界。
 *
 * 実装は 2 つだけである:
 *   - AWS SDK のアダプタ（`createObjectTagApi`。`storage/aws-sdk-s3.ts`）
 *   - テストが注入するモック
 */
export interface ObjectTagApi {
  /** 存在しなければ `null`（404 を例外にしない。滞留したファイルの照会で使うため）。 */
  getObjectTagging(request: ObjectTagRequest): Promise<ObjectTagResponse | null>;
}
