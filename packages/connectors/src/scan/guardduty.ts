// packages/connectors/src/scan/guardduty.ts
// 🔴 GuardDuty Malware Protection for S3 の**結果の正規化**（docs/05 §8.1 の表
//    「GuardDuty の `NO_THREATS_FOUND` などの生ステータス」/ §8.5 / docs/03 §3.4）。T-05-05。
//
// ============================================================================
// 🔴 このコネクタが「スキャンを開始する API」を持たない理由
// ============================================================================
// GuardDuty Malware Protection for S3 は **S3 の `PutObject` / `CopyObject` /
// `CompleteMultipartUpload` を契機に自動でスキャンする**（docs/03 §3.4.1）。アプリから
// 「この鍵をスキャンせよ」と依頼する API は存在しない。したがって `MalwareScanner.enqueue()` は
// **no-op** であり（docs/05 §8.1 の注記どおり）、本コネクタの責務は次の 2 つだけである:
//   ① 結果（EventBridge のイベント）を**内部型に正規化する**
//   ② 保険のポーリング（`scan.poll`）で**現在の判定を照会する**（S3 のオブジェクトタグ）
//
// ============================================================================
// 🔴 生ステータスを `CLEAN` に寄せない（docs/03 §3.4.3-3 / `BR-26`）
// ============================================================================
// `UNSUPPORTED` / `ACCESS_DENIED` / `FAILED` は「安全だと確認できた」ではなく
// 「判定できなかった」である。`BR-26` は「`CLEAN` になるまで共有 URL を発行しない」であり、
// **判定不能はすべて共有不可**に倒す。
// 🔴 **未知の生ステータスも `CLEAN` に寄せない。** 既知の表に無い値は `GuardDutyEventParseError`
//    として扱い、受信は 200 のまま**未処理として記録する**（`A-005` が拾う。docs/05 §8.5）。
//    対象ファイルは `SCANNING` のまま残り、`scan.poll` の滞留検知にも現れる ——
//    「解釈できなかったので安全とみなす」経路を 1 本も作らない。
//
// ============================================================================
// 🔴 HMAC 署名について（docs/05 §6.10 / §8.5 / docs/03 §3.1.5 の GuardDuty 行）
// ============================================================================
// EventBridge の **API Destination（Connection）は本文の HMAC を計算できない**
// （認証方式は静的ヘッダ / Basic / OAuth のいずれか）。docs/03 §3.1.5 が
// 「GuardDuty: EventBridge → 自前の受信であれば **HMAC を自分で載せる**」と書いているのは
// この制約を指しており、署名を付けるのは**こちら側の送信経路**（EventBridge → 署名を付与する
// 転送処理 → 本エンドポイント）である。**署名の仕様の正はこのファイル**であり、
// 転送側はこれに合わせる（docs/05 §8.5 の申し送りを参照）。
//
// 仕様（Stripe の `Stripe-Signature` と同型。理由は下の各コメント）:
//   ヘッダ `x-ses-platform-signature: t={unixSeconds},v1={hex(HMAC-SHA256(secret, "{t}.{rawBody}"))}`
//   - 🔴 **署名対象に時刻を含める**（再送攻撃を許容時間で切るため。本文だけの HMAC は永久に有効）
//   - 🔴 **生ボディで検証する**（JSON を再直列化するとキー順・空白が変わって一致しない）
//   - 🔴 **複数の鍵を許容する**（無停止のローテーション。DocuSign Connect と同じ扱い）
//   - 🔴 **比較は時間一定**（`timingSafeEqual`）

import { createHmac, timingSafeEqual } from 'node:crypto';
import { isScanStatus, type ScanStatus } from '../types.js';

/** 解釈できない GuardDuty のイベント（🔴 握り潰さず失敗させる。`normalizeSesEvent` と同じ規律）。 */
export class GuardDutyEventParseError extends Error {
  constructor(reason: string) {
    super(`GuardDuty のスキャン結果を解釈できません（${reason}）。`);
    this.name = 'GuardDutyEventParseError';
  }
}

