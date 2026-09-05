// apps/web/lib/webhooks/sns.ts
// 🔴 Amazon SNS のメッセージ署名検証（docs/03 §3.2.5「必ず検証する」/ docs/05 §8.5 手順①）。T-04-03。
//
// ============================================================================
// 🔴 なぜ自前で書くのか / 何を信頼しているのか
// ============================================================================
// SES のバウンス・苦情は configuration set の event destination から **SNS の HTTPS
// サブスクリプション**として届く（docs/03 §3.2.5）。SNS は HMAC ではなく**公開鍵署名**であり、
// 検証には ①正規化した署名対象文字列 ②Amazon が発行した証明書 の 2 つが要る。
//
// 信頼の根拠は「**証明書の取得先が Amazon のホストであること**」である。したがって
// `SigningCertURL` のホスト検査を緩めると、攻撃者が自分の証明書を指す URL を送るだけで
// 任意のペイロードを通せる。🔴 **ここは緩めてはならない。**
//
// 🔴 ネットワーク取得（証明書のフェッチ）は**注入する**。実 SNS のエンドポイントに接続せずに
//    検証ロジックをテストできるようにするためであり、テストは自己生成鍵で署名した
//    フィクスチャを使う（`sns.test.ts`）。
//
// 🔴 検証に失敗したら **401** を返す（docs/05 §8.5。正当な送信元でないので再送させてよい）。
//    それ以外は成功・失敗にかかわらず 200 である（4xx を再送しないプロバイダがあるため）。

import { createPublicKey, createVerify } from 'node:crypto';

/** SNS のメッセージ種別（docs/05 §6.10「`SubscriptionConfirmation` も処理」）。 */
export const SNS_MESSAGE_TYPES = [
  'Notification',
  'SubscriptionConfirmation',
  'UnsubscribeConfirmation',
] as const;

export type SnsMessageType = (typeof SNS_MESSAGE_TYPES)[number];

export type SnsMessage = {
  readonly Type: SnsMessageType;
  readonly MessageId: string;
  readonly TopicArn: string;
  readonly Message: string;
  readonly Timestamp: string;
  readonly SignatureVersion: string;
  readonly Signature: string;
  readonly SigningCertURL: string;
  readonly Subject?: string;
  readonly Token?: string;
  readonly SubscribeURL?: string;
};

/** 署名検証に失敗した（→ 401）。🔴 理由をレスポンスに載せない（総当たりの手がかりになる）。 */
export class SnsSignatureError extends Error {
  constructor(readonly reason: string) {
    super(`SNS メッセージの署名検証に失敗しました（${reason}）。`);
    this.name = 'SnsSignatureError';
  }
}

/**
 * 🔴 証明書の取得を許す唯一のホスト形（`sns.{region}.amazonaws.com`）。
 *    AWS 公式の検証手順が定める条件であり、これが信頼の起点である。
 */
const SIGNING_CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

/**
 * 署名対象に含めるフィールド（AWS の仕様。**順序も仕様の一部**）。
 * 🔴 種別ごとに集合が違う。取り違えると正当なメッセージが落ちるか、逆に改竄が通る。
 */
const SIGNED_FIELDS: Readonly<Record<SnsMessageType, readonly string[]>> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: [
    'Message',
    'MessageId',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
  UnsubscribeConfirmation: [
    'Message',
    'MessageId',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
};

/** 🔴 古いメッセージを受け付けない（リプレイの窓を閉じる）。AWS の推奨に合わせて 1 時間。 */
export const SNS_MAX_MESSAGE_AGE_MS = 60 * 60 * 1000;

function isSnsMessageType(value: unknown): value is SnsMessageType {
  return typeof value === 'string' && (SNS_MESSAGE_TYPES as readonly string[]).includes(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') {
    throw new SnsSignatureError(`${key} がありません`);
  }
  return value;
}

/**
 * 生ボディを SNS メッセージとして解釈する。
 * 🔴 ここで throw するのは**署名検証以前の形の不備**であり、呼び出し側は 401 に写像する
 *    （署名の無いリクエストを 200 で受け取ると、`WebhookDelivery` がゴミで埋まる）。
 */
export function parseSnsMessage(rawBody: string): SnsMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new SnsSignatureError('JSON として解釈できません');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SnsSignatureError('オブジェクトではありません');
  }
  const record = parsed as Record<string, unknown>;
  if (!isSnsMessageType(record.Type)) throw new SnsSignatureError('Type が未知です');

  const message: SnsMessage = {
    Type: record.Type,
    MessageId: requireString(record, 'MessageId'),
    TopicArn: requireString(record, 'TopicArn'),
    Message: requireString(record, 'Message'),
    Timestamp: requireString(record, 'Timestamp'),
    SignatureVersion: requireString(record, 'SignatureVersion'),
    Signature: requireString(record, 'Signature'),
    SigningCertURL: requireString(record, 'SigningCertURL'),
    ...(typeof record.Subject === 'string' ? { Subject: record.Subject } : {}),
    ...(typeof record.Token === 'string' ? { Token: record.Token } : {}),
    ...(typeof record.SubscribeURL === 'string' ? { SubscribeURL: record.SubscribeURL } : {}),
  };
  return message;
}

