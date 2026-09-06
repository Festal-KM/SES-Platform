// apps/web/lib/webhooks/guardduty.ts
// 🔴 `POST /api/webhooks/guardduty` の本体（docs/05 §6.10 / §8.5 / docs/03 §3.4）。T-05-05。
//
// ============================================================================
// 🔴 受信の手順は固定である（docs/05 §8.5。プロバイダで変えない）
// ============================================================================
//   ① 署名検証（HMAC）→ 失敗なら **401**（正当な送信元でないので再送させてよい）
//   ② `dedupeKey` を組み立てて `WebhookDelivery` に INSERT
//      → 一意制約違反なら「処理済み」として **200** を返して終了（冪等）
//   ③ 🔴 **即座に 200 を返す**
//   ④ `scan.apply-result` を enqueue（処理はそこ。docs/05 §9.6）
//
// 🔴 **バリデーション失敗で 4xx を返さない**（docs/05 §8.5 の 🔴）。例外は署名検証失敗の 401 だけ。
//
// ============================================================================
// 🔴 GuardDuty は at-least-once であり、重複と順序逆転が起こる（docs/03 §3.4.1 / §3.4.3-2）
// ============================================================================
// - 重複は `dedupeKey`（`gd:{objectKey}:{versionId}`）の `UNIQUE` が 1 行に畳む
// - 🔴 **`duplicate` だけを見て捨てない。** 初回の INSERT 直後に enqueue が落ちると 500 になり
//   再送されるが、そのとき「重複だから」で捨てると**そのイベントは永久に処理されない**
//   （`CLAUDE.md` §11.1 と同型。SES 受信の iteration 2 で直したのと同じ罠）。判断材料は
//   `processedAt` の有無である
// - 順序逆転（`THREATS_FOUND` の後に `NO_THREATS_FOUND`）は**状態遷移の単調性**が無害化する
//   （`@ses/domain` の `decideScanStatusTransition`。適用は `scan.apply-result`）
//
// ============================================================================
// 🔴 バケットとテナントの検査を受信側で済ませる
// ============================================================================
// GuardDuty はバケット内の**全オブジェクト**の結果を送る（保護対象はバケット全体。
// docs/03 §3.4.3-1）。したがって受信側で
//   ① 起動時設定（`S3_BUCKET`）と一致するバケットか
//   ② キーが `t/{tenantId}/` 配下か（`tenantIdFromObjectKey`）
// を確かめる。どちらも満たさない結果は**未処理として記録**し（`A-005` が拾う）、
// ジョブには積まない。🔴 401 にしない —— 署名は正しく、送信元は我々自身だからである
// （設定の誤りであって攻撃ではない。再送させても直らない）。
//
// 🔴 **射程外の結果は、外来のオブジェクトキーを `dedupeKey` にも `payload` にも載せない**
//    （iteration 2 の指摘）。`WebhookDelivery` の両列は `A-005`（運用監視）と運営者の
//    監査ログ横断検索（`A-006`）に露出する（`CLAUDE.md` §10.5）。我々の命名規約に従っていない
//    文字列をそこへ素通しで載せない。重複の畳み込みはハッシュ（`outOfScopeDedupeKey`）で維持する。

import { createHash } from 'node:crypto';
import {
  GuardDutyEventParseError,
  guardDutyWebhookDedupeKey,
  parseGuardDutyScanEvent,
  serializeScanResult,
  verifyGuardDutySignature,
  GUARDDUTY_SIGNATURE_HEADER,
  type ScanApplyResultQueue,
} from '@ses/connectors';
import { tenantIdFromObjectKey } from '@ses/domain';
import { markWebhookDeliveryFailed, recordWebhookDelivery } from '@ses/db';