/**
 * 🔴 GuardDuty の生ステータス → 内部型（docs/03 §3.4.1「結果のステータス」/ §3.4.3-3）。
 *
 * 上段 5 値が `detail.scanResultDetails.scanResultStatus`、下段 2 値が `detail.scanStatus` の
 * うち結果が確定するもの（`COMPLETED` は「`scanResultDetails` を見よ」という意味なので**表に無い**）。
 * 🔴 表に無い値は `null` を返し、呼び出し側が `GuardDutyEventParseError` にする。
 */
const GUARDDUTY_STATUS_MAP: Readonly<Record<string, ScanStatus>> = {
  NO_THREATS_FOUND: 'CLEAN',
  THREATS_FOUND: 'INFECTED',
  // 🔴 スキャン対象外の形式 = 「安全」ではない。共有不可に倒す。
  UNSUPPORTED: 'UNSCANNABLE',
  // 🔴 権限不足・スキャン失敗も「安全」ではない。
  ACCESS_DENIED: 'FAILED',
  FAILED: 'FAILED',
  // `detail.scanStatus` 側の値（`scanResultDetails` を伴わないことがある）。
  SKIPPED: 'UNSCANNABLE',
};

/** S3 のオブジェクトタグ（`GuardDutyMalwareScanStatus`）の名前（docs/03 §3.4.1）。 */
export const GUARDDUTY_SCAN_STATUS_TAG = 'GuardDutyMalwareScanStatus';

/**
 * 生ステータスを内部型へ。未知なら `null`（🔴 `CLEAN` にも `FAILED` にも**推測で**寄せない）。
 */
export function normalizeScanStatus(rawStatus: string): ScanStatus | null {
  return GUARDDUTY_STATUS_MAP[rawStatus] ?? null;
}

/**
 * 正規化済みのスキャン結果（`WebhookDelivery.payload` に保存する形でもある）。
 * 🔴 サービス固有の語を持たない（`rawStatus` だけが生値であり、監査のために残す）。
 */
