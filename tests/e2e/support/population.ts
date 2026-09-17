// tests/e2e/support/population.ts
// `seed:isolation`（`packages/db/seed/presets/isolation.ts`）が投入した母集団を、
// **「この応答に現れてはならない文字列」の集合**として表現する。
//
// 🔴 値をテストにベタ書きしない。シードが唯一の出所であり、母集団が変わったら
//    このファイル経由で自動的にテストへ伝わる（片方だけ古くなる状態を作らない）。
import {
  DEMO_SEED_NAME_RULES,
  demoSeedEmails,
  ISOLATION_FORBIDDEN_MARKERS,
  ISOLATION_SEED_IDS,
  ISOLATION_SEED_PERSON_NAMES,
  ISOLATION_SEED_PLATFORM_USERS,
  isolationSeedCompanyNames,
  isolationSeedEmails,
  isolationSeedProjectNames,
  type IsolationPartnerIds,
  type IsolationTenantIds,
} from '@ses/db/seed';
import { T1107_NON_DISCLOSURE_MARKERS } from '../harness/db-admin';

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
    // 🔴 T-09-12: 経験内容の業務内容（他テナントのホスト / 取引先の経歴）。
    `${ISOLATION_FORBIDDEN_MARKERS.careerDescription}-host-${suffix}`,
    `${ISOLATION_FORBIDDEN_MARKERS.careerDescription}-p1-${suffix}`,
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
    // 🔴 T-09-12: 他パートナーの経歴（`F-008 AC-7`。1 社目は 4 行持つ。2 社目は 0 行なので値は実在しない）。
    `${ISOLATION_FORBIDDEN_MARKERS.careerDescription}-p${partner}-t${index}`,
  ];
}

/**
 * 🔴 **同一テナントのホスト側にしか無い案件の値**（`F-013 AC-2` / `F-014 AC-1`。T-06-09）。
 *
 * 第一境界（テナント）でも第二境界（パートナー）でもなく、**同じテナントの中で公開範囲と
 * 射影が作る 3 つ目の線**である。取引先の応答に 1 バイトも現れてはならない:
 *   ①未公開案件の名前（`ProjectVisibility` の行が無い ＝ C4 の外）
 *   ②エンド企業名（商流情報。`F-013 AC-2`）
 * 🔴 内部単価（数値）は含めない —— `operatorForbiddenApiMarkers` と同じ理由で、
 *    HTML には 6 桁の数字列が偶然現れうる。JSON にだけ当てる版を下に分ける。
 */
export function hostOnlyProjectMarkers(index: TenantIndex): readonly string[] {
  return [isolationSeedProjectNames(index).private, ISOLATION_FORBIDDEN_MARKERS.endClientName];
}

/** JSON 応答にだけ当てる版（内部単価の数値を足す）。 */
export function hostOnlyProjectApiMarkers(index: TenantIndex): readonly string[] {
  return [
    ...hostOnlyProjectMarkers(index),
    String(ISOLATION_FORBIDDEN_MARKERS.internalUnitPrice),
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

// ---------------------------------------------------------------------------
// 🔴 T-11-07（E2E #15 の全面展開。`tests/e2e/admin-non-disclosure.spec.ts`）
// ---------------------------------------------------------------------------

/** seed が利用者・取引先担当者・提案先に使うメールアドレスのドメイン（`isolationSeedEmails` から導く。ベタ書きしない）。 */
export function isolationSeedEmailDomain(): string {
  const [, domain] = isolationSeedEmails(1).hostOwner.split('@');
  if (domain === undefined || domain === '') throw new Error('seed:isolation のメールアドレスからドメインを導けません。');
  return domain;
}

/**
 * 🔴 運営者の応答に現れてよい seed 由来のメールアドレスは**運営者自身**（`PlatformUser`）だけである。
 *    テナントの利用者・取引先担当者・提案先（`users.email` / `partner_companies.contact_email` / `proposals.recipient_email` /
 *    `email_dispatches.recipient_email`）は T-11-07 で `app_platform` の GRANT からも外した。
 */
export function platformUserEmails(): readonly string[] {
  return [ISOLATION_SEED_PLATFORM_USERS.owner.email, ISOLATION_SEED_PLATFORM_USERS.support.email];
}

/**
 * 🔴 運営者に見せてはならないもの（HTML / JSON 共通）の**全面版**: `operatorForbiddenMarkers()` に
 *    ①seed の全利用者のメールアドレス（`users.email`）②T-11-07 が `harness/db-admin.ts` で仕込む非開示の値
 *    （生年月日・連絡先・スキルシートの `object_key` / `note`・ゲートの指摘・DKIM トークン・AI の生成由来・宛先・
 *    提案の件名 / 本文・依頼の本文 / 辞退理由・クォータ変更の理由・削除失敗の理由・監査 `summary` の身元と内容）を足す。
 *    数値のマーカー（単価・件数）は含めない（HTML の偶然一致を避ける。`operatorNonDisclosureApiMarkers` へ）。
 */
export function operatorNonDisclosureMarkers(): readonly string[] {
  const seedEmails = ([1, 2] as const).flatMap((index) => {
    const emails = isolationSeedEmails(index);
    return [emails.hostOwner, emails.hostSales, emails.partner1, emails.partner2];
  });
  const planted: string[] = [];
  for (const value of Object.values(T1107_NON_DISCLOSURE_MARKERS) as ReadonlyArray<string | number>) {
    if (typeof value === 'string') planted.push(value);
  }
  return [...operatorForbiddenMarkers(), ...seedEmails, ...planted];
}

/** JSON 応答にだけ当てる版（数値のマーカー = 販売単価・提案単価・削除件数を足す）。 */
export function operatorNonDisclosureApiMarkers(): readonly string[] {
  return [
    ...operatorNonDisclosureMarkers(),
    String(ISOLATION_FORBIDDEN_MARKERS.internalUnitPrice),
    String(T1107_NON_DISCLOSURE_MARKERS.proposalOfferedUnitPrice),
    String(T1107_NON_DISCLOSURE_MARKERS.purgeCounts),
  ];
}

/**
 * 🔴 `seed:demo` の氏名の形（`DEMO_SEED_NAME_RULES.familyNames` × 空白。「サンプル 太郎」）。T-10-06 の申し送り。
 *    `isolation` の氏名（`架空 太郎` 等）も同じ姓を共有するため、姓 + 空白の形で両プリセットの人名を捕まえる。
 *    商号（`株式会社サンプルアルファ` / `架空商事株式会社`）は姓の直後が空白ではないので当たらない。
 */
export function demoPersonNamePatterns(): readonly string[] {
  return DEMO_SEED_NAME_RULES.familyNames.map((family) => `${family} `);
}

/**
 * 🔴 `A-012` が**設計上**見せる `seed:demo` の実演アカウント（`docs/04` §A-012 実演チェックリスト / `apps/web/lib/admin-demo/scenarios.ts`）。
 *    これ以外の `.example` メールアドレスは運営者の応答に現れてはならない。
 */
export function demoScenarioAccountEmails(): readonly string[] {
  const emails = demoSeedEmails(1);
  return [emails.hostSales[0], emails.partnerSales(1)];
}