/**
 * ルートが返す HTTP の結果（🔴 200 か 401 の 2 値しかない）。
 *
 * - `ACCEPTED`: 新規受信 → enqueue した
 * - `DUPLICATE_REQUEUED`: 🔴 **重複配信だが未処理** → **再 enqueue した**
 * - `DUPLICATE`: 重複配信かつ処理済み → 何もしない
 * - `UNPARSABLE`: 解釈できなかった（未処理として記録。`A-005` が拾う）
 * - `OUT_OF_SCOPE`: バケット違い / テナントプレフィックス外（同上）
 */
export type GuardDutyWebhookOutcome =
  | {
      readonly status: 200;
      readonly kind: 'ACCEPTED' | 'DUPLICATE_REQUEUED' | 'DUPLICATE' | 'UNPARSABLE' | 'OUT_OF_SCOPE';
    }
  | { readonly status: 401 };

export type GuardDutyWebhookDeps = {
  /** 🔴 `GUARDDUTY_WEBHOOK_HMAC_SECRET`（+ ローテーション中の旧鍵）。空なら必ず 401。 */
  readonly secrets: readonly string[];
  /** 🔴 受け入れるバケット（`S3_BUCKET`）。全テナントで 1 つ（docs/05 §14.1）。 */
  readonly bucket: string;
  readonly queue: ScanApplyResultQueue;
  readonly now: () => Date;
};

/** 🔴 `dedupeKey` に載せる不透明な識別子（衝突しない長さだけ取る）。 */
function opaqueDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
}

/** 解釈できない本文でも重複を畳めるようにするための識別子（`id` が読めれば `id`）。 */
function unparsableEventId(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const id = (parsed as Record<string, unknown>).id;
      if (typeof id === 'string' && id !== '') return id;
    }
  } catch {
    // 本文が JSON ですらない。ハッシュに落とす。
  }
  // 🔴 本文そのものを `dedupeKey` に載せない（オブジェクトキーが監査横断検索に露出する）。
  return opaqueDigest(rawBody);
}

/**
 * 🔴 射程外（バケット違い / 規約外キー）の結果の `dedupeKey`（T-05-05 iteration 2）。
 *
 * 🔴 **通常経路の `gd:{objectKey}:{versionId}` を使わない。** 射程外のキーは
 *    「何が入っているか分からない」外来の文字列であり（この直下の `payload` で
 *    オブジェクトキーを落としているのと同じ理由）、`WebhookDelivery.dedupeKey` は
 *    `A-005`（運用監視）と運営者の監査ログ横断検索（`A-006`）に露出する（`CLAUDE.md` §10.5）。
 *    我々の命名規約に従っていないキーを、そこへ素通しで載せてはならない。
 * 🔴 **重複の畳み込みはハッシュでそのまま維持される**（同じキー × 版なら同じ値になる）。
 */
function outOfScopeDedupeKey(result: {
  readonly objectKey: string;
  readonly objectVersionId: string;
}): string {
  // 🔴 区切り文字を自前で決めない（`JSON.stringify` の配列表現をそのまま使う）。
  //    射程外のキーは任意の文字を含みうるため、区切りを選ぶと `'a|b' + 'c'` と
  //    `'a' + 'b|c'` の衝突を考える必要が出る（`MockMalwareScanner.compositeKey` と同じ規律）。
  return `gd:oos:${opaqueDigest(JSON.stringify([result.objectKey, result.objectVersionId]))}`;
}

/** 未処理として記録する（🔴 `processedAt` を立てない = `A-005` に残る）。 */
async function recordUnprocessable(
  input: {
    readonly dedupeKey: string;
    readonly externalEventId: string | null;
    readonly payload: Record<string, string | boolean>;
    readonly failureReason: string;
  },
  receivedAt: Date,
): Promise<void> {
  const record = await recordWebhookDelivery({
    provider: 'guardduty',
    externalEventId: input.externalEventId,
    dedupeKey: input.dedupeKey,
    payload: input.payload,
    receivedAt,
  });
  if (!record.duplicate) {
    await markWebhookDeliveryFailed(record.deliveryId, {
      failedAt: receivedAt,
      failureReason: input.failureReason,
    });
  }
}

