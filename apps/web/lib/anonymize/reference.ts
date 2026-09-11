// apps/web/lib/anonymize/reference.ts
// 🔴 匿名候補の**案件スコープの参照子**（`CLAUDE.md` §3.1 経路 4 / `F-017 AC-2` / `BR-55`）。T-08-04。
//
//     candidateRef = base64url( HMAC-SHA256(secret, projectId + '\0' + engineerId)[0..16) )
//
// 🔴 **`engineer_id` を応答に載せないための代替物**である（`docs/05` §4.6 / `docs/03` §4.13.2-1）。
//    鍵付き入力に `project_id` を含めるので、**同じエンジニアでも案件が違えば別の参照子**になる
//    —— これが「同一人物であることをホストが案件をまたいで突き合わせられない」ことの中核である。
//
// ---------------------------------------------------------------------------
// 🔴 なぜ `packages/domain` ではなくここに在るか（`docs/05` §4.6 改訂 10。2026-09-11）
// ---------------------------------------------------------------------------
// `docs/05` §4.6 は当初この関数を `packages/domain/src/anonymize/reference.ts` に置いていたが、
// **実装できない**。`packages/domain` は `node:crypto` を import できず（`CLAUDE.md` §2.1。
// `eslint.config.mjs` の `packages/domain` ゾーンの `forbidNodeIo` と
// `tests/static/domain-purity.test.ts` の `NODE_IO_MODULE_NAMES` が `crypto` を含み、二重に塞ぐ）、
// 迂回はいずれも担保を弱める:
//   - **SHA-256 / HMAC を自前実装する** … 暗号プリミティブの再実装であり、誤りが
//     「参照子が推測できる」形で現れる
//   - **`hmac` を引数で注入する** … 呼び出し側が HMAC 以外を渡せる形になり、
//     「参照子が HMAC である」という保証そのものが型の外に出る（粒度 `config` や
//     基準日 `referenceDate` の注入は**値**の注入であって、性質が違う）
//   - **構成だけ domain / HMAC だけアプリ** … 1 つの不変条件が 2 ファイルに割れる
// したがって `node:crypto` を使える場所に**まとめて 1 実装**として置いた。
//
// ⚠️ **`apps/worker` が要るようになったら（Phase 2 の `match.build` 相当）、複製せずモジュールごと
//    共有パッケージへ移すこと**（`CLAUDE.md` §2.1「業務ロジックを重複実装しない」）。
//    現状の Phase 1 では、参照子を作るのは**読み出し側の API（`apps/web`）だけ**である。
//
// ---------------------------------------------------------------------------
// 🔴 鍵の扱い（`CLAUDE.md` §3.5）
// ---------------------------------------------------------------------------
//   - 鍵は `ANON_REFERENCE_HMAC_SECRET`。**唯一の出所は `packages/config` の Zod スキーマ**であり
//     （`base64AtLeastBytes(32)` で起動時に検証済み）、本ファイルは `process.env` を読まない。
//   - 注入は起動時 1 回（`apps/web/lib/db/bootstrap.ts` の `candidateReference()`）。
//     🔴 **鍵そのものを返すアクセサを作らない** —— 公開するのは鍵を閉じ込めた**関数**だけである
//     （S3 の資格情報を `storageRuntime()` に載せず `objectStore()` の内側に閉じたのと同じ）。
//   - 🔴 **例外メッセージに鍵・`projectId` / `engineerId` を載せない**（ログ・Sentry・監査ログに
//     残ってはならない。`packages/domain` の丸め関数が受け取った値を載せないのと同じ規律）。
import { createHmac } from 'node:crypto';

/** 参照子に使う HMAC の先頭バイト数（`docs/03` §4.13.2-1「先頭 16 バイト」）。 */
export const CANDIDATE_REF_BYTES = 16;

