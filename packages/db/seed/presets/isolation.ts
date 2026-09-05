// packages/db/seed/presets/isolation.ts
// 🔴 `seed:isolation`（T-02-10。docs/sprints/SP-02-schema-isolation.md / docs/05 §13.6 /
//    docs/03 §4.19 / CLAUDE.md §5 Phase 0）。
//
// このプリセットが満たすもの:
//   ① **2 テナント × 2 パートナー**（CLAUDE.md §5 Phase 0 の成功条件の母集団）。
//      🔴 2 社目のパートナーが要るのは「パートナー同士が相互に参照できない」（CLAUDE.md §3.1 の 🔴。
//      SES の商流上の最大の事故）を検証するためである。1 社では書けないテストがある。
//   ② 🔴 **各パートナーが当事者の `Assignment` / `Contract` / `Order` を 1 件ずつ**持ち、
//      **同一案件に両社の稼働を置く**（docs/05 §4.7 #8〜#10 / §17.3 #21 の母集団）。
//      同じ案件に他社の稼働があっても `total` が変わらないことを、ここで初めて検証できる。
//   ③ 🔴 **DB に直接 INSERT せず、`packages/domain` の `transition()` を通して状態を進める**
//      （docs/05 §13.6）。`WON` の提案も `EXECUTED` の契約も、遷移表どおりの道を通って到達する。
//   ④ 🔴 時系列は「実行日 = `T`」からの相対日（満了 `T+55` 日の稼働など）。
//   ⑤ 🔴 合成データのみ（F-053 AC-1 / BR-47）。企業名は明示的な架空名、氏名は架空名リスト、
//      メールは RFC 6761 の予約 TLD `.test`（実在しない）。実データ由来のファイルを置かない。
//
// 🔴 このプリセットは「分離の検証」のための母集団である。ゲートで止まる資料・進行中の提案を
//    多数持つ営業デモ用の一式は `seed:demo`（SP-10 の T-10-06）の範囲であり、ここには入れない。
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  assignmentMachine,
  contractMachine,
  proposalMachine,
  tenantMachine,
  type AssignmentState,
  type ContractState,
  type ProposalState,
  type TenantLifecycleState,
} from '@ses/domain';
import { addDays, advanceState, dateOnly, seedUuid, type StateStep } from '../support.js';
import type { SeedContext, SeedPreset } from '../types.js';

// ---------------------------------------------------------------------------
// ID（🔴 決定的に組み立てる。乱数 UUID にしない。docs/05 §13.6「冪等な再生成」）
// ---------------------------------------------------------------------------

/** プリセット固有のコード。他プリセットの母集団と ID 空間が重ならないようにする。 */
const PRESET_CODE = '150a';

const ENTITY = {
  TENANT: 0x01,
  PARTNER: 0x02,
  USER: 0x03,
  MEMBERSHIP: 0x04,
  ENGINEER: 0x05,
  PROJECT: 0x06,
  REQUIREMENT: 0x07,
  GATE: 0x08,
  VISIBILITY: 0x09,
  SHARE: 0x0a,
  MATCH: 0x0b,
  PROPOSAL: 0x0c,
  THREAD: 0x0d,
  PARTICIPANT: 0x0e,
  MESSAGE: 0x0f,
  CONTRACT: 0x10,
  DOCUMENT: 0x11,
  ASSIGNMENT: 0x12,
  ORDER: 0x13,
  EXTENSION_REVIEW: 0x14,
  TASK: 0x15,
  NOTIFICATION: 0x16,
} as const;

function id(tenantIndex: number, entityCode: number, seq: number): string {
  return seedUuid({ presetCode: PRESET_CODE, tenantIndex, entityCode, seq });
}

/** パートナー配下の連番（パートナー番号 × 16 + 連番）。ID を見れば所属が分かる。 */
function partnerSeq(partnerIndex: number, seq: number): number {
  return partnerIndex * 0x10 + seq;
}

export type IsolationPartnerIds = {
  readonly partnerCompanyId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly engineerId: string;
  /** 🔴 越境経路 4（匿名共有）の唯一の根拠。既定オフに対する明示的な opt-in。 */
  readonly engineerShareId: string;
  /** ホスト側の匿名候補（C2。パートナーからは 1 件も見えない）。 */
  readonly matchCandidateId: string;
  /** 公開案件への提案（`WON` まで進む。稼働の生成元）。 */
  readonly wonProposalId: string;
  /** ゲートで止まった提案（`GATE_FAILED`）。 */
  readonly gateFailedProposalId: string;
  readonly proposalGateId: string;
  readonly gateFailedGateId: string;
  readonly threadId: string;
  readonly hostParticipantId: string;
  readonly partnerParticipantId: string;
  readonly partnerMessageId: string;
  readonly hostMessageId: string;
  /** 🔴 当事者が自社の契約（`EXECUTED`）。 */
  readonly contractId: string;
  /** 署名済みの最終版（C9 で見える）。 */
  readonly signedDocumentId: string;
  /** 🔴 未署名のドラフト版（C9 の `signed_at IS NOT NULL` で行として消える）。 */
  readonly draftDocumentId: string;
  /** 🔴 当事者が自社の稼働。**両社とも同じ公開案件**に置く。 */
  readonly assignmentId: string;
  /** 🔴 当事者が自社の発注。 */
  readonly orderId: string;
  readonly taskId: string;
  readonly notificationId: string;
};

export type IsolationTenantIds = {
  readonly tenantId: string;
  readonly hostUserId: string;
  readonly hostMembershipId: string;
  /**
   * 🔴 T-03-11: `CLAUDE.md` §5 Phase 0 の成功条件は「テナント A の **`OWNER`** でログインし…」
   *    と書かれている。`hostUserId` は `SALES` であり、`GET /api/audit-logs`（`OWNER` / `ADMIN` のみ）
   *    や `S-041` に到達できないため、E2E が通れない。**既存の `SALES` を付け替えず**に
   *    `OWNER` を 1 名足す（付け替えると既存の分離テストの前提が動く）。
   */
  readonly hostOwnerUserId: string;
  readonly hostOwnerMembershipId: string;
  readonly hostEngineerId: string;
  /** パートナー 1 社目にだけ公開した案件（越境経路 1 の正負）。 */
  readonly publishedProjectId: string;
  /** どのパートナーにも公開していない案件。 */
  readonly privateProjectId: string;
  readonly publishedRequirementId: string;
  readonly privateRequirementId: string;
  readonly publishGateId: string;
  readonly visibilityId: string;
  readonly hostProposalId: string;
  readonly hostProposalGateId: string;
  readonly hostAssignmentId: string;
  /** 当事者列が NULL の契約（ホストとエンド企業）。パートナーからは見えない。 */
  readonly hostContractId: string;
  readonly hostTaskId: string;
  readonly hostNotificationId: string;
  /** 未公開案件に紐づくパートナー 1 社目の提案（稼働の FK 用）。 */
  readonly privateProposalId: string;
  readonly privateProposalGateId: string;
  /** 🔴 未公開案件の稼働（`EXTENSION_REVIEW`）。案件名がビューで NULL になる経路。 */
  readonly privateAssignmentId: string;
  /** 🔴 ホスト内部の延長検討（BR-67）。パートナーはどの経路でも到達できない。 */
  readonly extensionReviewId: string;
  readonly partners: readonly [IsolationPartnerIds, IsolationPartnerIds];
};