export type NormalizedScanResult = {
  readonly bucketName: string;
  readonly objectKey: string;
  /** 🔴 バージョニング有効が前提（docs/05 §14.1）。`UNIQUE(object_key, version_id)` の一方。 */
  readonly objectVersionId: string;
  readonly status: ScanStatus;
  /** GuardDuty の生値（`file_scan_results.raw_status`）。 */
  readonly rawStatus: string;
  /** イベントの発生時刻（受信時刻ではない）。 */
  readonly occurredAt: Date;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOf(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * 🔴 EventBridge のイベント（`detail-type: 'GuardDuty Malware Protection Object Scan Result'`）を
 *    正規化する（docs/03 §3.4.1「結果の通知」）。
 *
 * 🔴 **欠けている値を既定値で埋めない。** `versionId` を空文字に丸めると
 *    `UNIQUE(object_key, version_id)` が全オブジェクトで衝突し、重複排除が機能しなくなる
 *    （`aws-sdk-s3.ts` の `HeadObject` と同じ理由）。
 */
export function parseGuardDutyScanEvent(raw: unknown): NormalizedScanResult {
  const record = asRecord(raw);
  if (record === null) throw new GuardDutyEventParseError('オブジェクトではありません');

  const detail = asRecord(record.detail);
  if (detail === null) throw new GuardDutyEventParseError('detail がありません');

  const object = asRecord(detail.s3ObjectDetails);
  if (object === null) throw new GuardDutyEventParseError('detail.s3ObjectDetails がありません');

  const bucketName = stringOf(object, 'bucketName');
  if (bucketName === null) throw new GuardDutyEventParseError('bucketName がありません');
  const objectKey = stringOf(object, 'objectKey');
  if (objectKey === null) throw new GuardDutyEventParseError('objectKey がありません');
  const objectVersionId = stringOf(object, 'versionId');
  if (objectVersionId === null) {
    throw new GuardDutyEventParseError(
      'versionId がありません（バケットのバージョニングが有効か確認してください。docs/05 §14.1）',
    );
  }

  // 🔴 結果の正は `scanResultDetails.scanResultStatus`。無い場合（`SKIPPED` / `FAILED` など
  //    結果詳細を伴わないイベント）だけ `detail.scanStatus` に落ちる。**両方無ければ失敗**。
  const resultDetails = asRecord(detail.scanResultDetails);
  const rawStatus =
    (resultDetails === null ? null : stringOf(resultDetails, 'scanResultStatus')) ??
    stringOf(detail, 'scanStatus');
  if (rawStatus === null) {
    throw new GuardDutyEventParseError('scanResultStatus / scanStatus がありません');
  }

  const status = normalizeScanStatus(rawStatus);
  if (status === null) {
    // 🔴 未知の値を CLEAN にも FAILED にも寄せない（ファイルは SCANNING のまま残り、
    //    受信は未処理として `A-005` に出る）。
    throw new GuardDutyEventParseError(`未知の scanResultStatus です（${rawStatus}）`);
  }

  const occurredAtRaw = stringOf(record, 'time');
  if (occurredAtRaw === null) throw new GuardDutyEventParseError('time がありません');
  const occurredAt = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new GuardDutyEventParseError('time が日時として不正です');
  }

  return { bucketName, objectKey, objectVersionId, status, rawStatus, occurredAt };
}

/**
 * 🔴 `WebhookDelivery.dedupeKey`（docs/05 §8.5 の表: `gd:{objectKey}:{versionId}`）。
 *
 * GuardDuty は**同じオブジェクト版に対して 1 つの判定**を出し、at-least-once で再送する
 * （docs/03 §3.4.1）。したがって重複の単位は「オブジェクト × 版」であり、ステータスを
 * 鍵に含めない —— 含めると、同じ版に対する再送が**別のイベントとして 2 回処理される**。
 */
export function guardDutyWebhookDedupeKey(result: {
  readonly objectKey: string;
  readonly objectVersionId: string;
}): string {
  return `gd:${result.objectKey}:${result.objectVersionId}`;
}

/** `WebhookDelivery.payload` に保存する形（JSON 化できる形へ落とす）。 */
export type SerializedScanResult = {
  readonly bucketName: string;
  readonly objectKey: string;
  readonly objectVersionId: string;
  readonly status: ScanStatus;
  readonly rawStatus: string;
  /** ISO 8601（UTC）。 */
  readonly occurredAt: string;
};

export function serializeScanResult(result: NormalizedScanResult): SerializedScanResult {
  return {
    bucketName: result.bucketName,
    objectKey: result.objectKey,
    objectVersionId: result.objectVersionId,
    status: result.status,
    rawStatus: result.rawStatus,
    occurredAt: result.occurredAt.toISOString(),
  };
}

/** 保存済みの正規化結果を読み戻す（`scan.apply-result` が使う）。 */
export function parseSerializedScanResult(raw: unknown): NormalizedScanResult {
  const record = asRecord(raw);
  if (record === null) {
    throw new GuardDutyEventParseError('保存済みの結果がオブジェクトではありません');
  }
  const bucketName = stringOf(record, 'bucketName');
  const objectKey = stringOf(record, 'objectKey');
  const objectVersionId = stringOf(record, 'objectVersionId');
  const status = stringOf(record, 'status');
  const rawStatus = stringOf(record, 'rawStatus');
  const occurredAtRaw = stringOf(record, 'occurredAt');
  if (
    bucketName === null ||
    objectKey === null ||
    objectVersionId === null ||
    status === null ||
    rawStatus === null ||
    occurredAtRaw === null
  ) {
    throw new GuardDutyEventParseError('保存済みの結果に必須フィールドがありません');
  }
  if (!isScanStatus(status)) throw new GuardDutyEventParseError(`未知の status です（${status}）`);
  const occurredAt = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new GuardDutyEventParseError('occurredAt が日時として不正です');
  }
  return { bucketName, objectKey, objectVersionId, status, rawStatus, occurredAt };
}

