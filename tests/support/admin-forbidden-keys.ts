// tests/support/admin-forbidden-keys.ts
// 🔴 管理平面（`/admin` / `/api/admin/**`）の応答に**現れてはならないキー名**の唯一の出所（T-11-07。
//    docs/05 §5.5 第 2 層 / §17.3 E2E #15 / `CLAUDE.md` §10.5「運営者に必要なのは件数・状態・エラーであって
//    内容ではない」/ `BR-40` / `BR-42`）。
//
// 🔴 2 つの利用者がいる（`tests/support/outbound-network-guard.mjs` と同じ置き方）:
//    ① `tests/static/admin-forbidden-keys.test.ts` … DTO 型（`packages/db/src/platform/**` / `serializers/platform/**` /
//       `apps/web/lib/admin-*/view.ts`）のプロパティ名を AST で走査する（書かれた瞬間に落ちる）
//    ② `tests/e2e/admin-non-disclosure.spec.ts` … 実サーバの JSON 応答をどの深さまでも走査する（実際に出ていない）
//    キーの集合を 2 箇所に書くと片方だけ緩められる。ここ 1 つを両方が import する。
//
// 🔴 T-11-01 / T-11-02 / T-11-04 / T-11-08 の申し送りに散っていた禁止キーをここに統合した。
//    語彙は `docs/05` §5.5 の非開示列（camelCase）と、`maskAuditSummary`（`packages/domain/src/audit/mask-summary.ts`）
//    の内容キー / 身元キー / 商流キーに揃える。**キーは 3 つの群に分ける**（`A-006` の `summary` の扱いが群で違う）。

/**
 * 群 A: 内容（本文・件名・メモ・理由・指摘）。**どこにも現れてはならない。**
 * `A-006` の `summary` からもキーごと落ちる（`maskAuditSummary` の ①）。
 */
export const ADMIN_FORBIDDEN_CONTENT_KEYS = [
  'subject',
  'body',
  'draftBody',
  'note',
  'text',
  'content',
  'message',
  'declineReason',
  'reason',
  'findings',
  'aiWarnings',
  'lastFailureReason',
  'failureReason',
] as const;

/**
 * 群 B: 身元・商流（氏名・宛先・単価・オブジェクトキー）。応答に現れてはならない。
 * 🔴 例外は `A-006` の `summary` の中だけ —— キーは残るが値は必ず `[masked]`（`maskAuditSummary` の ②）。
 */
export const ADMIN_FORBIDDEN_IDENTITY_KEYS = [
  'displayName',
  'email',
  'recipientEmail',
  'recipientCompanyName',
  'objectKey',
  // 🔴 T-10-09: 返却データの署名 URL（#78 の応答）。運営者はどの応答でも到達できない（`F-064 AC-7` / `BR-40`）。
  'downloadUrl',
  'offeredUnitPrice',
] as const;

/**
 * 群 C: 秘匿値・基盤の識別情報・生成由来（トークン・DKIM・ARN・モデル・プロンプト版・用途・対象 ID）。
 * どこにも現れてはならない。`targetId` だけは API-A7 / API-A8 の**構造として定義済み**の例外を持つ（下記）。
 * 🔴 `A-006` の `summary` の中の `modelId` / `promptVersion` / `purpose` / `targetId` は監査記録の列挙値・ID として
 *    残る（`maskAuditSummary` の ③ トークン形状）。T-11-02 申し送り「`A-006` の `summary` は別」。
 */
export const ADMIN_FORBIDDEN_SECRET_KEYS = [
  'dkimTokens',
  'mailFromDomain',
  'sesIdentityArn',
  'secret',
  'passwordHash',
] as const;

export const ADMIN_FORBIDDEN_PROVENANCE_KEYS = ['targetId', 'modelId', 'promptVersion', 'purpose'] as const;

/**
 * 前方一致で禁止するキー（語の境界で切る: `unitPrice` / `unitPriceMin` / `unitPriceMaxYen`、`token` / `tokens` / `tokenHash`。
 * `tokenizer` のような別語は当てない）。単価は群 B（商流）、トークンは群 C（秘匿値）として扱う。
 */