function buildPartnerIds(tenantIndex: number, partnerIndex: number): IsolationPartnerIds {
  const seq = (n: number): number => partnerSeq(partnerIndex, n);
  return {
    partnerCompanyId: id(tenantIndex, ENTITY.PARTNER, seq(1)),
    userId: id(tenantIndex, ENTITY.USER, seq(1)),
    membershipId: id(tenantIndex, ENTITY.MEMBERSHIP, seq(1)),
    engineerId: id(tenantIndex, ENTITY.ENGINEER, seq(1)),
    engineerShareId: id(tenantIndex, ENTITY.SHARE, seq(1)),
    matchCandidateId: id(tenantIndex, ENTITY.MATCH, seq(1)),
    wonProposalId: id(tenantIndex, ENTITY.PROPOSAL, seq(1)),
    gateFailedProposalId: id(tenantIndex, ENTITY.PROPOSAL, seq(2)),
    proposalGateId: id(tenantIndex, ENTITY.GATE, seq(1)),
    gateFailedGateId: id(tenantIndex, ENTITY.GATE, seq(2)),
    threadId: id(tenantIndex, ENTITY.THREAD, seq(1)),
    hostParticipantId: id(tenantIndex, ENTITY.PARTICIPANT, seq(1)),
    partnerParticipantId: id(tenantIndex, ENTITY.PARTICIPANT, seq(2)),
    partnerMessageId: id(tenantIndex, ENTITY.MESSAGE, seq(1)),
    hostMessageId: id(tenantIndex, ENTITY.MESSAGE, seq(2)),
    contractId: id(tenantIndex, ENTITY.CONTRACT, seq(1)),
    signedDocumentId: id(tenantIndex, ENTITY.DOCUMENT, seq(1)),
    draftDocumentId: id(tenantIndex, ENTITY.DOCUMENT, seq(2)),
    assignmentId: id(tenantIndex, ENTITY.ASSIGNMENT, seq(1)),
    orderId: id(tenantIndex, ENTITY.ORDER, seq(1)),
    taskId: id(tenantIndex, ENTITY.TASK, seq(1)),
    notificationId: id(tenantIndex, ENTITY.NOTIFICATION, seq(1)),
  };
}

function buildTenantIds(tenantIndex: number): IsolationTenantIds {
  return {
    tenantId: id(tenantIndex, ENTITY.TENANT, 1),
    hostUserId: id(tenantIndex, ENTITY.USER, 1),
    hostMembershipId: id(tenantIndex, ENTITY.MEMBERSHIP, 1),
    // 🔴 連番 2 はパートナー配下（`partnerSeq` = パートナー番号 × 16 + 連番 ＝ 17 以上）と
    //    衝突しない（`seed.test.ts` の「ID がすべて相異なる」が守る）。
    hostOwnerUserId: id(tenantIndex, ENTITY.USER, 2),
    hostOwnerMembershipId: id(tenantIndex, ENTITY.MEMBERSHIP, 2),
    hostEngineerId: id(tenantIndex, ENTITY.ENGINEER, 1),
    publishedProjectId: id(tenantIndex, ENTITY.PROJECT, 1),
    privateProjectId: id(tenantIndex, ENTITY.PROJECT, 2),
    publishedRequirementId: id(tenantIndex, ENTITY.REQUIREMENT, 1),
    privateRequirementId: id(tenantIndex, ENTITY.REQUIREMENT, 2),
    publishGateId: id(tenantIndex, ENTITY.GATE, 1),
    visibilityId: id(tenantIndex, ENTITY.VISIBILITY, 1),
    hostProposalId: id(tenantIndex, ENTITY.PROPOSAL, 1),
    hostProposalGateId: id(tenantIndex, ENTITY.GATE, 2),
    hostAssignmentId: id(tenantIndex, ENTITY.ASSIGNMENT, 1),
    hostContractId: id(tenantIndex, ENTITY.CONTRACT, 1),
    hostTaskId: id(tenantIndex, ENTITY.TASK, 1),
    hostNotificationId: id(tenantIndex, ENTITY.NOTIFICATION, 1),
    privateProposalId: id(tenantIndex, ENTITY.PROPOSAL, 2),
    privateProposalGateId: id(tenantIndex, ENTITY.GATE, 3),
    privateAssignmentId: id(tenantIndex, ENTITY.ASSIGNMENT, 2),
    extensionReviewId: id(tenantIndex, ENTITY.EXTENSION_REVIEW, 1),
    partners: [buildPartnerIds(tenantIndex, 1), buildPartnerIds(tenantIndex, 2)],
  };
}

/**
 * 🔴 運営者アカウント（`PlatformUser`）。**テナントに属さない**（`CLAUDE.md` §10.5 /
 *    `BR-36`。`tenant_id` を持つ表ではないので `reset()` の対象外であり、投入は `upsert` で行う）。
 *
 * 🔴 T-03-11 が足した理由: `CLAUDE.md` §5 Phase 0 の成功条件の 5 番目（運営者でログインして
 *    `A-002` / `A-003` に非開示のものが現れないこと。`BR-40`）を E2E で確かめるには、
 *    **`seed:isolation` の母集団に運営者が居る**必要がある（無いと、テスト側が運営者を作る
 *    ことになり「シードのプリセットを使う」〔docs/05 §17.5〕の規律が崩れる）。
 */
const PLATFORM_USER_ENTITY = 0xf0;

export type IsolationPlatformUser = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: 'PLATFORM_OWNER' | 'PLATFORM_SUPPORT';
};