/**
 * 署名対象文字列（AWS の仕様: `key + '\n' + value + '\n'` を規定の順で連結）。
 * 🔴 存在しない任意フィールド（`Subject`）は**行ごと省く**（空行を入れると署名が一致しない）。
 */
export function snsStringToSign(message: SnsMessage): string {
  const record = message as unknown as Record<string, unknown>;
  let result = '';
  for (const field of SIGNED_FIELDS[message.Type]) {
    const value = record[field];
    if (typeof value !== 'string') continue;
    result += `${field}\n${value}\n`;
  }
  return result;
}

/** 🔴 `SigningCertURL` の検査（信頼の起点）。https かつ Amazon のホストに限る。 */
export function assertSigningCertUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SnsSignatureError('SigningCertURL が URL ではありません');
  }
  if (url.protocol !== 'https:') throw new SnsSignatureError('SigningCertURL が https ではありません');
  if (!SIGNING_CERT_HOST.test(url.hostname)) {
    throw new SnsSignatureError('SigningCertURL のホストが Amazon SNS ではありません');
  }
  if (!url.pathname.endsWith('.pem')) throw new SnsSignatureError('SigningCertURL が .pem ではありません');
  return url;
}

/** 署名アルゴリズム（`SignatureVersion`）。1 = RSA-SHA1、2 = RSA-SHA256。 */
function digestAlgorithm(signatureVersion: string): string {
  if (signatureVersion === '1') return 'RSA-SHA1';
  if (signatureVersion === '2') return 'RSA-SHA256';
  throw new SnsSignatureError('SignatureVersion が未知です');
}

/** 証明書（PEM）の取得。🔴 実 SNS に接続しないテストのために注入する。 */
export type SigningCertificateLoader = (url: URL) => Promise<string>;

export type SnsVerificationOptions = {
  readonly loadCertificate: SigningCertificateLoader;
  /** 🔴 現在時刻の注入（リプレイ窓の検査をテストで固定するため）。 */
  readonly now: () => Date;
};

/**
 * 🔴 SNS メッセージを検証する（docs/05 §8.5 手順①）。
 *
 * 失敗はすべて `SnsSignatureError` であり、呼び出し側は **401** に写像する。
 * 🔴 成功しても「何を処理するか」はここでは決めない（受信と処理を分ける。docs/05 §8.5）。
 */
export async function verifySnsMessage(
  message: SnsMessage,
  options: SnsVerificationOptions,
): Promise<void> {
  const timestamp = new Date(message.Timestamp);
  if (Number.isNaN(timestamp.getTime())) throw new SnsSignatureError('Timestamp が日時ではありません');
  const ageMs = options.now().getTime() - timestamp.getTime();
  if (ageMs > SNS_MAX_MESSAGE_AGE_MS) throw new SnsSignatureError('Timestamp が古すぎます');

  const algorithm = digestAlgorithm(message.SignatureVersion);
  const certUrl = assertSigningCertUrl(message.SigningCertURL);
  const pem = await options.loadCertificate(certUrl);

  let publicKey;
  try {
    publicKey = createPublicKey(pem);
  } catch {
    throw new SnsSignatureError('署名証明書を読み込めません');
  }

  const verifier = createVerify(algorithm);
  verifier.update(snsStringToSign(message), 'utf8');
  verifier.end();

  let valid = false;
  try {
    valid = verifier.verify(publicKey, message.Signature, 'base64');
  } catch {
    valid = false;
  }
  if (!valid) throw new SnsSignatureError('署名が一致しません');
}
