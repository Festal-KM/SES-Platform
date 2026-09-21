// packages/db/seed/presets/demo.ts
// 🔴 `seed:demo`（T-10-06。docs/sprints/SP-10-usage-env-sandbox.md §4 T-10-06 / docs/05 §13.6 /
//    docs/02 `F-053` / docs/04 §A-012 / `BR-45` / `BR-47` / `BR-63` / `CLAUDE.md` §11）。
//
// 営業が客先で実演する `demo` 環境の**合成データ一式**。`isolation`（分離の検証の母集団）とは目的が違い、
// 「業務として筋の通った一式」を作る（`F-053` の入力: 複数の取引先・数十人規模の台帳・進行中の提案・
// 満了が近い稼働・ゲートで止まる資料・匿名共有が有効な候補）。
//
// ============================================================================
// 🔴 このプリセットが守る 5 つの規律（docs/05 §13.6）
// ============================================================================
//   ① **決定的**: ID は `seedUuid`（乱数 UUID にしない）、氏名・会社名の割り当ては固定シードの疑似乱数。
//      同じ `now` で 2 回実行すれば同じ行になる（`F-053 AC-2` の前提。`tests/isolation/seed-demo.test.ts`）。
//   ② **相対日**: 「実行日 = `T`」からの相対日だけで時系列を作る。満了 `T+55` 日の稼働（次の `assignment.expiry-scan`
//      で起票される位置）/ `T-7` に送信した提案（`INTERVIEW_SCHEDULED`）/ `T-3` にゲート FAIL した提案。
//   ③ 🔴 **状態は `transition()` を通す**: 行は必ず初期状態（`DRAFT` / `REQUESTED` / `SCHEDULED`）で作り、
//      `advanceState`（`packages/domain` の遷移表 + CAS）で 1 手ずつ進める。**状態を直接 INSERT しない。**
//      承認・送信の CAS が要求する三つ巴（`proposals.content_hash` = `review_gates.content_hash` = 現在の内容のハッシュ。
//      docs/05 §11.5）は、`packages/db` の**同じ 1 実装**（`computeProposalContentHash` / `gateContentHash`）で満たす —— だから
//      投入直後の `APPROVAL_PENDING` は #41 でそのまま承認でき、`GATE_FAILED` は 422 になる（`F-053 AC-3`）。
//   ④ 🔴 **合成データのみ**（`F-053 AC-1` / `BR-47`）: 企業名は「株式会社サンプルアルファ」「株式会社ダミーチャーリー」
//      「架空商事株式会社」のように**接頭辞で架空と分かる語**だけを使い、氏名は `DEMO_SEED_NAME_RULES` の姓 × 名の
//      組み合わせ（「サンプル 太郎」）から選ぶ。メール・送信ドメインは RFC 6761 の `.example`。スキルシートの原本
//      （`skill_sheets`）は 1 行も作らない（実データ由来のファイルをリポジトリに置かない）。
//   ⑤ 🔴 **`sandbox` に投入しない**: 実行できる環境は `runSeed()` の先頭の `assertSeedableAppEnv`（`packages/config`）が縛る。
//      このファイルは環境を判定しない（判定を 2 箇所に書かない）。
//
// ============================================================================
// 🔴 なぜ `gate.run` / `send.proposal` のハンドラを直接呼ばないか（T-10-06 の決着。docs/05 §13.6）
// ============================================================================
// ハンドラは `apps/worker` にあり、`packages/*` → `apps/*` は依存方向違反（`CLAUDE.md` §2.1 / ESLint）。
// `apps/web`（API-A16）は `@ses/ai` の実行系を import できない（`tests/static/ai-single-path.test.ts`）。
// したがって seed が実行できる「ゲートの結果」は、**ハンドラが最後に書くのと同じ行**（`review_gates` の DONE 行 +
// 対象の CAS + `ProposalEvent` + `AuditLog(GATE_RESULT)`）である。判定の中身は `demo` のモック AI の既定応答
// （全層 PASS。Issue #44）と、機械的照合が拾う既知値（`GATE_FAILED` の提案は本文にエンジニアの氏名を含む =
// PII 層 `FULL_NAME`）を写す。**seed が作った行が実物のパイプラインと整合すること**は結合テストが、seed の `DRAFT` に
// 対して実物の `gate.run` ハンドラ（モック AI）と #41 を実行して確かめる。
//
// ============================================================================
// 🔴 送信ドメイン（Issue #57 の暫定対応）
// ============================================================================
// 非本番では `domain.verify` が SES の identity API を持たず検証を成立させられない（Issue #57 未回答）。`demo` で
// `SUBMITTED` の提案を作る・実演で送信を通すには `tenant_sending_domains` が `VERIFIED` である必要があるため、
// **seed が合成ドメイン（`demo-alpha.example`）の `VERIFIED` 行を直接作る**（E2E ハーネスの
// `registerVerifiedSendingDomainForE2e` と同じ列を書く）。`sandbox` にはこの経路は無い（`sandbox` には投入しない）。
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  assignmentMachine,
  idempotencyKey,
  proposalMachine,
  proposalRequestMachine,
  type AssignmentState,
  type GateFinding,
  type ProposalRequestState,
  type ProposalState,
} from '@ses/domain';
import { auditLogRowValues, type AuditLogEntry } from '../../src/audit.js';
import { PROPOSAL_AUDIT_TARGET_TYPE } from '../../src/proposal-draft.js';
import { computeProposalContentHash, gateContentHash } from '../../src/gate-content-hash.js';
import { addDays, advanceState, dateOnly, seedUuid, type StateStep } from '../support.js';
import type { SeedRng } from '../rng.js';
import type { SeedContext, SeedPreset } from '../types.js';
import { GLOBAL_SKILL_IDS, seedGlobalSkills } from './global-skills.js';

// ---------------------------------------------------------------------------
// ID（🔴 決定的。`isolation`（`150a`）と ID 空間を分ける）
// ---------------------------------------------------------------------------

const PRESET_CODE = 'de00';

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
  ASSIGNMENT: 0x12,
  CAREER: 0x17,
  ENGINEER_SKILL: 0x18,
  PROPOSAL_REQUEST: 0x19,
  SNAPSHOT: 0x1a,
  PROPOSAL_EVENT: 0x1b,
  SEND_ATTEMPT: 0x1c,
  SENDING_DOMAIN: 0x1d,
  AUDIT_LOG: 0x1e,
} as const;

function id(tenantIndex: number, entityCode: number, seq: number): string {
  return seedUuid({ presetCode: PRESET_CODE, tenantIndex, entityCode, seq });
}

/** パートナー配下の連番（パートナー番号 × 16 + 連番）。ホスト配下は 1..15。 */
function partnerSeq(partnerIndex: number, seq: number): number {
  return partnerIndex * 0x10 + seq;
}

// ---------------------------------------------------------------------------
// 合成データの素材（🔴 実在の企業名・個人名を使わない。F-053 AC-1 / BR-47）
// ---------------------------------------------------------------------------

/**
 * 🔴 氏名・会社名の生成規則。**静的テスト（`tests/static/demo-seed-no-real-names.test.ts`）と結合テスト
 *    （`F-053 AC-1`）はこの規則と突き合わせる。** ここに無い語で氏名・会社名を作らない。
 */
export const DEMO_SEED_NAME_RULES = {
  /** 氏名の姓（架空であることが語から分かるもの）。 */
  familyNames: ['サンプル', '架空', '仮名', '見本', '例示', '試験', '模擬', '仮想'],
  /** 氏名の名（姓と組み合わせて「サンプル 太郎」）。 */
  givenNames: ['太郎', '花子', '一郎', '二子', '三郎', '四葉', '五郎', '六花', '七海', '八雲', '九蔵', '十和'],
  /** ホスト（契約 SES 企業）の商号。 */
  hostCompanies: ['株式会社サンプルアルファ', '株式会社サンプルブラボー'],
  /** 取引先の商号の接頭辞（`株式会社ダミー` + カナ）。 */
  partnerCompanyPrefix: '株式会社ダミー',
  partnerCompanySuffixes: ['チャーリー', 'デルタ', 'エコー', 'フォックス', 'ゴルフ', 'ホテル'],
  /** エンド企業（提案先）の商号の接頭辞（`架空` + 業種 + `株式会社`）。 */
  endClientPrefix: '架空',
  endClientBodies: ['商事', 'システム', '物流', '金融', '製造', '通信'],
  /** 会社名・氏名の接頭辞の全集合（`F-053 AC-1` の照合に使う）。 */
  companyPrefixes: ['株式会社サンプル', '株式会社ダミー', '架空'],
} as const;

/** 🔴 実在しないことが保証された TLD（RFC 6761 の `.example`）だけを使う。 */
export const DEMO_SEED_DOMAINS = ['demo-alpha.example', 'demo-beta.example'] as const;

/** 提案先（テナント外のエンド企業）の合成メールドメイン。 */
const RECIPIENT_MAIL_DOMAIN = 'kakuu-client.example';

const PREFECTURES = ['13', '14', '11', '12', '27', '23', '40'] as const;
const REMOTE_MODES = ['FULL_REMOTE', 'PARTIAL_REMOTE', 'ONSITE_ONLY'] as const;