export const ISOLATION_SEED_PLATFORM_USERS: {
  readonly owner: IsolationPlatformUser;
  readonly support: IsolationPlatformUser;
} = {
  owner: {
    // tenantIndex = 0 ＝「どのテナントにも属さない」ことを ID の形でも示す。
    id: seedUuid({ presetCode: PRESET_CODE, tenantIndex: 0, entityCode: PLATFORM_USER_ENTITY, seq: 1 }),
    email: 'platform-owner@seed-isolation.test',
    // 🔴 テナント利用者の氏名リスト（`FICTIONAL_PERSON_NAMES`）と重ならない値にする。
    //    E2E（`BR-40`）が「運営者の応答にテナント側の氏名が現れない」ことを文字列照合で
    //    確かめるため、重なると偽陽性・偽陰性の両方が起きる。
    displayName: '運営コンソール管理者（合成）',
    role: 'PLATFORM_OWNER',
  },
  support: {
    id: seedUuid({ presetCode: PRESET_CODE, tenantIndex: 0, entityCode: PLATFORM_USER_ENTITY, seq: 2 }),
    email: 'platform-support@seed-isolation.test',
    displayName: '運営コンソールサポート（合成）',
    role: 'PLATFORM_SUPPORT',
  },
};

/** 🔴 テストが参照する ID の唯一の出所（`tests/isolation/**` / `tests/e2e/**` はここを import する）。 */
export const ISOLATION_SEED_IDS: {
  readonly tenants: readonly [IsolationTenantIds, IsolationTenantIds];
} = {
  tenants: [buildTenantIds(1), buildTenantIds(2)],
};

/** シードが作る利用者のメールアドレス（E2E がサインインに使う）。 */
export function isolationSeedEmails(tenantIndex: 1 | 2): {
  readonly hostOwner: string;
  readonly hostSales: string;
  readonly partner1: string;
  readonly partner2: string;
} {
  return {
    hostOwner: seedEmail(`owner-t${tenantIndex}`),
    hostSales: seedEmail(`host-t${tenantIndex}`),
    partner1: seedEmail(`partner-t${tenantIndex}-p1`),
    partner2: seedEmail(`partner-t${tenantIndex}-p2`),
  };
}

/**
 * 🔴 経路 5 の射影・パートナー向けの応答に**現れてはならない**値。
 *    応答を JSON 化して「この文字列が 1 つも無い」ことを確かめるための目印である
 *    （docs/05 §4.7 #9 / F-065 AC-2 / F-066 AC-3 / BR-66 / BR-67）。
 */
export const ISOLATION_FORBIDDEN_MARKERS = {
  /** projects.end_client_name（エンド企業名。ホストの上流）。 */
  endClientName: 'seed-forbidden-end-client-name',
  /** projects.internal_unit_price（ホストの販売単価）。数値なので文字列化して照合する。 */
  internalUnitPrice: 987654,
  /** contracts.payment_terms（BR-66 の開示項目に無い）。 */
  contractPaymentTerms: 'seed-forbidden-payment-terms',
  /** contract_documents.object_key（ダウンロードは issueDownloadUrl 経由。§14.2）。 */
  contractDocumentObjectKey: 'seed-forbidden-contract-object-key',
  /** extension_reviews.facts / summary（ホスト内部の検討内容。BR-67）。 */
  extensionReviewFacts: 'seed-forbidden-renewal-facts',
  extensionReviewSummary: 'seed-forbidden-renewal-summary',
  /** proposals.body（他社の提案本文）。 */
  proposalBody: 'seed-forbidden-proposal-body',
  /** messages.body（他社のチャット本文）。 */
  messageBody: 'seed-forbidden-message-body',
} as const;

// ---------------------------------------------------------------------------
// 合成データの素材（🔴 実在の企業名・個人名を使わない。F-053 AC-1 / BR-47）
// ---------------------------------------------------------------------------

const FICTIONAL_HOST_COMPANIES = ['株式会社サンプルアルファ', '株式会社サンプルブラボー'] as const;
const FICTIONAL_PARTNER_COMPANIES = [
  '株式会社ダミーチャーリー',
  '株式会社ダミーデルタ',
  '株式会社ダミーエコー',
  '株式会社ダミーフォックス',
] as const;
const FICTIONAL_PERSON_NAMES = [
  '架空 太郎',
  '架空 花子',
  '仮名 一郎',
  '仮名 二子',
  '見本 三郎',
  '見本 四葉',
  '例示 五郎',
  '例示 六花',
] as const;
const FICTIONAL_END_CLIENTS = ['架空商事株式会社', '架空システム株式会社'] as const;
const PREFECTURES = ['13', '27', '14'] as const;

/** 🔴 実在しないことが保証された TLD（RFC 6761 の `.test`）だけを使う。 */
function seedEmail(local: string): string {
  return `${local}@seed-isolation.test`;
}

/**
 * 🔴 このプリセットが使う氏名の全集合。
 *    E2E（`BR-40` / `CLAUDE.md` §5 の 5 番目）は「運営者の応答にテナント側の氏名が
 *    1 つも現れない」ことを文字列照合で確かめる。**個々の行の氏名は疑似乱数で選ばれる**ため、
 *    集合ごと突き合わせられるように公開する（テスト側に名前をベタ書きさせない）。
 */
export const ISOLATION_SEED_PERSON_NAMES: readonly string[] = FICTIONAL_PERSON_NAMES;

/** テナント / パートナーの会社名（投入時と同じ式から導く。ずれ得ない）。 */
export function isolationSeedCompanyNames(tenantIndex: number): {
  readonly host: string;
  readonly partners: readonly [string, string];
} {
  return {
    host: FICTIONAL_HOST_COMPANIES[tenantIndex - 1] ?? '株式会社サンプル',
    partners: [
      FICTIONAL_PARTNER_COMPANIES[(tenantIndex - 1) * 2] ?? '株式会社ダミーパートナー',
      FICTIONAL_PARTNER_COMPANIES[(tenantIndex - 1) * 2 + 1] ?? '株式会社ダミーパートナー',
    ],
  };
}

/** 案件名（同上）。 */
export function isolationSeedProjectNames(tenantIndex: number): {
  readonly published: string;
  readonly private: string;
} {
  return { published: `公開案件 T${tenantIndex}`, private: `未公開案件 T${tenantIndex}` };
}

/**
 * 🔴 合成データ専用のサインインパスワード（`F-053 AC-1` / `BR-47`）。
 *
 * なぜコードに置くか（`CLAUDE.md` §3.5「シークレットをコードに書かない」との関係）:
 *   - これは**シークレットではない**。`assertSeedableAppEnv` により
 *     `APP_ENV ∈ {development, demo}` でしか投入されず（`F-053 AC-6`）、この資格情報で
 *     到達できるのは同じプリセットが作った合成データだけである。
 *   - 🔴 これを置かないと、**Phase 0 の成功条件（`CLAUDE.md` §5）を E2E で証明できない**。
 *     E2E は「URL 直打ち・API 直叩きで越境できないこと」を**実際にログインした状態**で
 *     確かめる必要があり、ログインできない母集団では検証が成立しない。
 *     代わりに「テスト専用のログイン迂回フック」を作るほうが、はるかに危険である。
 * 🔴 本番・sandbox・staging には流用しない（そもそも投入できない）。
 */
