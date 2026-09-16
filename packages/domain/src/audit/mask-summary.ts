// packages/domain/src/audit/mask-summary.ts
// 🔴 監査ログの `summary`（JSON）を**運営者に見せてよい形**へ畳む純粋関数
//    （docs/05 §5.5 第 2 層 / `F-058 AC-1` / `AC-3` / `BR-40` / `BR-42`。T-11-03）。
//
// なぜ domain に置くか: `packages/ai` の `mask()` は「LLM に渡してよいテキスト」を作る AI 層専用の
// 関数であり（`MaskedText` のブランドを生む唯一の地点）、管理平面の表示のために import すると
// `tests/static/ai-single-path.test.ts` が守る単一経路が崩れる。ここは**表示用**の別物であり、
// 決定的（同じ入力に同じ出力）で I/O を持たないため domain が置き場になる。
//
// 🔴 前提を置かない: docs/05 §16.2 は「`summary` に PII を入れない。記録するのは ID・件数・状態・
//    列挙値のみ」と定めるが、**過去の行に何が入っているかを前提にせず**、値の形で判定する。
//    したがって既知値（台帳の氏名）との照合ではなく、①キー名 ②値のパターン ③値の形 の 3 段で伏せる。
//
// 🔴 3 段の規則（上から順に適用。1 つでも当たれば以降は見ない）
//   ① 内容キー（本文・件名・メモ・自由記述）は**キーごと落とす**（`F-058 AC-3`。チャット本文・提案本文・
//      スキルシート本文が結果にもエクスポートにも現れない）。値を `[masked]` にして残すこともしない ——
//      「本文があった」という事実は `action` / `targetType` で足りる。
//   ② 身元キー（氏名・メール・電話・生年月日・住所）と商流キー（単価・金額）は値を `[masked]` に
//      置き換える（キーは残す。「何が記録されたか」の形は運営者に要る）。
//   ③ それ以外の文字列値は、メール / 電話 / 生年月日のパターンに当たれば `[masked]`、当たらなくても
//      **トークン形状**（空白・非 ASCII を含まない 1〜64 文字）でなければ `[masked]`。
//      §16.2 のとおりなら ID（UUID）・列挙値・ISO 日時・件数しか無いはずであり、それに合わない
//      文字列は「内容」とみなす。人名は正規表現で検出できないため、この形状判定が人名の最後の網になる。
//   数値・真偽値・`null` はそのまま通す（②の身元・商流キー配下を除く）。
//
// 🔴 キーの判定は**末尾の語**で行う（camelCase / snake_case を語に分解する）。`draftBody` → `body`、
//    `recipientEmail` → `email`、`end_client_name` → `name`。部分文字列ではなく語で見るのは、
//    `context` が `text` に、`toState` が `to` に当たる誤検出を避けるためである。
//
// 🔴 マスク済みの値から元に戻せる情報を持たない（先頭 1 文字も残さない。ハッシュも出さない）。
//    docs/05 §5.5 の `山**` / `a***@e***.jp` は「利用者に見せる部分伏せ」の例であり、運営者には
//    それすら要らない（`CLAUDE.md` §10.5「運営者に必要なのは件数・状態・エラーであって内容ではない」）。
// 🔴 入れ子（配列 / オブジェクト）は同じ規則を再帰で適用する。深さの上限を超えた枝は落とす。

/** 伏せた値の置き換え文字列。**これ以外の伏せ字を作らない**（画面はこの値だけを見る）。 */
export const MASKED_VALUE = '[masked]' as const;

/** マスク済み `summary` の値。`unknown` を型に持たない（生 JSON を通さない）。 */
export type MaskedAuditValue =
  | string
  | number
  | boolean
  | null
  | readonly MaskedAuditValue[]
  | MaskedAuditSummary;

export type MaskedAuditSummary = { readonly [key: string]: MaskedAuditValue };

/** 入れ子の深さの上限（`summary` は本来フラット。docs/05 §16.2）。 */
const MAX_DEPTH = 3;

/** トークン形状（ID / 列挙値 / ISO 日時 / 数値文字列）とみなす上限長。UUID = 36、ISO 日時 = 24〜29。 */
const TOKEN_MAX_LENGTH = 64;

/**
 * ① 内容キー（末尾の語）。
 * 🔴 `reason` を含める: 停止理由・辞退理由・代理閲覧の理由はいずれも自由記述であり、人名が書かれうる。
 *    列挙値の理由（`PASSWORD_MISMATCH` 等）まで落ちるが、それは `action`（`auth.login_failed`）で足りる。
 * 🔴 `title` を含める: 通知の件名は差し込み値（氏名）を含みうる（docs/05 §5.5 `notifications.title`）。
 */