export const ADMIN_FORBIDDEN_KEY_PREFIXES: Readonly<Record<string, 'IDENTITY' | 'SECRET'>> = {
  unitPrice: 'IDENTITY',
  token: 'SECRET',
};

export const ADMIN_FORBIDDEN_RESPONSE_KEYS: readonly string[] = [
  ...ADMIN_FORBIDDEN_CONTENT_KEYS,
  ...ADMIN_FORBIDDEN_IDENTITY_KEYS,
  ...ADMIN_FORBIDDEN_SECRET_KEYS,
  ...ADMIN_FORBIDDEN_PROVENANCE_KEYS,
];

const CONTENT_KEY_SET: ReadonlySet<string> = new Set(ADMIN_FORBIDDEN_CONTENT_KEYS);
const IDENTITY_KEY_SET: ReadonlySet<string> = new Set(ADMIN_FORBIDDEN_IDENTITY_KEYS);
const SECRET_KEY_SET: ReadonlySet<string> = new Set(ADMIN_FORBIDDEN_SECRET_KEYS);
const PROVENANCE_KEY_SET: ReadonlySet<string> = new Set(ADMIN_FORBIDDEN_PROVENANCE_KEYS);

export type AdminForbiddenKeyGroup = 'CONTENT' | 'IDENTITY' | 'SECRET' | 'PROVENANCE';

function matchesPrefix(key: string, prefix: string): boolean {
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return rest === '' || rest === 's' || /^[A-Z0-9_]/.test(rest);
}

/** キーがどの群で禁止されるか。禁止されなければ `null`。 */
export function classifyAdminForbiddenKey(key: string): AdminForbiddenKeyGroup | null {
  if (CONTENT_KEY_SET.has(key)) return 'CONTENT';
  if (IDENTITY_KEY_SET.has(key)) return 'IDENTITY';
  if (SECRET_KEY_SET.has(key)) return 'SECRET';
  if (PROVENANCE_KEY_SET.has(key)) return 'PROVENANCE';
  for (const [prefix, group] of Object.entries(ADMIN_FORBIDDEN_KEY_PREFIXES)) {
    if (matchesPrefix(key, prefix)) return group;
  }
  return null;
}

/** 管理平面の読み取り応答（E2E #15 の走査対象。`docs/05` §6.9）。 */
// ✅ T-10-10: API-A12（削除完了の確認。`A-010`）。例外は無い（`failureReason` は群 A として応答に現れてはならない）。
export type AdminResponseId = 'API-A2' | 'API-A3' | 'API-A6' | 'API-A7' | 'API-A8' | 'API-A12' | 'API-A16';