/**
 * 🔴 合成データ専用のサインインパスワード（`isolation` の `ISOLATION_SEED_PASSWORD` と同じ整理）。
 *    シークレットではない —— `assertSeedableAppEnv` により `development` / `demo` にしか投入されず、
 *    この資格情報で到達できるのは同じプリセットが作った合成データだけである。**本番・sandbox には流用しない。**
 */
export const DEMO_SEED_PASSWORD = 'seed-demo-password-1';

/** 上の平文に対応する Argon2id ハッシュ（`apps/web/lib/auth/password.ts` の `ARGON2_OPTIONS`。m=19456,t=2,p=1）。`perf` も同じ値を使う。 */
export const DEMO_SEED_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$njVryvGaze4gUls71U5fgw$sy1qmwBk+VflUpvHchvHjC4lnbXK61R9F7yur/swZmg';

function seedEmail(tenantIndex: number, local: string): string {
  return `${local}@${DEMO_SEED_DOMAINS[tenantIndex - 1] ?? 'demo.example'}`;
}

// ---------------------------------------------------------------------------
// テナントごとの規模（🔴 `demo` は 2 テナント。片方は取引先 5 社・もう片方は 1 社。docs/05 §13.6）
// ---------------------------------------------------------------------------

type TenantProfile = {
  readonly slug: 'demo-alpha' | 'demo-beta';
  readonly partnerCount: number;
  readonly hostEngineerCount: number;
};

const TENANT_PROFILES: readonly [TenantProfile, TenantProfile] = [
  { slug: 'demo-alpha', partnerCount: 5, hostEngineerCount: 10 },
  { slug: 'demo-beta', partnerCount: 1, hostEngineerCount: 4 },
];

/** 各パートナーの自社エンジニア数（`e1`..`e4`。`e1` / `e2` は共有可）。 */
const PARTNER_ENGINEER_COUNT = 4;

// ---------------------------------------------------------------------------
// ID の束（🔴 テスト・`A-012` の実演チェックリストが参照する唯一の出所）
// ---------------------------------------------------------------------------

export type DemoPartnerIds = {
  readonly partnerCompanyId: string;
  readonly adminUserId: string;
  readonly salesUserId: string;
  readonly adminMembershipId: string;
  readonly salesMembershipId: string;
  /** `e1`..`e4`。 */
  readonly engineerIds: readonly string[];
  /** 共有可にした `e1` / `e2` の `EngineerShare`（🔴 越境経路 4 の唯一の根拠）。 */
  readonly shareIds: readonly string[];
};

export type DemoProjectIds = {
  /** PJ1: 一部の取引先に公開（`DRAFT` / `GATE_FAILED` / 辞退された依頼）。 */
  readonly published3: string;
  /** PJ2: 全取引先に公開（`APPROVAL_PENDING` / `APPROVED` / `SUBMITTED` / `INTERVIEW_SCHEDULED`）。 */
  readonly publishedAll: string;
  /** PJ3: 1 社に公開（`REQUESTED` の提案依頼）。 */
  readonly publishedOne: string;
  /** PJ4: 未公開。匿名候補が混在する候補一覧（`S-016`）の起点 = 実演シナリオ B の開始地点。 */
  readonly unpublishedCandidates: string;
  /** PJ5: 充足済み（`WON` → `Assignment(ACTIVE)` / `LOST`）。 */
  readonly filled: string;
  /** PJ6: 未公開・公開の準備が整った案件 = 実演シナリオ A（公開 → 提案 → …）の開始地点。 */
  readonly unpublishedReady: string;
};

export type DemoProposalIds = {
  readonly draft: string;
  /** `T-3` にゲート FAIL（PII 層。本文にエンジニアの氏名）。 */
  readonly gateFailed: string;
  /** 提案依頼（`ACCEPTED`）から生まれ、ゲート PASS 済みで承認待ち。#41 でそのまま承認できる。 */
  readonly approvalPending: string;
  readonly approved: string;
  /** `T-5` に送信。🔴 台帳側の経歴が凍結後に増えている組（`S-023` の差分ビューの母集団。docs/05 §13.6）。 */
  readonly submitted: string;
  /** `T-7` に送信し面談日程が決まった提案。 */
  readonly interviewScheduled: string;
  /** `WON` → `Assignment` の生成元。 */
  readonly won: string;
  readonly lost: string;
};

export type DemoProposalRequestIds = {
  readonly requested: string;
  readonly accepted: string;
  readonly declined: string;
};

export type DemoTenantIds = {
  readonly tenantId: string;
  readonly hostOwnerUserId: string;
  readonly hostAdminUserId: string;
  /** `SALES` 2 名（実演でサインインする主利用者。2 要素認証を要求されない）。 */
  readonly hostSalesUserIds: readonly [string, string];
  readonly hostEngineerIds: readonly string[];
  readonly partners: readonly DemoPartnerIds[];
  readonly projects: DemoProjectIds;
  readonly proposalRequests: DemoProposalRequestIds;
  readonly proposals: DemoProposalIds;
  /** `WON` の提案から生まれた稼働（満了 `T+55`。`ACTIVE`）。 */
  readonly assignmentId: string;
  readonly sendingDomainId: string;
};

function buildPartnerIds(tenantIndex: number, partnerIndex: number): DemoPartnerIds {
  const seq = (n: number): number => partnerSeq(partnerIndex, n);
  return {
    partnerCompanyId: id(tenantIndex, ENTITY.PARTNER, seq(1)),
    adminUserId: id(tenantIndex, ENTITY.USER, seq(1)),
    salesUserId: id(tenantIndex, ENTITY.USER, seq(2)),
    adminMembershipId: id(tenantIndex, ENTITY.MEMBERSHIP, seq(1)),
    salesMembershipId: id(tenantIndex, ENTITY.MEMBERSHIP, seq(2)),
    engineerIds: Array.from({ length: PARTNER_ENGINEER_COUNT }, (_, n) =>
      id(tenantIndex, ENTITY.ENGINEER, seq(n + 1)),
    ),
    shareIds: [1, 2].map((n) => id(tenantIndex, ENTITY.SHARE, seq(n))),
  };
}

function buildTenantIds(tenantIndex: number, profile: TenantProfile): DemoTenantIds {
  return {
    tenantId: id(tenantIndex, ENTITY.TENANT, 1),
    hostOwnerUserId: id(tenantIndex, ENTITY.USER, 1),
    hostAdminUserId: id(tenantIndex, ENTITY.USER, 2),
    hostSalesUserIds: [id(tenantIndex, ENTITY.USER, 3), id(tenantIndex, ENTITY.USER, 4)],
    hostEngineerIds: Array.from({ length: profile.hostEngineerCount }, (_, n) =>
      id(tenantIndex, ENTITY.ENGINEER, n + 1),
    ),
    partners: Array.from({ length: profile.partnerCount }, (_, n) => buildPartnerIds(tenantIndex, n + 1)),
    projects: {
      published3: id(tenantIndex, ENTITY.PROJECT, 1),
      publishedAll: id(tenantIndex, ENTITY.PROJECT, 2),
      publishedOne: id(tenantIndex, ENTITY.PROJECT, 3),
      unpublishedCandidates: id(tenantIndex, ENTITY.PROJECT, 4),
      filled: id(tenantIndex, ENTITY.PROJECT, 5),
      unpublishedReady: id(tenantIndex, ENTITY.PROJECT, 6),
    },
    proposalRequests: {
      requested: id(tenantIndex, ENTITY.PROPOSAL_REQUEST, 1),
      accepted: id(tenantIndex, ENTITY.PROPOSAL_REQUEST, 2),
      declined: id(tenantIndex, ENTITY.PROPOSAL_REQUEST, 3),
    },
    proposals: {
      draft: id(tenantIndex, ENTITY.PROPOSAL, 1),
      gateFailed: id(tenantIndex, ENTITY.PROPOSAL, 2),
      approvalPending: id(tenantIndex, ENTITY.PROPOSAL, 3),
      approved: id(tenantIndex, ENTITY.PROPOSAL, 4),
      submitted: id(tenantIndex, ENTITY.PROPOSAL, 5),
      interviewScheduled: id(tenantIndex, ENTITY.PROPOSAL, 6),
      won: id(tenantIndex, ENTITY.PROPOSAL, 7),
      lost: id(tenantIndex, ENTITY.PROPOSAL, 8),
    },
    assignmentId: id(tenantIndex, ENTITY.ASSIGNMENT, 1),
    sendingDomainId: id(tenantIndex, ENTITY.SENDING_DOMAIN, 1),
  };
}

/** 🔴 テスト・画面が参照する ID の唯一の出所。 */
export const DEMO_SEED_IDS: { readonly tenants: readonly [DemoTenantIds, DemoTenantIds] } = {
  tenants: [buildTenantIds(1, TENANT_PROFILES[0]), buildTenantIds(2, TENANT_PROFILES[1])],
};

/**
 * 🔴 API-A16 の冪等キー。`tenants.provisioning_request_id` は UNIQUE であり、この値の行が既にあれば
 *    「投入済み」と判定して二重投入しない（`packages/db/seed/index.ts` の `readSeedPresence`）。
 */