const CONTENT_WORDS: ReadonlySet<string> = new Set([
  'body',
  'subject',
  'note',
  'notes',
  'text',
  'content',
  'contents',
  'message',
  'messages',
  'description',
  'comment',
  'comments',
  'memo',
  'reason',
  'rationale',
  'summary',
  'payload',
  'findings',
  'warnings',
  'careers',
  'skills',
  'title',
]);

/**
 * ② 身元キー（`F-058 AC-1` の氏名・メール・電話 + 生年月日・住所・宛先・署名者・ファイル名）。
 * 🔴 `filename` は「山田太郎_スキルシート.xlsx」のように人名を含みうる。
 * 🔴 `to` / `cc` / `bcc` は含めない —— 期間の `periodTo` / 遷移の `to` と衝突する。宛先の値は
 *    メールアドレスであり、③の値パターンで必ず伏せられる。
 */
const IDENTITY_WORDS: ReadonlySet<string> = new Set([
  'name',
  'names',
  'email',
  'emails',
  'mail',
  'phone',
  'tel',
  'birthdate',
  'birthday',
  'birth',
  'dob',
  'address',
  'recipient',
  'recipients',
  'signer',
  'signers',
  'filename',
  'photo',
  // 🔴 docs/05 §5.5 の非開示列 `object_key` / `attachment_key` と同名のキー。パスの末尾はファイル名で
  //    人名を含みうる（`tenants/a1/engineers/e1/yamada-taro.xlsx`）。ASCII・空白なしなので③の形状判定を
  //    通過してしまうため、キー名で止める（T-11-03 レビュー指摘）。
  'objectkey',
  'attachmentkey',
  'url',
]);

/** 🔴 `ipAddress` は身元キーから除外する（列としても返している。`docs/04` §A-006 の表示項目）。 */
const IDENTITY_KEY_EXCEPTIONS: ReadonlySet<string> = new Set(['ipaddress']);

/** ② 商流キー（単価・金額。`CLAUDE.md` §10.5 / docs/05 §5.5 の非開示列と同じ基準）。 */
const COMMERCE_WORDS: ReadonlySet<string> = new Set([
  'price',
  'prices',
  'amount',
  'unitprice',
  'fee',
  'salary',
  'margin',
  'revenue',
  'budget',
]);

/** ③ 値のパターン。`packages/ai/src/mask.ts` と同じ趣旨だが、ここは「当たれば全部伏せる」だけで足りる。 */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
/**
 * 区切り（ハイフン / 空白）2 つを持つ国内番号（`090-1234-5678` / `03-1234-5678` / `+81-90-1234-5678`）。
 * 🔴 UUID（`01930000-0000-7000-…`）に当たらないよう、先頭は「数字にもハイフンにも続かない 0」に限り、
 *    末尾は 4 桁で終わってその後に数字・ハイフンが続かないことを要求する。桁数は `looksLikePhone` で確認する。
 */
const PHONE_PATTERN = /(?:\+81[- ]?0?|(?<![\d-])0)\d{1,4}[- ]\d{1,4}[- ]\d{4}(?![\d-])/;
const BIRTH_DATE_PATTERN =
  /(?:(?:19|20)\d{2}[-/.年]\s?\d{1,2}[-/.月]\s?\d{1,2}日?\s*生)|(?:生年月日|誕生日|DOB|Date of Birth)/i;

/** トークン形状: 空白・制御文字・非 ASCII を含まず、1〜64 文字。 */
const TOKEN_PATTERN = /^[\x21-\x7E]{1,64}$/;

/** camelCase / snake_case / kebab-case のキーを小文字の語に分解する。 */
function wordsOf(key: string): readonly string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

/** 末尾の語と、末尾 2 語の連結（`birth` + `date` → `birthdate`）。 */
function tailCandidates(key: string): readonly string[] {
  const words = wordsOf(key);
  const last = words[words.length - 1];
  if (last === undefined) return [];
  const secondLast = words[words.length - 2];
  return secondLast === undefined ? [last] : [last, `${secondLast}${last}`];
}

function matchesAny(key: string, words: ReadonlySet<string>): boolean {
  return tailCandidates(key).some((candidate) => words.has(candidate));
}

function isContentKey(key: string): boolean {
  return matchesAny(key, CONTENT_WORDS);
}