export const ISOLATION_SEED_PASSWORD = 'seed-isolation-password-1';

/**
 * 上の平文に対応する Argon2id ハッシュ（`apps/web/lib/auth/password.ts` の
 * `ARGON2_OPTIONS`（m=19456,t=2,p=1）で生成した PHC 文字列）。
 *
 * 🔴 ハッシュを**定数として持つ**のは、`packages/db` に `@node-rs/argon2`（ネイティブアドオン）を
 *    足さないためである。シードのためだけに依存を増やすと、`packages/db` を読む全ての
 *    ビルド・テスト環境がネイティブビルドを要求されるようになる。
 *    パラメータの一致は `tests/isolation/**` の実ログイン（`authenticateCredentials`）と
 *    `tests/e2e/**` の実サインインが実行ごとに証明する（ずれたら即座に落ちる）。
 */
const SEED_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$f+qGIrs8414/YRIcHU5L4Q$y/J87ho1fqIMF8noqAk3KKt3genDjT9Uf7XF/+EzOq4';

// ---------------------------------------------------------------------------
// 投入
// ---------------------------------------------------------------------------

type ProposalStep = StateStep<ProposalState, Prisma.ProposalUpdateManyMutationInput>;
type ContractStep = StateStep<ContractState, Prisma.ContractUpdateManyMutationInput>;
type AssignmentStep = StateStep<AssignmentState, Prisma.AssignmentUpdateManyMutationInput>;
type TenantStep = StateStep<TenantLifecycleState, Prisma.TenantUpdateManyMutationInput>;

/** 🔴 提案を `DRAFT` から順に進める。飛び級をしない（docs/05 §13.6 / §10.3）。 */
async function advanceProposal(
  db: PrismaClient,
  proposalId: string,
  steps: readonly ProposalStep[],
): Promise<void> {
  await advanceState(proposalMachine, {
    id: proposalId,
    from: 'DRAFT',
    steps,
    update: async ({ id: rowId, from, to, data }) => {
      const result = await db.proposal.updateMany({
        where: { id: rowId, state: from },
        data: { ...(data ?? {}), state: to },
      });
      return result.count;
    },
  });
}

async function advanceContract(
  db: PrismaClient,
  contractId: string,
  steps: readonly ContractStep[],
): Promise<void> {
  await advanceState(contractMachine, {
    id: contractId,
    from: 'DRAFT',
    steps,
    update: async ({ id: rowId, from, to, data }) => {
      const result = await db.contract.updateMany({
        where: { id: rowId, state: from },
        data: { ...(data ?? {}), state: to },
      });
      return result.count;
    },
  });
}

async function advanceAssignment(
  db: PrismaClient,
  assignmentId: string,
  steps: readonly AssignmentStep[],
): Promise<void> {
  await advanceState(assignmentMachine, {
    id: assignmentId,
    from: 'SCHEDULED',
    steps,
    update: async ({ id: rowId, from, to, data }) => {
      const result = await db.assignment.updateMany({
        where: { id: rowId, state: from },
        data: { ...(data ?? {}), state: to },
      });
      return result.count;
    },
  });
}

/** 提案を `WON` まで進める 9 手（CLAUDE.md §4.2 の道順そのもの）。 */
function wonProposalSteps(options: {
  readonly approvedBy: string;
  readonly approvedAt: Date;
  readonly submittedAt: Date;
  readonly contentHash: string;
}): readonly ProposalStep[] {
  return [
    { to: 'GATE_RUNNING' },
    { to: 'APPROVAL_PENDING' },
    {
      to: 'APPROVED',
      // 🔴 DB の CHECK（state <> 'APPROVED' OR (approved_at IS NOT NULL AND content_hash IS NOT NULL)）
      //    が、承認記録の無い行を APPROVED にさせない（docs/05 §10.3 / §11.5）。
      data: {
        approvedBy: options.approvedBy,
        approvedAt: options.approvedAt,
        contentHash: options.contentHash,
      },
    },
    { to: 'SUBMITTING' },
    { to: 'SUBMITTED', data: { submittedAt: options.submittedAt } },
    { to: 'INTERVIEW_SCHEDULED' },
    { to: 'INTERVIEWED' },
    { to: 'RESULT_PENDING' },
    { to: 'WON' },
  ];
}