export function demoSeedProvisioningRequestId(tenantIndex: number): string {
  return `seed-demo-provisioning-${tenantIndex}`;
}

/** テナント / パートナーの会社名（投入時と同じ式から導く。ずれ得ない）。 */
export function demoSeedCompanyNames(tenantIndex: number): {
  readonly host: string;
  readonly partners: readonly string[];
} {
  const profile = TENANT_PROFILES[tenantIndex - 1] ?? TENANT_PROFILES[1];
  const { hostCompanies, partnerCompanyPrefix, partnerCompanySuffixes } = DEMO_SEED_NAME_RULES;
  // 🔴 2 テナントで取引先の商号が重ならないよう、beta は末尾から採る。
  const suffixes =
    tenantIndex === 1
      ? partnerCompanySuffixes.slice(0, profile.partnerCount)
      : partnerCompanySuffixes.slice(-profile.partnerCount);
  return {
    host: hostCompanies[tenantIndex - 1] ?? hostCompanies[1],
    partners: suffixes.map((suffix) => `${partnerCompanyPrefix}${suffix}`),
  };
}

/** シードが作る利用者のメールアドレス（実演のサインインに使う。`A-012` の実演チェックリストに出す）。 */
export function demoSeedEmails(tenantIndex: number): {
  readonly hostOwner: string;
  readonly hostAdmin: string;
  readonly hostSales: readonly [string, string];
  readonly partnerAdmin: (partnerIndex: number) => string;
  readonly partnerSales: (partnerIndex: number) => string;
} {
  return {
    hostOwner: seedEmail(tenantIndex, 'owner'),
    hostAdmin: seedEmail(tenantIndex, 'admin'),
    hostSales: [seedEmail(tenantIndex, 'sales-1'), seedEmail(tenantIndex, 'sales-2')],
    partnerAdmin: (partnerIndex) => seedEmail(tenantIndex, `partner-${partnerIndex}-admin`),
    partnerSales: (partnerIndex) => seedEmail(tenantIndex, `partner-${partnerIndex}-sales`),
  };
}

// ---------------------------------------------------------------------------
// 氏名の決定的な割り当て（🔴 テナント内で重複させない）
// ---------------------------------------------------------------------------

/** 姓 × 名の直積を固定シードで並べ替え、先頭から順に配る（同じシードなら同じ並び）。 */
function shuffledPersonNames(rng: SeedRng): string[] {
  const pool: string[] = [];
  for (const family of DEMO_SEED_NAME_RULES.familyNames) {
    for (const given of DEMO_SEED_NAME_RULES.givenNames) pool.push(`${family} ${given}`);
  }
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = rng.int(0, index);
    const current = pool[index] as string;
    pool[index] = pool[swap] as string;
    pool[swap] = current;
  }
  return pool;
}

function endClientName(index: number): string {
  const { endClientPrefix, endClientBodies } = DEMO_SEED_NAME_RULES;
  return `${endClientPrefix}${endClientBodies[index % endClientBodies.length] ?? '商事'}株式会社`;
}

// ---------------------------------------------------------------------------
// 状態遷移（🔴 すべて `transition()` を通す。`ProposalEvent` も同時に残す）
// ---------------------------------------------------------------------------

type ProposalStep = StateStep<ProposalState, Prisma.ProposalUpdateManyMutationInput> & {
  /** 遷移の発生日時（`ProposalEvent.occurredAt`）。 */
  readonly at: Date;
  /** `null` = system（ゲート / 送信ジョブ）。 */
  readonly actorUserId: string | null;
  readonly note?: string;
};

/**
 * 🔴 提案を `DRAFT` から順に進め、1 手ごとに `proposal_events` の `STATE` 行を残す
 *    （`S-023` の履歴が実物の経路と同じ形で読めるように）。飛び級をしない（docs/05 §10.3）。
 */
async function advanceProposal(
  db: PrismaClient,
  tenantIndex: number,
  tenantId: string,
  proposalId: string,
  proposalSeq: number,
  steps: readonly ProposalStep[],
): Promise<void> {
  let eventSeq = 0;
  await advanceState(proposalMachine, {
    id: proposalId,
    from: 'DRAFT',
    steps,
    update: async ({ id: rowId, from, to, data }) => {
      const step = steps[eventSeq] as ProposalStep;
      const result = await db.proposal.updateMany({
        where: { id: rowId, state: from },
        data: { ...(data ?? {}), state: to, updatedAt: step.at },
      });
      if (result.count === 1) {
        eventSeq += 1;
        await db.proposalEvent.create({
          data: {
            id: id(tenantIndex, ENTITY.PROPOSAL_EVENT, proposalSeq * 0x10 + eventSeq),
            tenantId,
            proposalId,
            kind: 'STATE',
            fromState: from,
            toState: to,
            actorUserId: step.actorUserId,
            note: step.note ?? null,
            occurredAt: step.at,
          },
        });
      }
      return result.count;
    },
  });
}