function isIdentityKey(key: string): boolean {
  if (IDENTITY_KEY_EXCEPTIONS.has(wordsOf(key).join(''))) return false;
  return matchesAny(key, IDENTITY_WORDS);
}

/**
 * 🔴 商流キーは「いずれかの語」で判定する（身元キーの末尾判定とは違う）。`unitPriceMin` / `unit_price_max` /
 *    `priceMax` は末尾が `min` / `max` で、末尾判定では docs/05 §5.5 の非開示列 `unit_price_min` /
 *    `unit_price_max` と同名のキーが素通りする（T-11-03 レビュー指摘）。商流語（price / amount / fee …）が
 *    キーのどこかに現れれば金額とみなして伏せる。身元キーは `recipientCount` 等の過剰マスクを避けるため末尾のまま。
 */
function isCommerceKey(key: string): boolean {
  if (matchesAny(key, COMMERCE_WORDS)) return true;
  const words = wordsOf(key);
  if (words.some((word) => COMMERCE_WORDS.has(word))) return true;
  // 2 語連結（`unit` + `price` → `unitprice`）がキーの途中に現れる場合
  for (let index = 0; index + 1 < words.length; index += 1) {
    if (COMMERCE_WORDS.has(`${words[index]}${words[index + 1]}`)) return true;
  }
  return false;
}

/** `+81` を国内表記（先頭 0）に畳んだ数字列が 10〜11 桁か。 */
function isDomesticPhoneDigits(candidate: string): boolean {
  const normalized = candidate.startsWith('+81') ? `0${candidate.slice(3).replace(/^[- ]?0?/, '')}` : candidate;
  const digits = normalized.replace(/\D/g, '');
  return digits.startsWith('0') && (digits.length === 10 || digits.length === 11);
}

/** 電話番号らしいか（区切り付きの部分一致、または数字・区切りだけで構成された 0 始まりの 10〜11 桁）。 */
function looksLikePhone(value: string): boolean {
  const match = PHONE_PATTERN.exec(value);
  if (match !== null && isDomesticPhoneDigits(match[0])) return true;
  if (!/^[\d\-\s()+]+$/.test(value)) return false;
  return isDomesticPhoneDigits(value.trim());
}

/** ③ 文字列値の判定。伏せるべきなら `true`。 */
function shouldMaskString(value: string): boolean {
  if (value.length === 0) return false;
  if (EMAIL_PATTERN.test(value)) return true;
  if (looksLikePhone(value)) return true;
  if (BIRTH_DATE_PATTERN.test(value)) return true;
  if (value.length > TOKEN_MAX_LENGTH) return true;
  return !TOKEN_PATTERN.test(value);
}

function maskValue(value: unknown, depth: number): MaskedAuditValue | undefined {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return shouldMaskString(value) ? MASKED_VALUE : value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const out: MaskedAuditValue[] = [];
    for (const item of value) {
      const masked = maskValue(item, depth + 1);
      if (masked !== undefined) out.push(masked);
    }
    return out;
  }
  if (typeof value === 'object') return maskObject(value as Record<string, unknown>, depth + 1);
  // bigint / symbol / function / undefined は JSON に現れない。現れても落とす。
  return undefined;
}

function maskObject(raw: Record<string, unknown>, depth: number): MaskedAuditSummary {
  const out: Record<string, MaskedAuditValue> = {};
  for (const key of Object.keys(raw).sort()) {
    if (isContentKey(key)) continue;
    const value = raw[key];
    if (isIdentityKey(key) || isCommerceKey(key)) {
      // 🔴 値の型を問わず伏せる（`null` だけは「記録されていない」の意味を保つため残す）。
      out[key] = value === null ? null : MASKED_VALUE;
      continue;
    }
    const masked = maskValue(value, depth);
    if (masked !== undefined) out[key] = masked;
  }
  return out;
}

/**
 * 🔴 `AuditLog.summary` を運営者向け（`A-006` / API-A7）に畳む唯一の関数。
 *
 * - オブジェクト以外（文字列・配列・`null`）が渡されても**空のオブジェクト**を返す
 *   （`summary` 列は JSON で、過去の書き手がオブジェクト以外を入れていた可能性を排除しない）。
 * - キーは辞書順に並べ替える（スナップショットと差分が安定する）。
 * - 戻り値は `MaskedAuditSummary` であり `unknown` を含まない。API の DTO はこの型をそのまま持つ。
 */
export function maskAuditSummary(raw: unknown): MaskedAuditSummary {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return maskObject(raw as Record<string, unknown>, 0);
}
