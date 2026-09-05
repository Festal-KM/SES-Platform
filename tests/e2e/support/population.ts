// tests/e2e/support/population.ts
// `seed:isolation`（`packages/db/seed/presets/isolation.ts`）が投入した母集団を、
// **「この応答に現れてはならない文字列」の集合**として表現する。
//
// 🔴 値をテストにベタ書きしない。シードが唯一の出所であり、母集団が変わったら
//    このファイル経由で自動的にテストへ伝わる（片方だけ古くなる状態を作らない）。
import {
  ISOLATION_FORBIDDEN_MARKERS,
  ISOLATION_SEED_IDS,
  ISOLATION_SEED_PERSON_NAMES,
  isolationSeedCompanyNames,
  isolationSeedEmails,
  isolationSeedProjectNames,
  type IsolationPartnerIds,
  type IsolationTenantIds,
} from '@ses/db/seed';

export type TenantIndex = 1 | 2;

export function tenantIds(index: TenantIndex): IsolationTenantIds {
  const ids = ISOLATION_SEED_IDS.tenants[index - 1];
  if (ids === undefined) throw new Error(`seed:isolation にテナント ${index} がありません。`);
  return ids;
}

export function partnerIds(index: TenantIndex, partner: 1 | 2): IsolationPartnerIds {
  const ids = tenantIds(index).partners[partner - 1];
  if (ids === undefined) throw new Error(`seed:isolation にパートナー ${partner} がありません。`);
  return ids;
}

/** オブジェクトに現れる UUID をすべて集める（ID の列挙をテスト側に書かないため）。 */
function collectUuids(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
      into.push(value);
    }
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUuids(item, into);
    return into;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectUuids(item, into);
  }
  return into;
}

/** そのテナントの本文マーカー（`-t{n}` 接尾辞つき。テナントごとに値が違う）。 */
function bodyMarkers(index: TenantIndex): string[] {
  const suffix = `t${index}`;
  return [
    `${ISOLATION_FORBIDDEN_MARKERS.proposalBody}-host-${suffix}`,
    `${ISOLATION_FORBIDDEN_MARKERS.proposalBody}-private-${suffix}`,
    `${ISOLATION_FORBIDDEN_MARKERS.proposalBody}-p1-${suffix}`,
    `${ISOLATION_FORBIDDEN_MARKERS.proposalBody}-p2-${suffix}`,
    `${ISOLATION_FORBIDDEN_MARKERS.messageBody}-p1-${suffix}`,
    `${ISOLATION_FORBIDDEN_MARKERS.messageBody}-p2-${suffix}`,
  ];
}

/**
 * 🔴 **他テナントに属する一切の値**（`CLAUDE.md` §5 Phase 0 の「1 件も取得できない」の実体）。
 *    ID・会社名・案件名・メールアドレス・本文マーカーを 1 つの集合にする。
 */
export function foreignTenantMarkers(index: TenantIndex): readonly string[] {
  const ids = tenantIds(index);
  const companies = isolationSeedCompanyNames(index);
  const projects = isolationSeedProjectNames(index);
  const emails = isolationSeedEmails(index);
  return [
    ...collectUuids(ids),
    companies.host,
    ...companies.partners,
    projects.published,
    projects.private,
    emails.hostOwner,
    emails.hostSales,
    emails.partner1,
    emails.partner2,
    ...bodyMarkers(index),
  ];
}

/**
 * 🔴 **同一テナント内の他パートナー**に属する値（`CLAUDE.md` §3.1 の第二境界。
 *    「パートナー同士が相互に参照できる経路を 1 つも作らない」）。
 */
export function foreignPartnerMarkers(
  index: TenantIndex,
  partner: 1 | 2,
): readonly string[] {
  const ids = partnerIds(index, partner);
  const companies = isolationSeedCompanyNames(index);
  const emails = isolationSeedEmails(index);
  const partnerCompanyName = companies.partners[partner - 1];
  return [
    ...collectUuids(ids),
    ...(partnerCompanyName === undefined ? [] : [partnerCompanyName]),
    partner === 1 ? emails.partner1 : emails.partner2,
    `${ISOLATION_FORBIDDEN_MARKERS.proposalBody}-p${partner}-t${index}`,
    `${ISOLATION_FORBIDDEN_MARKERS.messageBody}-p${partner}-t${index}`,
  ];
}

/**
 * 🔴 **運営者に見せてはならないもの**（`BR-40` / `CLAUDE.md` §10.5 / `F-056 AC-1`）。
 *    運営者に必要なのは「件数・状態・エラー」であって「内容」ではない。
 *
 * 🔴 テナント名は**含めない**（`A-002` / `A-003` は契約の識別に必要であり、表示してよい）。
 *    含めるのは、氏名・案件の内容・提案 / チャットの本文・単価・エンド企業名・取引先名・
 *    秘匿値の平文である。
 */
export function operatorForbiddenMarkers(): readonly string[] {
  const perTenant = ([1, 2] as const).flatMap((index) => {
    const companies = isolationSeedCompanyNames(index);
    const projects = isolationSeedProjectNames(index);
    return [...companies.partners, projects.published, projects.private, ...bodyMarkers(index)];
  });
  return [
    // エンジニア・利用者・担当者の氏名（疑似乱数で選ばれるため**集合ごと**突き合わせる）
    ...ISOLATION_SEED_PERSON_NAMES,
    ...perTenant,
    // 商流（エンド企業名・支払条件）と、スキルシート / 契約書の実体への参照
    ISOLATION_FORBIDDEN_MARKERS.endClientName,
    ISOLATION_FORBIDDEN_MARKERS.contractPaymentTerms,
    ISOLATION_FORBIDDEN_MARKERS.contractDocumentObjectKey,
    ISOLATION_FORBIDDEN_MARKERS.extensionReviewFacts,
    ISOLATION_FORBIDDEN_MARKERS.extensionReviewSummary,
    // 🔴 秘匿値の平文（`CLAUDE.md` §3.4 / §10.5「外部サービスのアクセストークン平文」）
    '$argon2id$',
    'otpauth://',
    'passwordHash',
    'password_hash',
    'secretEncrypted',
    'secret_encrypted',
    'recoveryCodeHashes',
  ];
}

/**
 * API 応答（JSON）にだけ適用する追加のマーカー。
 *
 * 🔴 販売単価は**数値**（`987654`）であり、HTML には Next.js が埋め込むチャンク名・
 *    ハッシュが大量に含まれるため、6 桁の数字列が偶然一致しうる（＝ 偽陽性で不安定になる）。
 *    JSON 応答は件数・状態・日時だけの小さな構造なので、そこでだけ照合する。
 */
export function operatorForbiddenApiMarkers(): readonly string[] {
  return [...operatorForbiddenMarkers(), String(ISOLATION_FORBIDDEN_MARKERS.internalUnitPrice)];
}