async function seedTenant(ctx: SeedContext, tenantIndex: number): Promise<void> {
  const { db, rng, now } = ctx;
  const ids = ISOLATION_SEED_IDS.tenants[tenantIndex - 1];
  if (!ids) throw new Error(`isolation: tenantIndex=${tenantIndex} の ID がありません。`);

  const companyNames = isolationSeedCompanyNames(tenantIndex);
  const hostCompanyName = companyNames.host;
  const projectNames = isolationSeedProjectNames(tenantIndex);
  const endClientName = rng.pick(FICTIONAL_END_CLIENTS);
  const [partner1] = ids.partners;

  // --- テナント本体 -------------------------------------------------------
  // 🔴 1 つ目のテナントは `SANDBOX` で開設し、`transition()` で `ACTIVE` にする
  //    （CLAUDE.md §4.2 / §11.1「本契約への移行は状態遷移。データを別環境へコピーしない」）。
  //    2 つ目は本契約として開設した想定で最初から `ACTIVE`（開設は遷移ではない。docs/02 §4.2 注記）。
  const opensAsSandbox = tenantIndex === 1;
  const initialLifecycle: TenantLifecycleState = opensAsSandbox ? 'SANDBOX' : 'ACTIVE';
  await db.tenant.create({
    data: {
      id: ids.tenantId,
      name: hostCompanyName,
      // 🔴 テナントの種別は `demo`（合成データ）。APP_ENV（デプロイ環境）とは別物である。
      environment: 'demo',
      lifecycleState: initialLifecycle,
      lifecycleChangedAt: now,
      sandboxExpiresAt: opensAsSandbox ? addDays(now, 30) : null,
      provisioningRequestId: `seed-isolation-provisioning-${tenantIndex}`,
    },
  });
  if (opensAsSandbox) {
    const steps: readonly TenantStep[] = [{ to: 'ACTIVE', data: { lifecycleChangedAt: now } }];
    await advanceState(tenantMachine, {
      id: ids.tenantId,
      from: 'SANDBOX',
      steps,
      update: async ({ id: rowId, from, to, data }) => {
        const result = await db.tenant.updateMany({
          where: { id: rowId, lifecycleState: from },
          data: { ...(data ?? {}), lifecycleState: to, sandboxExpiresAt: null },
        });
        return result.count;
      },
    });
  }

  // --- 取引先 2 社 / 利用者 / 所属 ----------------------------------------
  await db.partnerCompany.createMany({
    data: ids.partners.map((partner, index) => ({
      id: partner.partnerCompanyId,
      tenantId: ids.tenantId,
      name:
        companyNames.partners[index] ?? '株式会社ダミーパートナー',
      contactName: rng.pick(FICTIONAL_PERSON_NAMES),
      contactEmail: seedEmail(`partner-contact-t${tenantIndex}-p${index + 1}`),
      invitedAt: addDays(now, -120),
    })),
  });

  await db.user.createMany({
    data: [
      {
        id: ids.hostUserId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: null,
        email: seedEmail(`host-t${tenantIndex}`),
        displayName: rng.pick(FICTIONAL_PERSON_NAMES),
        passwordHash: SEED_PASSWORD_HASH,
      },
      {
        id: ids.hostOwnerUserId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: null,
        email: seedEmail(`owner-t${tenantIndex}`),
        // 🔴 `rng` を消費しない直接添字にする。`rng.pick` を 1 回増やすと以降の抽選が
        //    ずれ、既存の母集団（他の利用者・エンジニアの氏名）が丸ごと変わってしまう。
        displayName:
          FICTIONAL_PERSON_NAMES[tenantIndex % FICTIONAL_PERSON_NAMES.length] ?? '架空 太郎',
        passwordHash: SEED_PASSWORD_HASH,
      },
      ...ids.partners.map((partner, index) => ({
        id: partner.userId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: partner.partnerCompanyId,
        email: seedEmail(`partner-t${tenantIndex}-p${index + 1}`),
        displayName: rng.pick(FICTIONAL_PERSON_NAMES),
        passwordHash: SEED_PASSWORD_HASH,
      })),
    ],
  });

  await db.membership.createMany({
    data: [
      {
        id: ids.hostMembershipId,
        tenantId: ids.tenantId,
        userId: ids.hostUserId,
        role: 'SALES',
        partnerCompanyId: null,
        joinedAt: addDays(now, -120),
      },
      {
        id: ids.hostOwnerMembershipId,
        tenantId: ids.tenantId,
        userId: ids.hostOwnerUserId,
        role: 'OWNER',
        partnerCompanyId: null,
        joinedAt: addDays(now, -120),
      },
      ...ids.partners.map((partner) => ({
        id: partner.membershipId,
        tenantId: ids.tenantId,
        userId: partner.userId,
        role: 'PARTNER_SALES',
        partnerCompanyId: partner.partnerCompanyId,
        joinedAt: addDays(now, -100),
      })),
    ],
  });

  // --- エンジニア（ホスト所属 1 名 + 各パートナー所属 1 名ずつ）-----------
  await db.engineer.createMany({
    data: [
      {
        id: ids.hostEngineerId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: null,
        displayName: rng.pick(FICTIONAL_PERSON_NAMES),
        availability: 'WORKING',
        availableFrom: dateOnly(addDays(now, 60)),
        unitPriceMin: 700000,
        unitPriceMax: 800000,
        prefecture: rng.pick(PREFECTURES),
        remoteMode: 'PARTIAL_REMOTE',
      },
      ...ids.partners.map((partner) => ({
        id: partner.engineerId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: partner.partnerCompanyId,
        displayName: rng.pick(FICTIONAL_PERSON_NAMES),
        availability: 'WORKING',
        availableFrom: dateOnly(addDays(now, 60)),
        unitPriceMin: 600000,
        unitPriceMax: 700000,
        prefecture: rng.pick(PREFECTURES),
        remoteMode: 'PARTIAL_REMOTE',
      })),
    ],
  });

  // --- 案件（公開 1 / 未公開 1）------------------------------------------
  await db.project.createMany({
    data: [
      {
        id: ids.publishedProjectId,
        tenantId: ids.tenantId,
        name: projectNames.published,
        // 🔴 いずれも公開範囲の外に出さない項目（F-013 AC-2）。経路 5 の射影にも現れない。
        endClientName: `${ISOLATION_FORBIDDEN_MARKERS.endClientName}-${endClientName}`,
        internalUnitPrice: ISOLATION_FORBIDDEN_MARKERS.internalUnitPrice,
        publicSummary: '公開用の概要（合成データ）',
        status: 'OPEN',
        startDate: dateOnly(addDays(now, 30)),
        prefecture: rng.pick(PREFECTURES),
        remoteMode: 'PARTIAL_REMOTE',
      },
      {
        id: ids.privateProjectId,
        tenantId: ids.tenantId,
        name: projectNames.private,
        endClientName: `${ISOLATION_FORBIDDEN_MARKERS.endClientName}-private`,
        internalUnitPrice: ISOLATION_FORBIDDEN_MARKERS.internalUnitPrice,
        publicSummary: null,
        status: 'OPEN',
        startDate: dateOnly(addDays(now, -150)),
        prefecture: rng.pick(PREFECTURES),
        remoteMode: 'ONSITE_ONLY',
      },
    ],
  });

  await db.projectRequirement.createMany({
    data: [
      {
        id: ids.publishedRequirementId,
        tenantId: ids.tenantId,
        projectId: ids.publishedProjectId,
        kind: 'MUST',
        freeText: 'TypeScript 3 年',
        requiredYears: 3,
      },
      {
        id: ids.privateRequirementId,
        tenantId: ids.tenantId,
        projectId: ids.privateProjectId,
        kind: 'MUST',
        freeText: 'Go 3 年',
        requiredYears: 3,
      },
    ],
  });

  // --- 公開時のゲート結果 + 公開範囲（🔴 越境経路 1 の唯一の根拠）---------
  await db.reviewGate.create({
    data: {
      id: ids.publishGateId,
      tenantId: ids.tenantId,
      targetType: 'PROJECT_PUBLISH',
      targetId: ids.publishedProjectId,
      contentHash: `seed-publish-hash-t${tenantIndex}`,
      execution: 'DONE',
      piiVerdict: 'PASS',
      commerceVerdict: 'PASS',
      consistencyVerdict: 'PASS',
      findings: [],
      aiWarnings: [],
      executedAt: addDays(now, -60),
    },
  });

  // 🔴 公開先は 1 社目だけである（2 社目は同じ案件を 1 件も読めない）。
  await db.projectVisibility.create({
    data: {
      id: ids.visibilityId,
      tenantId: ids.tenantId,
      projectId: ids.publishedProjectId,
      partnerCompanyId: partner1.partnerCompanyId,
      publishedAt: addDays(now, -60),
      publishedBy: ids.hostUserId,
      reviewGateId: ids.publishGateId,
    },
  });

  // --- 匿名共有（🔴 越境経路 4 の唯一の根拠。明示的な opt-in）-------------
  await db.engineerShare.createMany({
    data: ids.partners.map((partner) => ({
      id: partner.engineerShareId,
      tenantId: ids.tenantId,
      engineerId: partner.engineerId,
      partnerCompanyId: partner.partnerCompanyId,
      sharedAt: addDays(now, -50),
      sharedBy: partner.userId,
    })),
  });

  // --- 匿名候補（ホストだけが読む生成物。C2）------------------------------
  await db.matchCandidate.createMany({
    data: ids.partners.map((partner) => ({
      id: partner.matchCandidateId,
      tenantId: ids.tenantId,
      projectId: ids.publishedProjectId,
      engineerId: partner.engineerId,
      isAnonymous: true,
      computedAt: addDays(now, -40),
    })),
  });

  // --- 提案（ホスト 1 + 未公開案件 1 + 各パートナー 2）--------------------
  const proposalBase = {
    tenantId: ids.tenantId,
    projectId: ids.publishedProjectId,
    recipientCompanyName: '架空エンド株式会社',
    recipientEmail: seedEmail('recipient'),
    offeredStartDate: dateOnly(addDays(now, 30)),
  };

  await db.proposal.createMany({
    data: [
      {
        ...proposalBase,
        id: ids.hostProposalId,
        ownerPartnerCompanyId: null,
        engineerId: ids.hostEngineerId,
        offeredUnitPrice: 800000,
        subject: 'ホストの提案',
        body: `${ISOLATION_FORBIDDEN_MARKERS.proposalBody}-host-t${tenantIndex}`,
        createdBy: ids.hostUserId,
      },
      {
        ...proposalBase,
        id: ids.privateProposalId,
        ownerPartnerCompanyId: partner1.partnerCompanyId,
        projectId: ids.privateProjectId,
        engineerId: partner1.engineerId,
        offeredUnitPrice: 600000,
        subject: '未公開案件への提案',
        body: `${ISOLATION_FORBIDDEN_MARKERS.proposalBody}-private-t${tenantIndex}`,
        createdBy: partner1.userId,
      },
      ...ids.partners.flatMap((partner, index) => [
        {
          ...proposalBase,
          id: partner.wonProposalId,
          ownerPartnerCompanyId: partner.partnerCompanyId,
          engineerId: partner.engineerId,
          offeredUnitPrice: 650000 + index * 50000,
          subject: `取引先 ${index + 1} の提案`,
          body: `${ISOLATION_FORBIDDEN_MARKERS.proposalBody}-p${index + 1}-t${tenantIndex}`,
          createdBy: partner.userId,
        },
        {
          ...proposalBase,
          id: partner.gateFailedProposalId,
          ownerPartnerCompanyId: partner.partnerCompanyId,
          engineerId: partner.engineerId,
          offeredUnitPrice: 660000 + index * 50000,
          subject: `取引先 ${index + 1} のゲート差し戻し`,
          body: `${ISOLATION_FORBIDDEN_MARKERS.proposalBody}-gatefail-p${index + 1}-t${tenantIndex}`,
          createdBy: partner.userId,
        },
      ]),
    ],
  });

  // 🔴 ここから状態を進める。すべて `packages/domain` の `transition()` を通す。
  const approvedAt = addDays(now, -30);
  const submittedAt = addDays(now, -29);
  await advanceProposal(
    db,
    ids.hostProposalId,
    wonProposalSteps({
      approvedBy: ids.hostUserId,
      approvedAt,
      submittedAt,
      contentHash: `seed-proposal-hash-host-t${tenantIndex}`,
    }),
  );
  await advanceProposal(
    db,
    ids.privateProposalId,
    wonProposalSteps({
      approvedBy: ids.hostUserId,
      approvedAt: addDays(now, -200),
      submittedAt: addDays(now, -199),
      contentHash: `seed-proposal-hash-private-t${tenantIndex}`,
    }),
  );
  for (const [index, partner] of ids.partners.entries()) {
    await advanceProposal(
      db,
      partner.wonProposalId,
      wonProposalSteps({
        approvedBy: ids.hostUserId,
        approvedAt,
        submittedAt,
        contentHash: `seed-proposal-hash-p${index + 1}-t${tenantIndex}`,
      }),
    );
    // 🔴 ゲートで止まった提案は `GATE_FAILED` に留まる。**そこから送信側へ進む道は無い**
    //    （直せるのは元データだけである。CLAUDE.md §3.3）。
    await advanceProposal(db, partner.gateFailedProposalId, [
      { to: 'GATE_RUNNING' },
      { to: 'GATE_FAILED' },
    ]);
  }

  // --- 提案のゲート結果（オーナー列は提案から継承される）------------------
  await db.reviewGate.createMany({
    data: [
      {
        id: ids.hostProposalGateId,
        tenantId: ids.tenantId,
        targetType: 'PROPOSAL',
        targetId: ids.hostProposalId,
        contentHash: `seed-proposal-hash-host-t${tenantIndex}`,
        execution: 'DONE',
        piiVerdict: 'PASS',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        findings: [],
        aiWarnings: [],
        executedAt: approvedAt,
      },
      {
        id: ids.privateProposalGateId,
        tenantId: ids.tenantId,
        targetType: 'PROPOSAL',
        targetId: ids.privateProposalId,
        contentHash: `seed-proposal-hash-private-t${tenantIndex}`,
        execution: 'DONE',
        piiVerdict: 'PASS',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        findings: [],
        aiWarnings: [],
        executedAt: addDays(now, -200),
      },
      ...ids.partners.flatMap((partner, index) => [
        {
          id: partner.proposalGateId,
          tenantId: ids.tenantId,
          targetType: 'PROPOSAL',
          targetId: partner.wonProposalId,
          contentHash: `seed-proposal-hash-p${index + 1}-t${tenantIndex}`,
          execution: 'DONE',
          piiVerdict: 'PASS',
          commerceVerdict: 'PASS',
          consistencyVerdict: 'PASS',
          findings: [],
          aiWarnings: [],
          executedAt: approvedAt,
        },
        {
          id: partner.gateFailedGateId,
          tenantId: ids.tenantId,
          targetType: 'PROPOSAL',
          targetId: partner.gateFailedProposalId,
          contentHash: `seed-proposal-hash-gatefail-p${index + 1}-t${tenantIndex}`,
          execution: 'DONE',
          // 🔴 PII 層の FAIL（氏名が残っている）。合否は機械的照合が決める（CLAUDE.md §3.3）。
          piiVerdict: 'FAIL',
          commerceVerdict: 'PASS',
          consistencyVerdict: 'PASS',
          findings: [{ layer: 'PII', kind: 'PERSON_NAME', severity: 'HIGH' }],
          aiWarnings: [],
          executedAt: addDays(now, -3),
        },
      ]),
    ],
  });

  // --- チャット（🔴 1 スレッドに複数のパートナーを同席させない）-----------
  await db.chatThread.createMany({
    data: ids.partners.map((partner) => ({
      id: partner.threadId,
      tenantId: ids.tenantId,
      kind: 'COMPANY',
      partnerCompanyId: partner.partnerCompanyId,
      lastMessageAt: addDays(now, -5),
    })),
  });

  await db.threadParticipant.createMany({
    data: ids.partners.flatMap((partner) => [
      {
        id: partner.hostParticipantId,
        tenantId: ids.tenantId,
        threadId: partner.threadId,
        partnerCompanyId: null,
        joinedAt: addDays(now, -50),
      },
      {
        id: partner.partnerParticipantId,
        tenantId: ids.tenantId,
        threadId: partner.threadId,
        partnerCompanyId: partner.partnerCompanyId,
        joinedAt: addDays(now, -50),
      },
    ]),
  });

  await db.message.createMany({
    data: ids.partners.flatMap((partner, index) => [
      {
        id: partner.partnerMessageId,
        tenantId: ids.tenantId,
        // 🔴 継承トリガが chat_threads.partner_company_id で上書きする（§4.4.1）。
        ownerPartnerCompanyId: partner.partnerCompanyId,
        threadId: partner.threadId,
        senderUserId: partner.userId,
        senderPartnerCompanyId: partner.partnerCompanyId,
        body: `${ISOLATION_FORBIDDEN_MARKERS.messageBody}-p${index + 1}-t${tenantIndex}`,
        sentAt: addDays(now, -6),
      },
      {
        id: partner.hostMessageId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: partner.partnerCompanyId,
        threadId: partner.threadId,
        senderUserId: ids.hostUserId,
        senderPartnerCompanyId: null,
        body: `ホストから取引先 ${index + 1} への返信（合成データ）`,
        sentAt: addDays(now, -5),
      },
    ]),
  });

  // --- 契約（🔴 各パートナーが当事者の 1 件 + 当事者列 NULL のホスト契約）--
  await db.contract.createMany({
    data: [
      {
        id: ids.hostContractId,
        tenantId: ids.tenantId,
        kind: 'MASTER',
        counterpartyName: endClientName,
        // 🔴 相手方がパートナーでない（ホストとエンド企業の契約）。経路 5 では見えない。
        counterpartyPartnerCompanyId: null,
        projectId: ids.publishedProjectId,
        unitPrice: ISOLATION_FORBIDDEN_MARKERS.internalUnitPrice,
        periodStart: dateOnly(addDays(now, -150)),
        periodEnd: dateOnly(addDays(now, 210)),
        paymentTerms: ISOLATION_FORBIDDEN_MARKERS.contractPaymentTerms,
      },
      ...ids.partners.map((partner, index) => ({
        id: partner.contractId,
        tenantId: ids.tenantId,
        kind: 'INDIVIDUAL',
        counterpartyName:
          companyNames.partners[index] ?? '株式会社ダミーパートナー',
        counterpartyPartnerCompanyId: partner.partnerCompanyId,
        projectId: ids.publishedProjectId,
        engineerId: partner.engineerId,
        // 🔴 BR-66「自社との契約単価」。ホストの販売単価（projects.internal_unit_price）とは別物。
        unitPrice: 650000 + index * 50000,
        periodStart: dateOnly(addDays(now, -30)),
        periodEnd: dateOnly(addDays(now, 55)),
        paymentTerms: ISOLATION_FORBIDDEN_MARKERS.contractPaymentTerms,
      })),
    ],
  });

  // 🔴 契約も `transition()` を通して締結まで進める（DRAFT → SENDING → UNDER_REVIEW → EXECUTED）。
  //    `SENDING` は片道であり、自動リトライしない（CLAUDE.md §4.2）。
  const executedSteps = (executedAt: Date): readonly ContractStep[] => [
    { to: 'SENDING' },
    { to: 'UNDER_REVIEW' },
    // 🔴 CHECK（state <> 'EXECUTED' OR executed_at IS NOT NULL）と、EXECUTED 行を書き換え不可に
    //    する BEFORE UPDATE トリガがあるため、締結日時は同じ UPDATE で入れる。
    { to: 'EXECUTED', data: { executedAt } },
  ];
  await advanceContract(db, ids.hostContractId, executedSteps(addDays(now, -150)));
  for (const partner of ids.partners) {
    await advanceContract(db, partner.contractId, executedSteps(addDays(now, -30)));
  }

  // --- 契約書（署名済みの最終版 + 未署名のドラフト版）---------------------
  await db.contractDocument.createMany({
    data: ids.partners.flatMap((partner) => [
      {
        id: partner.draftDocumentId,
        tenantId: ids.tenantId,
        counterpartyPartnerCompanyId: partner.partnerCompanyId,
        contractId: partner.contractId,
        version: 1,
        objectKey: `${ISOLATION_FORBIDDEN_MARKERS.contractDocumentObjectKey}-v1`,
        scanStatus: 'CLEAN',
        // 🔴 未署名。C9 の `signed_at IS NOT NULL` により取引先には行として存在しない（F-066 AC-2）。
        signedAt: null,
        signers: [{ role: 'HOST', routingOrder: 1, status: 'CREATED' }],
      },
      {
        id: partner.signedDocumentId,
        tenantId: ids.tenantId,
        counterpartyPartnerCompanyId: partner.partnerCompanyId,
        contractId: partner.contractId,
        version: 2,
        objectKey: `${ISOLATION_FORBIDDEN_MARKERS.contractDocumentObjectKey}-v2`,
        scanStatus: 'CLEAN',
        signedAt: addDays(now, -30),
        signers: [
          { role: 'HOST', routingOrder: 1, status: 'SIGNED' },
          { role: 'PARTNER', routingOrder: 2, status: 'SIGNED' },
        ],
      },
    ]),
  });

  // --- 稼働（🔴 同一案件に両社 + ホストの稼働を置く）----------------------
  //    当事者列はエンジニアの所有者から継承される（入力では指定しない。F-065 処理①）。
  await db.assignment.createMany({
    data: [
      {
        id: ids.hostAssignmentId,
        tenantId: ids.tenantId,
        engineerId: ids.hostEngineerId,
        projectId: ids.publishedProjectId,
        proposalId: ids.hostProposalId,
        startDate: dateOnly(addDays(now, -30)),
        // 🔴 満了 55 日後（次の assignment.expiry-scan で起票される位置。docs/05 §13.6）。
        endDate: dateOnly(addDays(now, 55)),
        unitPrice: 800000,
        ownerUserId: ids.hostUserId,
      },
      ...ids.partners.map((partner, index) => ({
        id: partner.assignmentId,
        tenantId: ids.tenantId,
        engineerId: partner.engineerId,
        projectId: ids.publishedProjectId,
        proposalId: partner.wonProposalId,
        startDate: dateOnly(addDays(now, -30)),
        endDate: dateOnly(addDays(now, 55)),
        unitPrice: 650000 + index * 50000,
        ownerUserId: ids.hostUserId,
      })),
      {
        id: ids.privateAssignmentId,
        tenantId: ids.tenantId,
        engineerId: partner1.engineerId,
        projectId: ids.privateProjectId,
        proposalId: ids.privateProposalId,
        startDate: dateOnly(addDays(now, -180)),
        endDate: dateOnly(addDays(now, 20)),
        unitPrice: 600000,
        ownerUserId: ids.hostUserId,
      },
    ],
  });

  await advanceAssignment(db, ids.hostAssignmentId, [{ to: 'ACTIVE' }]);
  for (const partner of ids.partners) {
    await advanceAssignment(db, partner.assignmentId, [{ to: 'ACTIVE' }]);
  }
  // 🔴 満了 60 日前を過ぎた稼働は延長確認へ（CLAUDE.md §4.2 / §1.3 の ⑥）。
  await advanceAssignment(db, ids.privateAssignmentId, [
    { to: 'ACTIVE' },
    { to: 'EXTENSION_REVIEW', data: { reviewOpenedAt: addDays(now, -1) } },
  ]);

  // --- 発注（当事者列は契約から継承）--------------------------------------
  await db.order.createMany({
    data: ids.partners.map((partner, index) => ({
      id: partner.orderId,
      tenantId: ids.tenantId,
      contractId: partner.contractId,
      assignmentId: partner.assignmentId,
      amount: 650000 + index * 50000,
      periodStart: dateOnly(addDays(now, -30)),
      periodEnd: dateOnly(now),
      paymentState: 'UNPAID',
    })),
  });

  // --- 延長確認（🔴 ホスト内部。当事者列を持たず、取引先向けの経路が 1 つも無い）
  await db.extensionReview.create({
    data: {
      id: ids.extensionReviewId,
      tenantId: ids.tenantId,
      assignmentId: ids.privateAssignmentId,
      openedAt: addDays(now, -1),
      ownerUserId: ids.hostUserId,
      facts: { note: ISOLATION_FORBIDDEN_MARKERS.extensionReviewFacts },
      summary: { note: ISOLATION_FORBIDDEN_MARKERS.extensionReviewSummary },
    },
  });

  // --- タスク・通知 -------------------------------------------------------
  await db.task.createMany({
    data: [
      {
        id: ids.hostTaskId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: null,
        kind: 'EXTENSION_REVIEW',
        targetType: 'Assignment',
        targetId: ids.privateAssignmentId,
        dueOn: dateOnly(addDays(now, 7)),
        assigneeUserId: ids.hostUserId,
      },
      ...ids.partners.map((partner) => ({
        id: partner.taskId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: partner.partnerCompanyId,
        kind: 'INTERVIEW',
        targetType: 'Proposal',
        targetId: partner.wonProposalId,
        dueOn: dateOnly(addDays(now, 3)),
        assigneeUserId: partner.userId,
      })),
    ],
  });

  await db.notification.createMany({
    data: [
      {
        id: ids.hostNotificationId,
        tenantId: ids.tenantId,
        recipientUserId: ids.hostUserId,
        kind: 'PROPOSAL_SUBMITTED',
        title: 'ホスト宛の通知（合成データ）',
        bodyKey: 'notify.proposal.submitted',
        bodyParams: {},
      },
      ...ids.partners.map((partner) => ({
        id: partner.notificationId,
        tenantId: ids.tenantId,
        recipientUserId: partner.userId,
        kind: 'PROPOSAL_SUBMITTED',
        title: '取引先宛の通知（合成データ）',
        bodyKey: 'notify.proposal.submitted',
        bodyParams: {},
      })),
    ],
  });
}