// ---------------------------------------------------------------------------
// HMAC 署名の検証（ファイル冒頭の仕様）
// ---------------------------------------------------------------------------

/** 🔴 署名を載せるヘッダ。転送側はこの名前で送る。 */
export const GUARDDUTY_SIGNATURE_HEADER = 'x-ses-platform-signature';

/** 署名の許容時刻差（秒）。既定 5 分。 */
export const GUARDDUTY_SIGNATURE_TOLERANCE_SECONDS = 300;

export type GuardDutySignatureVerifyInput = {
  /** 🔴 **生ボディ**（`request.text()` の結果）。JSON へ parse したものを渡さない。 */
  readonly rawBody: string;
  /** ヘッダ値（`x-ses-platform-signature`）。 */
  readonly signatureHeader: string | null;
  /** 🔴 base64 の共有鍵。ローテーション中は複数（いずれか 1 つ一致で成功）。 */
  readonly secrets: readonly string[];
  readonly now: Date;
  readonly toleranceSeconds?: number;
};

/** `t=...,v1=...` を分解する。形が違えば `null`（🔴 部分一致で通さない）。 */
function parseSignatureHeader(
  header: string,
): { readonly timestamp: number; readonly signatures: readonly string[] } | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't') {
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) return null;
      timestamp = parsed;
    } else if (key === 'v1' && value !== '') {
      signatures.push(value);
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/** 🔴 時間一定比較（長さが違うときも早期 return しない形にそろえる）。 */
function timingSafeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // 長さが違えば必ず不一致だが、`timingSafeEqual` は長さ違いで throw する。
    // 同じ長さの捨てバッファと比較して、比較そのものの時間差を作らない。
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * 🔴 署名の検証（docs/05 §8.5 ①）。失敗なら `false` → ルートは **401** を返す。
 *
 * 🔴 鍵が 1 つも無いときは `false`（**fail-closed**）。「未設定なら検証しない」は
 *    `CLAUDE.md` §11.1 と同型の壊れ方（誰でも任意のスキャン結果を流し込める）になる。
 */
export function verifyGuardDutySignature(input: GuardDutySignatureVerifyInput): boolean {
  if (input.signatureHeader === null || input.signatureHeader === '') return false;
  if (input.secrets.length === 0) return false;

  const parsed = parseSignatureHeader(input.signatureHeader);
  if (parsed === null) return false;

  const tolerance = input.toleranceSeconds ?? GUARDDUTY_SIGNATURE_TOLERANCE_SECONDS;
  const skewSeconds = Math.abs(Math.floor(input.now.getTime() / 1000) - parsed.timestamp);
  // 🔴 過去方向（再送）だけでなく未来方向も切る（時計をずらした署名を無期限に使わせない）。
  if (skewSeconds > tolerance) return false;

  const signedPayload = `${parsed.timestamp}.${input.rawBody}`;
  for (const secret of input.secrets) {
    const expected = createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(signedPayload, 'utf8')
      .digest('hex');
    for (const candidate of parsed.signatures) {
      if (timingSafeEqualHex(expected, candidate.toLowerCase())) return true;
    }
  }
  return false;
}

/**
 * 🔴 テストと**転送側の実装**が同じ 1 つの関数で署名を作れるようにする（2 実装にしない）。
 *    本番の署名者はこの仕様に従う（ファイル冒頭）。
 */
export function buildGuardDutySignatureHeader(input: {
  readonly rawBody: string;
  readonly secret: string;
  readonly now: Date;
}): string {
  const timestamp = Math.floor(input.now.getTime() / 1000);
  const signature = createHmac('sha256', Buffer.from(input.secret, 'base64'))
    .update(`${timestamp}.${input.rawBody}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}