/**
 * 🔴 受信の全体（署名検証 → 記録 → enqueue）。
 *
 * 🔴 **「解釈できない」で例外にしない**（200 + 未処理として記録し `A-005` が拾う）。
 *    一方で **DB や enqueue の失敗はそのまま投げる** —— 記録できていない以上、200 を返して
 *    「受け取った」ことにしてはならない。500 を返せば送信側が再送するので結果は失われない。
 */
export async function receiveGuardDutyWebhook(
  rawBody: string,
  headers: Headers,
  deps: GuardDutyWebhookDeps,
): Promise<GuardDutyWebhookOutcome> {
  const now = deps.now();

  // ① 🔴 署名検証。**生ボディ**で検証する（JSON へ parse して再直列化すると一致しない）。
  const verified = verifyGuardDutySignature({
    rawBody,
    signatureHeader: headers.get(GUARDDUTY_SIGNATURE_HEADER),
    secrets: deps.secrets,
    now,
  });
  if (!verified) return { status: 401 };

  let result;
  try {
    result = parseGuardDutyScanEvent(JSON.parse(rawBody) as unknown);
  } catch (error) {
    // 🔴 未知のステータス（`GuardDutyEventParseError`）も JSON 構文エラーもここに来る。
    //    **どちらも `CLEAN` に寄せない。** 対象ファイルは `SCANNING` のまま残り、
    //    `scan.poll` の滞留検知にも現れる（二重に見える）。
    if (!(error instanceof GuardDutyEventParseError) && !(error instanceof SyntaxError)) throw error;
    const eventId = unparsableEventId(rawBody);
    await recordUnprocessable(
      {
        dedupeKey: `gd:unparsable:${eventId}`,
        externalEventId: eventId,
        payload: { eventId, unparsable: true },
        failureReason: 'PARSE_ERROR',
      },
      now,
    );
    return { status: 200, kind: 'UNPARSABLE' };
  }

  // ② バケットとテナントプレフィックスの検査（ファイル冒頭の 🔴）。
  const tenantId = tenantIdFromObjectKey(result.objectKey);
  if (result.bucketName !== deps.bucket || tenantId === null) {
    await recordUnprocessable(
      {
        // 🔴 通常経路の `gd:{objectKey}:{versionId}` を使わない（`outOfScopeDedupeKey` の理由）。
        //    外来のオブジェクトキーは `dedupeKey` にも `payload` にも載せない。
        dedupeKey: outOfScopeDedupeKey(result),
        externalEventId: null,
        // 🔴 オブジェクトキーそのものを payload に残さない（想定外のバケットのキーは
        //    我々の命名規約に従っておらず、何が入っているか分からない）。
        payload: {
          bucketMatched: result.bucketName === deps.bucket,
          tenantScopedKey: tenantId !== null,
        },
        failureReason: result.bucketName === deps.bucket ? 'UNSCOPED_OBJECT_KEY' : 'UNEXPECTED_BUCKET',
      },
      now,
    );
    return { status: 200, kind: 'OUT_OF_SCOPE' };
  }

  // ③ 受信の記録。🔴 保存するのは**正規化済み**の形だけである（docs/05 §3.9 / §16.2）。
  const record = await recordWebhookDelivery({
    provider: 'guardduty',
    externalEventId: null,
    dedupeKey: guardDutyWebhookDedupeKey(result),
    payload: serializeScanResult(result),
    receivedAt: now,
  });

  // 🔴 判断材料は `duplicate` ではなく `processed`（ファイル冒頭の理由）。
  //    二重 enqueue は無害である —— `scan.apply-result` は `processedAt` の CAS、
  //    `FileScanResult` の `UNIQUE`、状態遷移の単調性の 3 段で冪等だからである。
  if (record.duplicate && record.processed) return { status: 200, kind: 'DUPLICATE' };

  await deps.queue.enqueue({ deliveryId: record.deliveryId });
  return { status: 200, kind: record.duplicate ? 'DUPLICATE_REQUEUED' : 'ACCEPTED' };
}