async function advanceProposalRequest(
  db: PrismaClient,
  requestId: string,
  step: StateStep<ProposalRequestState, Prisma.ProposalRequestUpdateManyMutationInput>,
): Promise<void> {
  await advanceState(proposalRequestMachine, {
    id: requestId,
    from: 'REQUESTED',
    steps: [step],
    update: async ({ id: rowId, from, to, data }) => {
      const result = await db.proposalRequest.updateMany({
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
  steps: readonly StateStep<AssignmentState, Prisma.AssignmentUpdateManyMutationInput>[],
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

// ---------------------------------------------------------------------------
// 監査ログ（🔴 実物の経路が残すのと同じ action / summary の形。PII を載せない）
// ---------------------------------------------------------------------------

class AuditWriter {
  private seq = 0;

  constructor(
    private readonly db: PrismaClient,
    private readonly tenantIndex: number,
    private readonly tenantId: string,
  ) {}

  async write(entry: AuditLogEntry & { readonly createdAt: Date }): Promise<void> {
    this.seq += 1;
    const { createdAt, ...rest } = entry;
    await this.db.auditLog.create({
      data: {
        id: id(this.tenantIndex, ENTITY.AUDIT_LOG, this.seq),
        tenantId: this.tenantId,
        ...auditLogRowValues(rest),
        createdAt,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// 投入の本体
// ---------------------------------------------------------------------------

type EngineerSeed = {
  readonly engineerId: string;
  readonly seq: number;
  readonly ownerPartnerCompanyId: string | null;
  readonly displayName: string;
  readonly affiliationLabel: string | null;
  readonly availability: 'WORKING' | 'STANDBY_SCHEDULED' | 'STANDBY';
  readonly availableFrom: Date;
  readonly unitPriceMin: number;
  readonly unitPriceMax: number;
  readonly prefecture: string;
  readonly remoteMode: (typeof REMOTE_MODES)[number];
  readonly skills: readonly { readonly name: string; readonly years: number; readonly level: number }[];
  readonly careers: readonly CareerSeed[];
};

type CareerSeed = {
  readonly periodFrom: string;
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
  /** 台帳への登録日時（凍結後に足された行を表すために使う）。 */
  readonly createdAt: Date;
};

const CAREER_ROLES = ['PG', 'SE', 'PL', 'テスター', 'インフラ担当'] as const;
/** 業務内容に書く業種（🔴 企業名ではない）。 */
const CAREER_INDUSTRIES = ['商社', '金融', '製造', '物流', '通信', '小売'] as const;
const CAREER_TOPICS = [
  '受発注システムの刷新',
  '会員向け Web サービスの機能追加',
  '販売管理システムのクラウド移行',
  '社内ポータルの保守運用',
  'データ連携基盤の構築',
  'モバイルアプリのバックエンド開発',
] as const;
const SKILL_POOL = [
  'Java',
  'TypeScript',
  'Python',
  'Go',
  'Spring Boot',
  'React',
  'Next.js',
  'PostgreSQL',
  'MySQL',
  'AWS',
  'Docker',
  'Kubernetes',
  '要件定義',
  '基本設計',
  'テスト設計',
] as const;

function yearMonth(base: Date, monthsAgo: number): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - monthsAgo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 経歴を決定的に作る（`count` 行。直近から過去へ連続する期間）。
 * 🔴 業務内容に**企業名を書かない**（業種だけ）。凍結された経歴（`snapshot` 欄）はゲートの検査対象であり、案件のエンド企業名が
 *    そこに現れると商流層（`END_CLIENT`）で FAIL になる —— 実演で「氏名を書いたから不合格」だけを見せるため、他の理由で止まる行を作らない。
 */
function buildCareers(rng: SeedRng, now: Date, count: number, ledgerCreatedAt: Date): CareerSeed[] {
  const rows: CareerSeed[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const length = rng.int(6, 24);
    const periodTo = index === 0 ? null : yearMonth(now, cursor);
    const periodFrom = yearMonth(now, cursor + length);
    cursor += length + 1;
    const industry = rng.pick(CAREER_INDUSTRIES);
    rows.push({
      periodFrom,
      periodTo,
      role: rng.pick(CAREER_ROLES),
      description: `${industry}向け ${rng.pick(CAREER_TOPICS)}。設計〜結合テストを担当（合成データ）。`,
      technologies: `${rng.pick(SKILL_POOL)} / ${rng.pick(SKILL_POOL)}`,
      createdAt: ledgerCreatedAt,
    });
  }
  return rows;
}

function pickSkills(
  rng: SeedRng,
  required: readonly { readonly name: string; readonly years: number }[],
): EngineerSeed['skills'] {
  const chosen = new Map<string, { name: string; years: number; level: number }>();
  for (const skill of required) chosen.set(skill.name, { ...skill, level: rng.int(3, 4) });
  const extra = rng.int(2, 4);
  let guard = 0;
  while (chosen.size < required.length + extra && guard < 32) {
    guard += 1;
    const name = rng.pick(SKILL_POOL);
    if (chosen.has(name)) continue;
    chosen.set(name, { name, years: rng.int(1, 12), level: rng.int(2, 4) });
  }
  return [...chosen.values()];
}

/** 案件の MUST 要件（整合層 = 機械的照合の母集団。提案するエンジニアはこれを満たす）。 */
const PROJECT_MUST = {
  published3: { name: 'Java', years: 3 },
  publishedAll: { name: 'Java', years: 3 },
  publishedOne: { name: 'AWS', years: 2 },
  unpublishedCandidates: { name: 'Python', years: 2 },
  filled: { name: 'TypeScript', years: 3 },
  unpublishedReady: { name: 'TypeScript', years: 2 },
} as const satisfies Record<keyof DemoProjectIds, { readonly name: string; readonly years: number }>;

const PROJECT_NICE = {
  published3: 'AWS',
  publishedAll: 'Spring Boot',
  publishedOne: 'Kubernetes',
  unpublishedCandidates: 'PostgreSQL',
  filled: 'React',
  unpublishedReady: 'Next.js',
} as const satisfies Record<keyof DemoProjectIds, string>;

const PROJECT_TEXTS: Record<
  keyof DemoProjectIds,
  { readonly name: string; readonly publicSummary: string | null; readonly status: 'OPEN' | 'FILLED' }
> = {
  published3: {
    name: 'EC サイト再構築（バックエンド）',
    publicSummary:
      'EC サイトのバックエンドを Java / Spring Boot で再構築します。要件定義から結合テストまで一貫して参画いただきます。リモート併用可。',
    status: 'OPEN',
  },
  publishedAll: {
    name: '金融系 Web 基盤の保守運用',
    publicSummary:
      '既存の Web 基盤の保守運用と機能改善。Java での開発経験 3 年以上が必須です。長期の稼働を想定しています。',
    status: 'OPEN',
  },
  publishedOne: {
    name: '業務システムのクラウド移行',
    publicSummary: 'オンプレミスの業務システムを AWS へ移行する案件です。移行設計と構築を担当いただきます。',
    status: 'OPEN',
  },
  unpublishedCandidates: {
    name: 'データ分析基盤の構築',
    publicSummary: 'Python でのデータ処理パイプラインと PostgreSQL による分析基盤の構築。',
    status: 'OPEN',
  },
  filled: {
    name: '社内ポータル刷新',
    publicSummary: 'TypeScript / React による社内ポータルのフロントエンド刷新（充足済み）。',
    status: 'FILLED',
  },
  unpublishedReady: {
    name: 'モバイルアプリの新規開発（API 側）',
    publicSummary:
      'モバイルアプリ向けの API を TypeScript / Next.js で新規開発します。設計から参画できる方を募集しています。',
    status: 'OPEN',
  },
};

/** PROJECT_PUBLISH のゲート結果の材料（実物の `readProjectPublishGateHashInput` と同じ並び・同じ値）。 */
function publishContentHash(input: {
  readonly name: string;
  readonly requirementTexts: readonly string[];
  readonly publicSummary: string | null;
  readonly endClientName: string | null;
  readonly internalUnitPrice: number | null;
  readonly audiencePartnerCompanyIds: readonly string[];
  readonly partnerCompanies: readonly { readonly partnerCompanyId: string; readonly name: string }[];
}): string {
  return gateContentHash({
    targetType: 'PROJECT_PUBLISH',
    name: input.name,
    requirementTexts: input.requirementTexts,
    publicSummary: input.publicSummary,
    endClientName: input.endClientName,
    internalUnitPrice: input.internalUnitPrice === null ? null : input.internalUnitPrice.toFixed(2),
    audiencePartnerCompanyIds: input.audiencePartnerCompanyIds,
    partnerCompanies: input.partnerCompanies,
  });
}

/**
 * 全層 PASS の `review_gates` 行の共通部分（`demo` のモック AI の既定応答 = 全層 PASS。Issue #44）。
 * 🔴 `role` / `promptVersion` / `modelId` / `aiUsageId` は `null` のまま —— seed は LLM を呼んでいないので
 *    「その版で検査した」という記録を捏造しない（`BR-13`。`isolation` と同じ整理）。
 */
const PASS_GATE = {
  execution: 'DONE',
  piiVerdict: 'PASS',
  commerceVerdict: 'PASS',
  consistencyVerdict: 'PASS',
  findings: [] as Prisma.InputJsonValue,
  aiWarnings: [] as Prisma.InputJsonValue,
  aiFailed: false,
};

async function seedTenant(ctx: SeedContext, tenantIndex: number, profile: TenantProfile): Promise<void> {
  const { db, rng, now } = ctx;
  const ids = DEMO_SEED_IDS.tenants[tenantIndex - 1];
  if (!ids) throw new Error(`demo: tenantIndex=${tenantIndex} の ID がありません。`);
  // 🔴 ID の束は `TENANT_PROFILES` から組み立ててある。規模がずれていたら投入前に止める（片方だけ直した事故の検知）。
  if (ids.partners.length !== profile.partnerCount || ids.hostEngineerIds.length !== profile.hostEngineerCount) {
    throw new Error(`demo: tenantIndex=${tenantIndex} の規模（取引先 ${profile.partnerCount} / ホスト ${profile.hostEngineerCount}）と ID の束が一致しません。`);
  }
  const names = demoSeedCompanyNames(tenantIndex);
  const emails = demoSeedEmails(tenantIndex);
  const personNames = shuffledPersonNames(rng);
  let personCursor = 0;
  const nextPersonName = (): string => {
    const name = personNames[personCursor % personNames.length] as string;
    personCursor += 1;
    return name;
  };
  const audit = new AuditWriter(db, tenantIndex, ids.tenantId);
  const partnerCount = ids.partners.length;
  /** 提案・依頼を担当するパートナー（A / B / C / D）。取引先が 1 社なら全部同じ会社になる。 */
  const partnerAt = (offset: number): DemoPartnerIds => ids.partners[offset % partnerCount] as DemoPartnerIds;
  const [partnerA, partnerB, partnerC, partnerD] = [partnerAt(0), partnerAt(1), partnerAt(2), partnerAt(3)];
  const [salesUserId, sales2UserId] = ids.hostSalesUserIds;

  // --- テナント本体（🔴 `demo` 環境のテナントは `ACTIVE` として扱う。docs/02 章 5.4 注記）------
  await db.tenant.create({
    data: {
      id: ids.tenantId,
      name: names.host,
      environment: 'demo',
      lifecycleState: 'ACTIVE',
      // 🔴 「実行日 = T」を残す唯一の列。`A-012` の「前回 T」はここを読む。
      lifecycleChangedAt: now,
      provisioningRequestId: demoSeedProvisioningRequestId(tenantIndex),
      autoApproveEnabled: false,
    },
  });

  // --- 送信ドメイン（🔴 Issue #57 の暫定対応。ファイル冒頭）----------------------------------
  const domain = DEMO_SEED_DOMAINS[tenantIndex - 1] ?? 'demo.example';
  await db.tenantSendingDomain.create({
    data: {
      id: ids.sendingDomainId,
      tenantId: ids.tenantId,
      domain,
      state: 'VERIFIED',
      mailFromDomain: `mail.${domain}`,
      verifiedAt: addDays(now, -100),
      lastCheckedAt: addDays(now, -1),
      dkimTokens: ['seed-demo-dkim-1', 'seed-demo-dkim-2', 'seed-demo-dkim-3'],
    },
  });

  // --- 取引先 / 利用者 / 所属 ---------------------------------------------------------------
  await db.partnerCompany.createMany({
    data: ids.partners.map((partner, index) => ({
      id: partner.partnerCompanyId,
      tenantId: ids.tenantId,
      name: names.partners[index] ?? `${DEMO_SEED_NAME_RULES.partnerCompanyPrefix}パートナー`,
      contactName: nextPersonName(),
      contactEmail: seedEmail(tenantIndex, `partner-${index + 1}-contact`),
      invitedAt: addDays(now, -150 + index * 7),
    })),
  });

  await db.user.createMany({
    data: [
      { id: ids.hostOwnerUserId, email: emails.hostOwner },
      { id: ids.hostAdminUserId, email: emails.hostAdmin },
      { id: salesUserId, email: emails.hostSales[0] },
      { id: sales2UserId, email: emails.hostSales[1] },
    ].map((user) => ({
      ...user,
      tenantId: ids.tenantId,
      ownerPartnerCompanyId: null,
      displayName: nextPersonName(),
      passwordHash: DEMO_SEED_PASSWORD_HASH,
    })),
  });
  await db.user.createMany({
    data: ids.partners.flatMap((partner, index) => [
      {
        id: partner.adminUserId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: partner.partnerCompanyId,
        email: emails.partnerAdmin(index + 1),
        displayName: nextPersonName(),
        passwordHash: DEMO_SEED_PASSWORD_HASH,
      },
      {
        id: partner.salesUserId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: partner.partnerCompanyId,
        email: emails.partnerSales(index + 1),
        displayName: nextPersonName(),
        passwordHash: DEMO_SEED_PASSWORD_HASH,
      },
    ]),
  });

  await db.membership.createMany({
    data: [
      { id: id(tenantIndex, ENTITY.MEMBERSHIP, 1), userId: ids.hostOwnerUserId, role: 'OWNER' },
      { id: id(tenantIndex, ENTITY.MEMBERSHIP, 2), userId: ids.hostAdminUserId, role: 'ADMIN' },
      { id: id(tenantIndex, ENTITY.MEMBERSHIP, 3), userId: salesUserId, role: 'SALES' },
      { id: id(tenantIndex, ENTITY.MEMBERSHIP, 4), userId: sales2UserId, role: 'SALES' },
    ].map((row) => ({
      ...row,
      tenantId: ids.tenantId,
      partnerCompanyId: null,
      joinedAt: addDays(now, -180),
    })),
  });
  await db.membership.createMany({
    data: ids.partners.flatMap((partner, index) => [
      {
        id: partner.adminMembershipId,
        tenantId: ids.tenantId,
        userId: partner.adminUserId,
        role: 'PARTNER_ADMIN',
        partnerCompanyId: partner.partnerCompanyId,
        joinedAt: addDays(now, -140 + index * 7),
      },
      {
        id: partner.salesMembershipId,
        tenantId: ids.tenantId,
        userId: partner.salesUserId,
        role: 'PARTNER_SALES',
        partnerCompanyId: partner.partnerCompanyId,
        joinedAt: addDays(now, -140 + index * 7),
      },
    ]),
  });

  // --- エンジニア（ホスト所属 + 各取引先 4 名）-----------------------------------------------
  const engineers: EngineerSeed[] = [];
  const buildEngineer = (
    engineerId: string,
    seq: number,
    owner: { readonly partnerCompanyId: string; readonly name: string } | null,
    required: readonly { readonly name: string; readonly years: number }[],
    careerCount: number,
  ): EngineerSeed => {
    const availability = rng.pick(['WORKING', 'STANDBY_SCHEDULED', 'STANDBY'] as const);
    const min = rng.int(55, 85) * 10_000;
    return {
      engineerId,
      seq,
      ownerPartnerCompanyId: owner?.partnerCompanyId ?? null,
      displayName: nextPersonName(),
      affiliationLabel: owner?.name ?? null,
      availability,
      availableFrom: dateOnly(addDays(now, availability === 'STANDBY' ? 0 : rng.int(14, 90))),
      unitPriceMin: min,
      unitPriceMax: min + rng.int(5, 15) * 10_000,
      prefecture: rng.pick(PREFECTURES),
      remoteMode: rng.pick(REMOTE_MODES),
      skills: pickSkills(rng, required),
      careers: buildCareers(rng, now, careerCount, addDays(now, -170)),
    };
  };

  // ホスト所属。h1 は PJ2 に提案済み（`SUBMITTED`）で、凍結後に経歴が 1 行増えている組（docs/05 §13.6）。
  ids.hostEngineerIds.forEach((engineerId, index) => {
    const seq = index + 1;
    const required = seq === 1 ? [PROJECT_MUST.publishedAll] : [];
    // 🔴 経歴 0 行のエンジニアを必ず混在させる（`F-008 AC-5`。3 番目は常に 0 行）。
    const careerCount = seq === 1 ? 2 : seq === 3 ? 0 : rng.int(0, 3);
    engineers.push(buildEngineer(engineerId, seq, null, required, careerCount));
  });
  ids.partners.forEach((partner, partnerIndex) => {
    const owner = { partnerCompanyId: partner.partnerCompanyId, name: names.partners[partnerIndex] ?? '' };
    partner.engineerIds.forEach((engineerId, n) => {
      const seq = partnerSeq(partnerIndex + 1, n + 1);
      // e1: WON（PJ5。TypeScript）/ REQUESTED（PJ3。AWS）。e2: APPROVAL_PENDING（PJ2。Java）/ LOST（PJ5。TypeScript）。
      // e3: DRAFT（PJ1）/ APPROVED（PJ2。Java）。e4: GATE_FAILED（PJ1。Java）/ INTERVIEW_SCHEDULED（PJ2。Java）。
      const required =
        n === 0
          ? [PROJECT_MUST.filled, PROJECT_MUST.publishedOne, PROJECT_MUST.unpublishedCandidates]
          : n === 1
            ? [PROJECT_MUST.publishedAll, PROJECT_MUST.filled, PROJECT_MUST.unpublishedCandidates]
            : [PROJECT_MUST.publishedAll, PROJECT_MUST.published3];
      // e2 は経歴 0 行（`F-008 AC-5` の母集団を取引先側にも置く）。
      const careerCount = n === 0 ? 2 : n === 1 ? 0 : n === 2 ? 1 : 3;
      engineers.push(buildEngineer(engineerId, seq, owner, required, careerCount));
    });
  });

  await db.engineer.createMany({
    data: engineers.map((engineer) => ({
      id: engineer.engineerId,
      tenantId: ids.tenantId,
      ownerPartnerCompanyId: engineer.ownerPartnerCompanyId,
      displayName: engineer.displayName,
      affiliationLabel: engineer.affiliationLabel,
      contactEmail: seedEmail(tenantIndex, `engineer-${engineer.seq}`),
      availability: engineer.availability,
      availableFrom: engineer.availableFrom,
      unitPriceMin: engineer.unitPriceMin,
      unitPriceMax: engineer.unitPriceMax,
      prefecture: engineer.prefecture,
      remoteMode: engineer.remoteMode,
      createdAt: addDays(now, -170),
      updatedAt: addDays(now, -(engineer.seq % 40) - 1),
    })),
  });

  await db.engineerSkill.createMany({
    data: engineers.flatMap((engineer) =>
      engineer.skills.map((skill, index) => {
        const skillId = GLOBAL_SKILL_IDS[skill.name];
        if (skillId === undefined) throw new Error(`demo: 辞書に無いスキル名です: ${skill.name}`);
        return {
          id: id(tenantIndex, ENTITY.ENGINEER_SKILL, engineer.seq * 0x10 + index + 1),
          tenantId: ids.tenantId,
          engineerId: engineer.engineerId,
          skillId,
          yearsOfExperience: skill.years,
          level: skill.level,
          source: 'MANUAL' as const,
        };
      }),
    ),
  });

  // 🔴 `owner_partner_company_id` は渡さない（継承トリガが親の値で上書きする）。
  await db.engineerCareer.createMany({
    data: engineers.flatMap((engineer) =>
      engineer.careers.map((career, index) => ({
        id: id(tenantIndex, ENTITY.CAREER, engineer.seq * 0x10 + index + 1),
        tenantId: ids.tenantId,
        engineerId: engineer.engineerId,
        periodFrom: career.periodFrom,
        periodTo: career.periodTo,
        role: career.role,
        description: career.description,
        technologies: career.technologies,
        source: 'MANUAL' as const,
        // h1 の 1 行目（継続中の直近の経歴）は凍結（T-6）の後に台帳へ足された行（T-2）。
        createdAt:
          engineer.seq === 1 && engineer.ownerPartnerCompanyId === null && index === 0
            ? addDays(now, -2)
            : career.createdAt,
      })),
    ),
  });

  const engineerBy = new Map(engineers.map((engineer) => [engineer.engineerId, engineer]));
  const engineerOf = (engineerId: string): EngineerSeed => {
    const found = engineerBy.get(engineerId);
    if (found === undefined) throw new Error(`demo: エンジニア ${engineerId} がありません。`);
    return found;
  };

  // --- 匿名共有（🔴 越境経路 4。明示的な opt-in。各取引先の e1 / e2）--------------------------
  await db.engineerShare.createMany({
    data: ids.partners.flatMap((partner, partnerIndex) =>
      partner.shareIds.map((shareId, n) => ({
        id: shareId,
        tenantId: ids.tenantId,
        engineerId: partner.engineerIds[n] as string,
        partnerCompanyId: partner.partnerCompanyId,
        sharedAt: addDays(now, -60 + partnerIndex),
        sharedBy: partner.salesUserId,
      })),
    ),
  });
  for (const [partnerIndex, partner] of ids.partners.entries()) {
    for (const [n, shareId] of partner.shareIds.entries()) {
      await audit.write({
        action: 'engineer_share.create',
        actorKind: 'USER',
        actorId: partner.salesUserId,
        targetType: 'EngineerShare',
        targetId: shareId,
        summary: { engineerId: partner.engineerIds[n] as string, shared: true },
        createdAt: addDays(now, -60 + partnerIndex),
      });
    }
  }

  // --- 案件 6 件 ----------------------------------------------------------------------------
  const projectKeys = Object.keys(PROJECT_TEXTS) as (keyof DemoProjectIds)[];
  const projectEndClient = new Map<keyof DemoProjectIds, string>();
  const projectInternalPrice = new Map<keyof DemoProjectIds, number>();
  await db.project.createMany({
    data: projectKeys.map((key, index) => {
      const client = endClientName(index);
      const internalUnitPrice = (rng.int(80, 110) * 10_000);
      projectEndClient.set(key, client);
      projectInternalPrice.set(key, internalUnitPrice);
      return {
        id: ids.projects[key],
        tenantId: ids.tenantId,
        name: PROJECT_TEXTS[key].name,
        // 🔴 公開範囲の外に出さない項目（`F-013 AC-2`）。ゲートの商流層の既知値でもある。
        endClientName: client,
        internalUnitPrice,
        publicSummary: PROJECT_TEXTS[key].publicSummary,
        unitPriceMin: internalUnitPrice - 250_000,
        unitPriceMax: internalUnitPrice - 150_000,
        status: PROJECT_TEXTS[key].status,
        startDate: dateOnly(addDays(now, key === 'filled' ? -35 : rng.int(20, 60))),
        prefecture: rng.pick(PREFECTURES),
        remoteMode: rng.pick(REMOTE_MODES),
        headcount: key === 'publishedAll' ? 2 : 1,
        createdAt: addDays(now, -120 + index * 10),
        updatedAt: addDays(now, -(index * 3) - 1),
      };
    }),
  });

  const requirementRows = projectKeys.flatMap((key, index) => {
    const must = PROJECT_MUST[key];
    const nice = PROJECT_NICE[key];
    return [
      {
        id: id(tenantIndex, ENTITY.REQUIREMENT, index * 2 + 1),
        tenantId: ids.tenantId,
        projectId: ids.projects[key],
        kind: 'MUST',
        skillId: GLOBAL_SKILL_IDS[must.name] as string,
        freeText: `${must.name} での開発経験 ${must.years} 年以上`,
        requiredYears: must.years,
      },
      {
        id: id(tenantIndex, ENTITY.REQUIREMENT, index * 2 + 2),
        tenantId: ids.tenantId,
        projectId: ids.projects[key],
        kind: 'NICE',
        skillId: GLOBAL_SKILL_IDS[nice] as string,
        freeText: `${nice} の経験があれば歓迎`,
        requiredYears: null,
      },
    ];
  });
  await db.projectRequirement.createMany({ data: requirementRows });

  // --- 案件の公開（🔴 越境経路 1。ゲート PASS の行 → 公開範囲。実物と同じハッシュを持つ）------
  const partnerCompanies = ids.partners.map((partner, index) => ({
    partnerCompanyId: partner.partnerCompanyId,
    name: names.partners[index] ?? '',
  }));
  const publishes: readonly { readonly key: keyof DemoProjectIds; readonly to: readonly DemoPartnerIds[]; readonly daysAgo: number }[] = [
    { key: 'published3', to: ids.partners.slice(0, 3), daysAgo: 20 },
    { key: 'publishedAll', to: ids.partners, daysAgo: 45 },
    { key: 'publishedOne', to: [partnerB], daysAgo: 10 },
    { key: 'filled', to: ids.partners, daysAgo: 90 },
  ];
  let gateSeq = 0;
  let visibilitySeq = 0;
  for (const publish of publishes) {
    // 同じ会社が 2 回入らないように畳む（取引先 1 社の beta では A〜D が同じ会社になる）。
    const audienceIds = [...new Set(publish.to.map((partner) => partner.partnerCompanyId))];
    const contentHash = publishContentHash({
      name: PROJECT_TEXTS[publish.key].name,
      requirementTexts: requirementRows
        .filter((row) => row.projectId === ids.projects[publish.key])
        .sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind < b.kind ? -1 : 1))
        .map((row) => row.freeText),
      publicSummary: PROJECT_TEXTS[publish.key].publicSummary,
      endClientName: projectEndClient.get(publish.key) ?? null,
      internalUnitPrice: projectInternalPrice.get(publish.key) ?? null,
      audiencePartnerCompanyIds: audienceIds,
      partnerCompanies,
    });
    gateSeq += 1;
    const gateId = id(tenantIndex, ENTITY.GATE, gateSeq);
    const publishedAt = addDays(now, -publish.daysAgo);
    await db.reviewGate.create({
      data: {
        id: gateId,
        tenantId: ids.tenantId,
        targetType: 'PROJECT_PUBLISH',
        targetId: ids.projects[publish.key],
        contentHash,
        // 🔴 T-12-10: 公開の実行（§3.6 の CHECK が PROJECT_PUBLISH に契機を要求する）。
        runTrigger: 'PUBLISH',
        ...PASS_GATE,
        executedAt: publishedAt,
      },
    });
    for (const partnerCompanyId of audienceIds) {
      visibilitySeq += 1;
      await db.projectVisibility.create({
        data: {
          id: id(tenantIndex, ENTITY.VISIBILITY, visibilitySeq),
          tenantId: ids.tenantId,
          projectId: ids.projects[publish.key],
          partnerCompanyId,
          publishedAt,
          publishedBy: salesUserId,
          reviewGateId: gateId,
        },
      });
    }
    await audit.write({
      action: 'project.visibility_change',
      actorKind: 'SYSTEM',
      targetType: 'Project',
      targetId: ids.projects[publish.key],
      summary: { operation: 'GATE_RESULT', overall: 'PASS', publishedCount: audienceIds.length },
      createdAt: publishedAt,
    });
  }

  // --- 匿名候補（PJ4 の候補一覧。共有中の e1 / e2 が案件全体の候補として並ぶ。C2）--------------
  const sharedEngineerIds = ids.partners.flatMap((partner) => partner.engineerIds.slice(0, 2));
  await db.matchCandidate.createMany({
    data: sharedEngineerIds.map((engineerId, index) => ({
      id: id(tenantIndex, ENTITY.MATCH, index + 1),
      tenantId: ids.tenantId,
      projectId: ids.projects.unpublishedCandidates,
      engineerId,
      isAnonymous: true,
      computedAt: addDays(now, -1),
    })),
  });

  // --- 提案依頼（🔴 経路 4 → 経路 2 への合流点。REQUESTED / ACCEPTED / DECLINED）------------------
  const requestedEngineer = partnerB.engineerIds[0] as string;
  const acceptedEngineer = partnerA.engineerIds[1] as string;
  const declinedEngineer = partnerC.engineerIds[0] as string;
  await db.proposalRequest.createMany({
    data: [
      {
        id: ids.proposalRequests.requested,
        projectId: ids.projects.publishedOne,
        engineerId: requestedEngineer,
        partnerCompanyId: partnerB.partnerCompanyId,
        message: 'クラウド移行の案件です。AWS の経験をお持ちの方をご提案いただけますか。',
        expiresAt: addDays(now, 7),
        createdAt: addDays(now, -2),
      },
      {
        id: ids.proposalRequests.accepted,
        projectId: ids.projects.publishedAll,
        engineerId: acceptedEngineer,
        partnerCompanyId: partnerA.partnerCompanyId,
        message: 'Java での保守運用の案件です。長期での参画をご検討いただけますか。',
        expiresAt: addDays(now, -8),
        createdAt: addDays(now, -15),
      },
      {
        id: ids.proposalRequests.declined,
        projectId: ids.projects.published3,
        engineerId: declinedEngineer,
        partnerCompanyId: partnerC.partnerCompanyId,
        message: 'EC サイト再構築の案件です。ご提案をご検討いただけますか。',
        expiresAt: addDays(now, -5),
        createdAt: addDays(now, -12),
      },
    ].map((row) => ({ ...row, tenantId: ids.tenantId, issuedBy: salesUserId })),
  });
  for (const [requestId, createdAt] of [
    [ids.proposalRequests.requested, addDays(now, -2)],
    [ids.proposalRequests.accepted, addDays(now, -15)],
    [ids.proposalRequests.declined, addDays(now, -12)],
  ] as const) {
    await audit.write({
      action: 'proposal_request.create',
      actorKind: 'USER',
      actorId: salesUserId,
      targetType: 'ProposalRequest',
      targetId: requestId,
      summary: { projectId: ids.projects.publishedAll },
      createdAt,
    });
  }
  await advanceProposalRequest(db, ids.proposalRequests.accepted, {
    to: 'ACCEPTED',
    data: { respondedBy: partnerA.salesUserId, respondedAt: addDays(now, -13) },
  });
  // 🔴 辞退理由（取引先社内限定。`BR-57`）は seed では書かない —— 触れてよいソースは取引先向けの 5 ファイルに固定されている
  //    （`tests/static/proposal-request-outcome-separation.test.ts`）。理由なしの辞退は `S-018` で「記録なし」と出る正常な状態。
  await advanceProposalRequest(db, ids.proposalRequests.declined, {
    to: 'DECLINED',
    data: { respondedBy: partnerC.salesUserId, respondedAt: addDays(now, -11) },
  });

  // --- 提案（🔴 経路 2。すべて `DRAFT` で作り、`transition()` で進める）------------------------------
  type ProposalPlan = {
    readonly key: keyof DemoProposalIds;
    readonly seq: number;
    readonly projectKey: keyof DemoProjectIds;
    readonly engineerId: string;
    readonly owner: DemoPartnerIds | null;
    readonly createdAt: Date;
    readonly proposalRequestId?: string;
    /** 本文にエンジニアの氏名を含める（= 機械的照合が PII 層で FAIL にする）。 */
    readonly leakName?: boolean;
  };
  const plans: readonly ProposalPlan[] = [
    { key: 'draft', seq: 1, projectKey: 'published3', engineerId: partnerA.engineerIds[2] as string, owner: partnerA, createdAt: addDays(now, -1) },
    { key: 'gateFailed', seq: 2, projectKey: 'published3', engineerId: partnerB.engineerIds[3] as string, owner: partnerB, createdAt: addDays(now, -4), leakName: true },
    { key: 'approvalPending', seq: 3, projectKey: 'publishedAll', engineerId: acceptedEngineer, owner: partnerA, createdAt: addDays(now, -13), proposalRequestId: ids.proposalRequests.accepted },
    { key: 'approved', seq: 4, projectKey: 'publishedAll', engineerId: partnerC.engineerIds[2] as string, owner: partnerC, createdAt: addDays(now, -3) },
    { key: 'submitted', seq: 5, projectKey: 'publishedAll', engineerId: ids.hostEngineerIds[0] as string, owner: null, createdAt: addDays(now, -6) },
    { key: 'interviewScheduled', seq: 6, projectKey: 'publishedAll', engineerId: partnerD.engineerIds[3] as string, owner: partnerD, createdAt: addDays(now, -9) },
    { key: 'won', seq: 7, projectKey: 'filled', engineerId: partnerA.engineerIds[0] as string, owner: partnerA, createdAt: addDays(now, -75) },
    { key: 'lost', seq: 8, projectKey: 'filled', engineerId: partnerB.engineerIds[1] as string, owner: partnerB, createdAt: addDays(now, -72) },
  ];

  for (const plan of plans) {
    const engineer = engineerOf(plan.engineerId);
    const must = PROJECT_MUST[plan.projectKey];
    const proposalId = ids.proposals[plan.key];
    const createdBy = plan.owner?.salesUserId ?? salesUserId;
    const body = plan.leakName
      ? `${engineer.displayName} をご提案します。${must.name} での開発経験が ${must.years} 年以上あり、即戦力として参画できます。`
      : `ご提案のエンジニアは ${must.name} での開発経験が ${must.years} 年以上あり、${PROJECT_TEXTS[plan.projectKey].name}の要件を満たします。稼働開始時期・単価はご相談可能です。`;
    await db.proposal.create({
      data: {
        id: proposalId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: plan.owner?.partnerCompanyId ?? null,
        projectId: ids.projects[plan.projectKey],
        engineerId: plan.engineerId,
        proposalRequestId: plan.proposalRequestId ?? null,
        recipientCompanyName: projectEndClient.get(plan.projectKey) ?? endClientName(0),
        recipientEmail: `${plan.projectKey.toLowerCase()}-${plan.seq}@${RECIPIENT_MAIL_DOMAIN}`,
        offeredUnitPrice: engineer.unitPriceMax,
        offeredStartDate: engineer.availableFrom,
        workStyle: engineer.remoteMode === 'ONSITE_ONLY' ? '常駐' : 'リモート併用',
        subject: `【ご提案】${PROJECT_TEXTS[plan.projectKey].name}`,
        body,
        createdBy,
        createdAt: plan.createdAt,
        updatedAt: plan.createdAt,
      },
    });
    // 🔴 凍結は値の複製（docs/05 §3.6）。h1（`submitted`）は凍結時点の経歴 = 台帳の 2 行目以降だけ
    //    （1 行目は凍結後に足された。docs/05 §13.6「凍結と現在値がずれている組」）。
    const frozenCareers = (plan.key === 'submitted' ? engineer.careers.slice(1) : engineer.careers).map((career) => ({
      periodFrom: career.periodFrom,
      periodTo: career.periodTo,
      role: career.role,
      description: career.description,
      technologies: career.technologies,
    }));
    await db.engineerSnapshot.create({
      data: {
        id: id(tenantIndex, ENTITY.SNAPSHOT, plan.seq),
        tenantId: ids.tenantId,
        proposalId,
        displayName: engineer.displayName,
        affiliationLabel: engineer.affiliationLabel,
        skills: engineer.skills
          .map((skill) => ({ skillId: GLOBAL_SKILL_IDS[skill.name] as string, name: skill.name, years: skill.years, level: skill.level }))
          .sort((a, b) => (a.skillId < b.skillId ? -1 : 1)),
        careers: frozenCareers,
        unitPriceMin: engineer.unitPriceMin,
        unitPriceMax: engineer.unitPriceMax,
        availableFrom: engineer.availableFrom,
        prefecture: engineer.prefecture,
        remoteMode: engineer.remoteMode,
        skillSheetId: null,
        frozenAt: plan.createdAt,
      },
    });
    await db.proposalEvent.create({
      data: {
        id: id(tenantIndex, ENTITY.PROPOSAL_EVENT, plan.seq * 0x10),
        tenantId: ids.tenantId,
        proposalId,
        kind: 'STATE',
        fromState: null,
        toState: 'DRAFT',
        actorUserId: createdBy,
        occurredAt: plan.createdAt,
      },
    });
    await audit.write({
      action: 'proposal.create',
      actorKind: 'USER',
      actorId: createdBy,
      targetType: PROPOSAL_AUDIT_TARGET_TYPE,
      targetId: proposalId,
      summary: { projectId: ids.projects[plan.projectKey], proposalRequestId: plan.proposalRequestId ?? null },
      createdAt: plan.createdAt,
    });
  }

  // 🔴 ゲート結果は「現在の内容のハッシュ」に対して残す（承認 CAS / 送信 CAS の三つ巴。docs/05 §11.5）。
  //    ハッシュの出所は `packages/db` の 1 実装（#37 / #39 / 承認 CAS と同じ関数）。
  const gateFor = async (
    plan: ProposalPlan,
    executedAt: Date,
    verdicts: { readonly pii: 'PASS' | 'FAIL'; readonly findings: readonly GateFinding[] },
  ): Promise<{ readonly gateId: string; readonly contentHash: string }> => {
    // 🔴 実物（#37 / #39 / 承認 CAS）と同じ関数で「現在の内容のハッシュ」を取る。読む行は ID で一意（特権接続でも他テナントに触れない）。
    //    引数の型は Prisma 拡張済みクライアントのデリゲートなので、空の拡張で型を揃える（クエリの中身は変わらない）。
    const contentHash = await computeProposalContentHash(db.$extends({}), ids.proposals[plan.key]);
    if (contentHash === null) throw new Error(`demo: 提案 ${plan.key} の内容を読めません。`);
    gateSeq += 1;
    const gateId = id(tenantIndex, ENTITY.GATE, gateSeq);
    await db.reviewGate.create({
      data: {
        id: gateId,
        tenantId: ids.tenantId,
        targetType: 'PROPOSAL',
        targetId: ids.proposals[plan.key],
        contentHash,
        ...PASS_GATE,
        piiVerdict: verdicts.pii,
        findings: verdicts.findings as unknown as Prisma.InputJsonValue,
        executedAt,
      },
    });
    await audit.write({
      action: 'proposal.update',
      actorKind: 'SYSTEM',
      targetType: PROPOSAL_AUDIT_TARGET_TYPE,
      targetId: ids.proposals[plan.key],
      summary: {
        operation: 'GATE_RESULT',
        overall: verdicts.pii,
        piiVerdict: verdicts.pii,
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        aiFailed: false,
        findingCount: verdicts.findings.length,
        warningCount: 0,
      },
      createdAt: executedAt,
    });
    return { gateId, contentHash };
  };
  const planOf = (key: keyof DemoProposalIds): ProposalPlan => plans.find((plan) => plan.key === key) as ProposalPlan;

  // GATE_FAILED（T-3）: 本文の氏名を機械的照合が拾う（`prepareGateExamination` の既知値 = 凍結の `displayName`）。
  {
    const plan = planOf('gateFailed');
    const engineer = engineerOf(plan.engineerId);
    const failedAt = addDays(now, -3);
    const finding: GateFinding = {
      layer: 'PII',
      kind: 'FULL_NAME',
      field: 'body',
      offsetStart: 0,
      offsetEnd: engineer.displayName.length,
      excerpt: '[名前]',
      severity: 'BLOCK',
    };
    const { contentHash } = await gateFor(plan, failedAt, { pii: 'FAIL', findings: [finding] });
    await advanceProposal(db, tenantIndex, ids.tenantId, ids.proposals.gateFailed, plan.seq, [
      { to: 'GATE_RUNNING', at: addDays(failedAt, -0.01), actorUserId: plan.owner?.salesUserId ?? salesUserId, data: { contentHash } },
      { to: 'GATE_FAILED', at: failedAt, actorUserId: null },
    ]);
  }

  // PASS 系。ゲート → 承認待ち →（承認 → 送信 → …）を実物と同じ列の値で進める。
  const passSteps = (
    plan: ProposalPlan,
    gate: { readonly gateId: string; readonly contentHash: string },
    gateAt: Date,
  ): ProposalStep[] => [
    { to: 'GATE_RUNNING', at: addDays(gateAt, -0.01), actorUserId: plan.owner?.salesUserId ?? salesUserId, data: { contentHash: gate.contentHash } },
    { to: 'APPROVAL_PENDING', at: gateAt, actorUserId: null },
  ];
  const approveStep = (gate: { readonly gateId: string }, approvedAt: Date): ProposalStep => ({
    to: 'APPROVED',
    at: approvedAt,
    actorUserId: salesUserId,
    note: `REVIEW_GATE:${gate.gateId}`,
    // 🔴 DB の CHECK（承認記録の無い行を APPROVED にさせない。docs/05 §10.3 / §11.5）。
    data: { approvedBy: salesUserId, approvedAt, approvedBySystem: false },
  });
  const sendSteps = (submittedAt: Date): ProposalStep[] => [
    { to: 'SUBMITTING', at: addDays(submittedAt, -0.001), actorUserId: null },
    { to: 'SUBMITTED', at: submittedAt, actorUserId: null, data: { submittedAt } },
  ];
  const recordSend = async (plan: ProposalPlan, submittedAt: Date): Promise<void> => {
    // 🔴 外部送信は必ず `SendAttempt`（冪等キー `proposal:{id}:1`）を伴う（docs/05 §10.1 / T-09-05）。
    //    `demo` の送信はモック（`MOCKED`）であり、`externalId` はモックが返す形の合成値。
    await db.sendAttempt.create({
      data: {
        id: id(tenantIndex, ENTITY.SEND_ATTEMPT, plan.seq),
        tenantId: ids.tenantId,
        entityType: 'PROPOSAL',
        entityId: ids.proposals[plan.key],
        attemptSeq: 1,
        idempotencyKey: idempotencyKey('PROPOSAL', ids.proposals[plan.key], 1),
        status: 'SUCCEEDED',
        externalId: `mock-message-${tenantIndex}-${plan.seq}`,
        startedAt: addDays(submittedAt, -0.001),
        settledAt: submittedAt,
        requestedBy: null,
      },
    });
    await audit.write({
      action: 'proposal.submit',
      actorKind: 'SYSTEM',
      targetType: PROPOSAL_AUDIT_TARGET_TYPE,
      targetId: ids.proposals[plan.key],
      summary: { operation: 'SUBMIT_SETTLE', attemptSeq: 1, result: 'SUCCEEDED', toState: 'SUBMITTED', externalCallMade: true },
      createdAt: submittedAt,
    });
  };
  const recordApproval = async (plan: ProposalPlan, gate: { readonly gateId: string; readonly contentHash: string }, approvedAt: Date) =>
    audit.write({
      action: 'proposal.approve',
      actorKind: 'USER',
      actorId: salesUserId,
      targetType: PROPOSAL_AUDIT_TARGET_TYPE,
      targetId: ids.proposals[plan.key],
      summary: { operation: 'APPROVE', reviewGateId: gate.gateId, contentHash: gate.contentHash, approvedBySystem: false },
      createdAt: approvedAt,
    });

  {
    const plan = planOf('approvalPending');
    const gateAt = addDays(now, -2);
    const gate = await gateFor(plan, gateAt, { pii: 'PASS', findings: [] });
    await advanceProposal(db, tenantIndex, ids.tenantId, ids.proposals.approvalPending, plan.seq, passSteps(plan, gate, gateAt));
  }
  {
    const plan = planOf('approved');
    const gateAt = addDays(now, -2);
    const approvedAt = addDays(now, -1);
    const gate = await gateFor(plan, gateAt, { pii: 'PASS', findings: [] });
    await advanceProposal(db, tenantIndex, ids.tenantId, ids.proposals.approved, plan.seq, [
      ...passSteps(plan, gate, gateAt),
      approveStep(gate, approvedAt),
    ]);
    await recordApproval(plan, gate, approvedAt);
  }
  {
    const plan = planOf('submitted');
    const gateAt = addDays(now, -6);
    const approvedAt = addDays(now, -5.5);
    const submittedAt = addDays(now, -5);
    const gate = await gateFor(plan, gateAt, { pii: 'PASS', findings: [] });
    await advanceProposal(db, tenantIndex, ids.tenantId, ids.proposals.submitted, plan.seq, [
      ...passSteps(plan, gate, gateAt),
      approveStep(gate, approvedAt),
      ...sendSteps(submittedAt),
    ]);
    await recordApproval(plan, gate, approvedAt);
    await recordSend(plan, submittedAt);
  }
  {
    // 🔴 `T-7` に送信した提案（docs/05 §13.6）。面談日程が決まっている。
    const plan = planOf('interviewScheduled');
    const gateAt = addDays(now, -8);
    const approvedAt = addDays(now, -7.5);
    const submittedAt = addDays(now, -7);
    const gate = await gateFor(plan, gateAt, { pii: 'PASS', findings: [] });
    await advanceProposal(db, tenantIndex, ids.tenantId, ids.proposals.interviewScheduled, plan.seq, [
      ...passSteps(plan, gate, gateAt),
      approveStep(gate, approvedAt),
      ...sendSteps(submittedAt),
      { to: 'INTERVIEW_SCHEDULED', at: addDays(now, -6), actorUserId: salesUserId },
    ]);
    await recordApproval(plan, gate, approvedAt);
    await recordSend(plan, submittedAt);
  }
  {
    const plan = planOf('won');
    const gateAt = addDays(now, -74);
    const approvedAt = addDays(now, -73);
    const submittedAt = addDays(now, -70);
    const gate = await gateFor(plan, gateAt, { pii: 'PASS', findings: [] });
    await advanceProposal(db, tenantIndex, ids.tenantId, ids.proposals.won, plan.seq, [
      ...passSteps(plan, gate, gateAt),
      approveStep(gate, approvedAt),
      ...sendSteps(submittedAt),
      { to: 'INTERVIEW_SCHEDULED', at: addDays(now, -66), actorUserId: salesUserId },
      { to: 'INTERVIEWED', at: addDays(now, -60), actorUserId: salesUserId },
      { to: 'RESULT_PENDING', at: addDays(now, -55), actorUserId: salesUserId },
      { to: 'WON', at: addDays(now, -40), actorUserId: salesUserId },
    ]);
    await recordApproval(plan, gate, approvedAt);
    await recordSend(plan, submittedAt);
  }
  {
    const plan = planOf('lost');
    const gateAt = addDays(now, -71);
    const approvedAt = addDays(now, -70);
    const submittedAt = addDays(now, -65);
    const gate = await gateFor(plan, gateAt, { pii: 'PASS', findings: [] });
    await advanceProposal(db, tenantIndex, ids.tenantId, ids.proposals.lost, plan.seq, [
      ...passSteps(plan, gate, gateAt),
      approveStep(gate, approvedAt),
      ...sendSteps(submittedAt),
      { to: 'INTERVIEW_SCHEDULED', at: addDays(now, -62), actorUserId: salesUserId },
      { to: 'INTERVIEWED', at: addDays(now, -58), actorUserId: salesUserId },
      { to: 'RESULT_PENDING', at: addDays(now, -50), actorUserId: salesUserId },
      { to: 'LOST', at: addDays(now, -45), actorUserId: salesUserId },
    ]);
    await recordApproval(plan, gate, approvedAt);
    await recordSend(plan, submittedAt);
  }

  // --- 稼働（🔴 `WON` からのみ生成。満了 `T+55` = 次の `assignment.expiry-scan` で起票される位置）------
  {
    const plan = planOf('won');
    const engineer = engineerOf(plan.engineerId);
    await db.assignment.create({
      data: {
        id: ids.assignmentId,
        tenantId: ids.tenantId,
        engineerId: plan.engineerId,
        projectId: ids.projects.filled,
        proposalId: ids.proposals.won,
        startDate: dateOnly(addDays(now, -35)),
        endDate: dateOnly(addDays(now, 55)),
        unitPrice: engineer.unitPriceMax,
        ownerUserId: salesUserId,
      },
    });
    await advanceAssignment(db, ids.assignmentId, [{ to: 'ACTIVE' }]);
  }
}

export const demoPreset: SeedPreset = {
  name: 'demo',
  rngSeed: 'ses-demo-v1',
  tenantIds: DEMO_SEED_IDS.tenants.map((tenant) => tenant.tenantId),
  async seed(ctx: SeedContext): Promise<void> {
    // 🔴 グローバルなスキル辞書（マスタ。`upsert` で冪等。docs/05 §13.6）。
    await seedGlobalSkills(ctx.db);
    for (const [index, profile] of TENANT_PROFILES.entries()) {
      await seedTenant(ctx, index + 1, profile);
    }
    // 🔴 `demo` は `PlatformUser` を作らない（運営者は実アカウントで `/admin` に入る。docs/05 §13.6
    //    「T-10-06 の実装の決着」）。ローカル開発で運営者が要るなら `isolation` プリセットの
    //    `ISOLATION_SEED_PLATFORM_USERS` を使う。
  },
};
