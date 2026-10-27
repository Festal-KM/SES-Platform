// apps/web/lib/chat/attachment-token.ts
// ✅ 2026-10-27（紺野の決定。`docs/05` §6.5 #51p / #51）: チャットの添付の**アップロード札**（`uploadToken`）。
//
//     token = 'v1.' + base64url(JSON(claims)) + '.' + base64url(HMAC-SHA256(key, 'v1.' + base64url(JSON(claims))))
//
// 🔴 何を守るか: 添付のオブジェクトキーは**サーバが組む**（#51p）。送信（#51）は札を受け取り、札に焼き込んだキーだけを
//    発言の行に書く —— 利用者はキー・種類・大きさ・部屋・送る人を差し替えられない（差し替えると署名が合わない）。
//    札は**部屋と送る人とテナントに縛る**（別の部屋・別の人・別のテナントの札は、署名が正しくても受け付けない。照合は呼び出し側）。
// 🔴 鍵は `AUTH_SECRET` から HKDF で**用途を分けて**導く（同じ鍵を別の用途の署名に直接使わない）。新しい環境変数を足さない。
//    鍵そのものを返すアクセサを作らない（`anonymize/reference.ts` と同じ規律）。注入は起動時 1 回（`lib/db/bootstrap.ts`）。
// 🔴 例外メッセージ・戻り値に鍵を載せない。検証の失敗は理由を書き分けず `null`（呼び出し側が 400 にする）。
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { CHAT_ATTACHMENT_UPLOAD_TOKEN_TTL_MS } from '@ses/domain';
import { CHAT_ATTACHMENT_TOKEN_MAX_LENGTH } from './schemas';

/** 札に焼き込む値（すべてサーバが決めた値）。 */
export type ChatAttachmentUploadClaims = {
  readonly tenantId: string;
  readonly threadId: string;
  readonly userId: string;
  /** サーバが採番した発言の ID（この ID で発言の行を作る）。 */
  readonly messageId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: number;
  /** 有効期限（エポックからのミリ秒）。 */
  readonly expiresAt: number;
};

export type ChatAttachmentTokenCodec = {
  readonly sign: (claims: ChatAttachmentUploadClaims) => string;
  /** 署名・形・有効期限を確かめる。どれかが合わなければ `null`（理由を書き分けない）。 */
  readonly verify: (token: string, now: Date) => ChatAttachmentUploadClaims | null;
};

/** 札の有効期間（ミリ秒）。🔴 値の出所は domain（放置されたアップロードの片付けの古さと対で決める）。 */
export const CHAT_ATTACHMENT_TOKEN_TTL_MS = CHAT_ATTACHMENT_UPLOAD_TOKEN_TTL_MS;

const VERSION = 'v1';
const HKDF_INFO = 'ses/chat-attachment-upload-token/v1';
const MIN_SECRET_BYTES = 32;

export class ChatAttachmentTokenKeyError extends Error {
  constructor() {
    super(`チャットの添付の札の鍵は ${MIN_SECRET_BYTES} バイト以上の base64 である必要があります。`);
    this.name = 'ChatAttachmentTokenKeyError';
  }
}

function isClaims(value: unknown): value is ChatAttachmentUploadClaims {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.tenantId === 'string' &&
    typeof record.threadId === 'string' &&
    typeof record.userId === 'string' &&
    typeof record.messageId === 'string' &&
    typeof record.objectKey === 'string' &&
    typeof record.contentType === 'string' &&
    typeof record.byteSize === 'number' &&
    Number.isInteger(record.byteSize) &&
    typeof record.expiresAt === 'number' &&
    Number.isFinite(record.expiresAt)
  );
}

/**
 * 札の署名・検証を組み立てる。
 * @param secretBase64 `AUTH_SECRET`（base64。32 バイト以上。`packages/config` が起動時に検証済みの値）。
 * @throws ChatAttachmentTokenKeyError 鍵が短いとき（🔴 既定の鍵にフォールバックしない）。
 */
export function createChatAttachmentTokenCodec(secretBase64: string): ChatAttachmentTokenCodec {
  const secret = Buffer.from(secretBase64, 'base64');
  if (secret.length < MIN_SECRET_BYTES) throw new ChatAttachmentTokenKeyError();
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), HKDF_INFO, 32));
  const mac = (signed: string): Buffer => createHmac('sha256', key).update(signed, 'utf8').digest();

  return {
    sign(claims) {
      const body = Buffer.from(
        JSON.stringify({
          tenantId: claims.tenantId,
          threadId: claims.threadId,
          userId: claims.userId,
          messageId: claims.messageId,
          objectKey: claims.objectKey,
          contentType: claims.contentType,
          byteSize: claims.byteSize,
          expiresAt: claims.expiresAt,
        }),
        'utf8',
      ).toString('base64url');
      const signed = `${VERSION}.${body}`;
      return `${signed}.${mac(signed).toString('base64url')}`;
    },
    verify(token, now) {
      if (token.length > CHAT_ATTACHMENT_TOKEN_MAX_LENGTH) return null;
      const parts = token.split('.');
      if (parts.length !== 3 || parts[0] !== VERSION) return null;
      const [, body, signature] = parts as [string, string, string];
      const expected = mac(`${VERSION}.${body}`);
      const given = Buffer.from(signature, 'base64url');
      // 🔴 長さが違えば比べない（timingSafeEqual は長さ違いで例外を投げる）。比較は定数時間で行う。
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (!isClaims(parsed)) return null;
      if (parsed.expiresAt <= now.getTime()) return null;
      return parsed;
    },
  };
}