/**
 * 参照子の表記（base64url。16 バイト = パディング無しで 22 文字）。
 *
 * 🔴 **UUID（36 文字・ハイフン 4 本）はこの形に一致しない。** したがってこのパターンを
 *    入口で課すだけで、「`engineerId` をそのまま参照子として応答に載せる」実装ミスは
 *    **組み立ての時点で落ちる**（`candidate-view.ts` が実際に課している）。
 */
export const CANDIDATE_REF_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * 案件スコープの参照子を作る関数。
 * 🔴 **鍵を引数に取らない**（鍵は `createCandidateReference` のクロージャに閉じる）。
 */
export type CandidateReference = (projectId: string, engineerId: string) => string;

/** 鍵の最小長（`packages/config` の `ANON_REFERENCE_HMAC_SECRET` と同じ 32 バイト）。 */
const MIN_SECRET_BYTES = 32;

/**
 * 🔴 区切りは **NUL（U+0000）**。UUID に含まれ得ない文字なので、
 *    `(projectId, engineerId)` の組から HMAC 入力への写像が単射になる
 *    （区切りが無い / 区切りが ID に現れうると、別の組が同じ参照子になりうる）。
 */
const SEPARATOR = '\0';

/**
 * `projectId` / `engineerId` は必ず UUID である（`@db.Uuid`）。
 * 🔴 形を入口で確かめるのは 2 つの理由による: ①NUL を含み得ないことを保証して上記の単射性を
 *    成立させる ②引数の取り違え（案件と人を逆に渡す等ではなく、**UUID でない値**を渡す実装ミス）を
 *    黙って別の参照子に変えず、その場で落とす。
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 参照子の生成・入力検証の失敗。
 * 🔴 **鍵も ID も message に含めない**（`TokenEncryptionError` と同じ規律）。
 */
export class CandidateReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandidateReferenceError';
  }
}

function assertUuid(fieldName: 'projectId' | 'engineerId', value: string): void {
  if (!UUID_PATTERN.test(value)) {
    // 🔴 受け取った値そのものを載せない（`engineerId` は応答にも記録にも出してはならない値である）。
    throw new CandidateReferenceError(`${fieldName} は UUID である必要があります。`);
  }
}

/**
 * 🔴 匿名候補の参照子を作る関数を組み立てる（`docs/05` §4.6 / `F-017 AC-2` / `BR-55`）。
 *
 * @param secretBase64 `ANON_REFERENCE_HMAC_SECRET`（base64。32 バイト以上）。
 *        **`packages/config` が起動時に検証した値**をそのまま渡す。
 *
 * @throws CandidateReferenceError 鍵が短い / base64 として解釈できないとき。
 *         🔴 **既定の鍵にフォールバックしない。** フォールバックすると、鍵の設定漏れが
 *         「参照子が全環境で同じ」＝ 案件スコープの意味が消えた状態で本番に出る。
 */
export function createCandidateReference(secretBase64: string): CandidateReference {
  const secret = Buffer.from(secretBase64, 'base64');
  if (secret.length < MIN_SECRET_BYTES) {
    throw new CandidateReferenceError(
      `ANON_REFERENCE_HMAC_SECRET は ${MIN_SECRET_BYTES} バイト以上の base64 である必要があります。`,
    );
  }

  return (projectId, engineerId) => {
    assertUuid('projectId', projectId);
    assertUuid('engineerId', engineerId);
    // 🔴 UUID の表記ゆれ（大文字）で参照子が変わらないようにする。DB は小文字で返すが、
    //    大小が混ざると**同じ人が同じ案件で違う参照子**になり、提案依頼の逆引き（T-08-06）が
    //    静かに外れる。
    const message = `${projectId.toLowerCase()}${SEPARATOR}${engineerId.toLowerCase()}`;
    return createHmac('sha256', secret)
      .update(message, 'utf8')
      .digest()
      .subarray(0, CANDIDATE_REF_BYTES)
      .toString('base64url');
  };
}