export type AdminForbiddenKeyException = {
  /** なぜこのキーがこの応答に在ってよいか（設計の決着への参照）。 */
  readonly rationale: string;
  /** 値の形の確認（例外を「同名の別物」にしか使えないようにする）。 */
  readonly accept: (value: unknown) => boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `A-005` 項目 12 の理由（`GATE_STALL_REASONS_VIEW`。`apps/web/lib/admin-monitoring/view.ts`）。 */
export const GATE_STALL_REASON_VALUES: readonly string[] = ['AI_COST_LIMIT_HELD', 'JOB_FAILED', 'RUNNING_OVERDUE'];

/**
 * 🔴 例外は**応答ごと・キーごと**に根拠付きで列挙する。ここに無い組み合わせは違反である。
 *
 * - API-A6 `email` … `EMAIL_COUNT` クォータ（`{ used, limit, consumptionPercent, level, quota }`）のオブジェクト。
 *   宛先ではない（docs/05 §6.9 API-A6「件数 4 単位 + メール + ストレージ」）。値が文字列なら違反。
 * - API-A7 `targetId` … 監査行の対象 ID。**管理平面に ID から内容を引く API は無い**（docs/05 §6.9「API-A7 の実装の決着」/
 *   `tests/static/admin-no-content-reach.test.ts` ③）。UUID か `null` 以外は違反。
 * - API-A8 `targetId` / `reason` … 項目 12（`GATE_STALL`）の対象 ID と理由（列挙値 3 値。T-11-05 決着「対象種別と ID・理由」。
 *   `targetId` はリンクにしない）。理由が 3 値以外なら違反。
 */
export const ADMIN_FORBIDDEN_KEY_EXCEPTIONS: Readonly<
  Record<AdminResponseId, Readonly<Record<string, AdminForbiddenKeyException>>>
> = {
  'API-A2': {},
  'API-A3': {},
  'API-A6': {
    email: {
      rationale: 'EMAIL_COUNT クォータのオブジェクト（docs/05 §6.9 API-A6）。宛先ではない',
      accept: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
    },
  },
  'API-A7': {
    targetId: {
      rationale: '監査行の対象 ID（docs/05 §6.9 API-A7 の決着。ID から内容を引く API は無い）',
      accept: (value) => value === null || (typeof value === 'string' && UUID_PATTERN.test(value)),
    },
  },
  'API-A8': {
    targetId: {
      rationale: 'A-005 項目 12 GATE_STALL の対象 ID（T-11-05 決着。リンクにしない）',
      accept: (value) => typeof value === 'string' && UUID_PATTERN.test(value),
    },
    reason: {
      rationale: 'A-005 項目 12 GATE_STALL の理由（列挙値 3 値。T-11-05 決着）',
      accept: (value) => typeof value === 'string' && GATE_STALL_REASON_VALUES.includes(value),
    },
  },
  'API-A16': {},
  'API-A12': {},
};

/** 🔴 `A-006` の `summary`（マスク済み）の中でだけ許される伏せ字。`packages/domain` の `MASKED_VALUE` と同じ値。 */
export const MASKED_VALUE_LITERAL = '[masked]';

export type ForbiddenKeySighting = {
  readonly path: string;
  readonly key: string;
  readonly group: AdminForbiddenKeyGroup;
  readonly detail: string;
};

function isAllMasked(value: unknown): boolean {
  if (value === MASKED_VALUE_LITERAL) return true;
  if (Array.isArray(value)) return value.every(isAllMasked);
  if (typeof value === 'object' && value !== null) return Object.values(value).every(isAllMasked);
  return false;
}

/**
 * JSON をどの深さまでも歩き、禁止キーの出現を集める（E2E #15 の (a)）。
 *
 * - `exceptions` に無い禁止キーは出現そのものが違反。あるキーは `accept(value)` を満たさなければ違反。
 * - 🔴 API-A7 の `items[*].summary` の下は**マスク済み領域**として別の規則を適用する:
 *   群 A（内容）と群 C（秘匿値。`token*` を含む）は**キーごと無い**こと、
 *   群 B（身元・商流。`unitPrice*` を含む）は値が `[masked]`（入れ子なら全部 `[masked]`）であること。
 *   群 D（生成由来）は監査記録の列挙値・ID として残ってよい（`maskAuditSummary` の ③）。
 */
export function collectForbiddenKeySightings(value: unknown, responseId: AdminResponseId): ForbiddenKeySighting[] {
  const exceptions = ADMIN_FORBIDDEN_KEY_EXCEPTIONS[responseId];
  const sightings: ForbiddenKeySighting[] = [];
  const visit = (node: unknown, path: string, maskedZone: boolean): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`, maskedZone));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [key, child] of Object.entries(node)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      const group = classifyAdminForbiddenKey(key);
      const entersMaskedZone = responseId === 'API-A7' && key === 'summary' && /^items\[\d+\]$/.test(path);
      if (group !== null) {
        const exception = exceptions[key];
        if (exception !== undefined) {
          if (!exception.accept(child)) {
            sightings.push({ path: childPath, key, group, detail: `例外の形を満たさない値（${exception.rationale}）` });
          }
        } else if (maskedZone && group === 'IDENTITY') {
          if (!isAllMasked(child)) {
            sightings.push({ path: childPath, key, group, detail: `A-006 の summary で身元・商流キーの値が ${MASKED_VALUE_LITERAL} ではない` });
          }
        } else if (maskedZone && group === 'PROVENANCE') {
          // 監査記録の列挙値・ID として残ってよい（maskAuditSummary の ③）。
        } else {
          sightings.push({ path: childPath, key, group, detail: '禁止キーが応答に現れた' });
        }
      }
      visit(child, childPath, maskedZone || entersMaskedZone);
    }
  };
  visit(value, '', false);
  return sightings;
}