/**
 * 運営者アカウントを投入する（`CLAUDE.md` §10.5 / `BR-36`）。
 *
 * 🔴 `platform_users` と `two_factor_credentials` の `PLATFORM_USER` 行は **`tenant_id` を
 *    持たない**ため、`reset()`（`deleteTenantData`。`tenant_id` 列で絞る）の対象外である。
 *    そのため投入は `upsert` で行い、2 要素認証の資格情報は投入のたびに作り直す
 *    （`docs/05` §13.6「冪等に再生成できる」を、テナント外の 2 表でも成立させる）。
 * 🔴 2 要素認証の資格情報を**シードでは作らない**（`confirmedAt` 済みの行を置かない）。
 *    シークレットの平文をリポジトリに置かずに済み、E2E は `A-001` の登録ウィザードが
 *    画面へ返す `otpauth://` URL からコードを計算できる（テスト専用のフックを作らない）。
 */
async function seedPlatformUsers(ctx: SeedContext): Promise<void> {
  const { db } = ctx;
  const users = [ISOLATION_SEED_PLATFORM_USERS.owner, ISOLATION_SEED_PLATFORM_USERS.support];

  await db.twoFactorCredential.deleteMany({
    where: { subjectType: 'PLATFORM_USER', subjectId: { in: users.map((user) => user.id) } },
  });

  for (const user of users) {
    const values = {
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      passwordHash: SEED_PASSWORD_HASH,
      disabledAt: null,
      lastLoginAt: null,
    };
    await db.platformUser.upsert({
      where: { id: user.id },
      create: { id: user.id, ...values },
      update: values,
    });
  }
}

export const isolationPreset: SeedPreset = {
  name: 'isolation',
  rngSeed: 'ses-isolation-v1',
  tenantIds: ISOLATION_SEED_IDS.tenants.map((tenant) => tenant.tenantId),
  async seed(ctx: SeedContext): Promise<void> {
    for (let tenantIndex = 1; tenantIndex <= ISOLATION_SEED_IDS.tenants.length; tenantIndex += 1) {
      await seedTenant(ctx, tenantIndex);
    }
    await seedPlatformUsers(ctx);
  },
};
