// packages/db/seed/presets/perf.ts
// 🔴 `seed:perf`（T-12-01。docs/sprints/SP-12-phase1-hardening.md §4 T-12-01 / docs/05 §13.6 / docs/03 §3.7.2
//    「検証方法」/ docs/02 章 7.1 / `CLAUDE.md` §7（p95 1 秒）/ §11.1 / `BR-47`）。
//
// 負荷測定（T-12-02。`F-009` の複合検索と `F-015` の案件検索の p95）の**母集団**を作る。`demo`（実演の一式）とも
// `isolation`（分離の検証）とも目的が違い、「検索が当たる分布の 1 万件」を**決定的に**作ることだけが仕事である。
// 業務フローの実演ではないので、提案・稼働は各テナント数件しか作らない。
//
// ============================================================================
// 🔴 分布（docs/03 §3.7.2「検証方法」の固定）
// ============================================================================
//   - **30 テナント**に配分し、**最大テナント 1 社にエンジニア 3,000 / 案件 3,000 / 取引先 15 社**。残り 29 テナントで
//     合計がちょうどエンジニア 1 万 / 案件 1 万になる**固定の配分表**（`PERF_SEED_PROFILES`）。🔴 **均等割にしない**
//     （均等割だと 1 テナント 333 件になり、RLS + `tenant_id` 先頭の複合索引の効きを検証できない）。
//   - **匿名共有 2,000 件は最大テナントの取引先 15 社に集中させる**（「自社スコープ + 共有スコープの 2 本のクエリ +
//     アプリ層マージ」〔§3.7.1 / T-08-05〕の最悪ケース = 検索の母集団が最も重い形）。
//   - 検索条件（スキル / 経験年数 / 単価 / 稼働可能時期 / 都道府県 / リモート可否 / フリーワード）が**当たる**分布:
//     スキルは辞書（`global-skills`）から重み付きで 3〜8 個、都道府県は首都圏・関西に寄せた重み、経験年数・単価・
//     稼働時期は固定シードの一様分布、フリーワードは `preference_note` の定型句。
//   - `engineer_careers` は 1 人 2〜4 行（T-09-12 の凍結対象。約 3 万行）。
//
// ============================================================================
// 🔴 このプリセットが守る規律（docs/05 §13.6。`demo` と同じ）
// ============================================================================
//   ① **決定的**: ID は `seedUuid`（`fe4f`。`demo` の `de00` / `isolation` の `150a` と ID 空間を分ける）、値の割り当ては
//      固定シード `ses-perf-v1` の疑似乱数。計画（`buildPerfTenantPlans`）は**純粋関数**で、同じ `now` なら同じ行になる。
//   ② **相対日**: 「実行日 = `T`」からの相対日だけ。満了 `T+55` の稼働 / `T-5` に送信した提案 / `T-1` の下書き。
//   ③ 🔴 **状態は `transition()` を通す**: 提案・稼働は初期状態で作り `advanceState`（遷移表 + CAS）で 1 手ずつ進める。
//      🔴 ただし **CAS で進めるのは少量の提案・稼働だけ**であり、1 万件の母集団は `createMany`（バッチ 1,000）で入れる
//      （1 件ずつの設計を 1 万件に適用しない。エンジニア・案件・経歴・共有は状態機械を持たない行である）。
//   ④ 🔴 **合成データのみ**（`BR-47`）: 氏名・商号は `DEMO_SEED_NAME_RULES` と同じ規則、メール・送信ドメインは
//      RFC 6761 の `.example`。スキルシートの原本（`skill_sheets`）は 1 行も作らない（検索の母集団に不要）。
//   ⑤ 🔴 **実行できる環境**は `runSeed()` の先頭の `assertSeedableAppEnv`（`packages/config`）が縛る。**CLI 専用**であり
//      API-A16（`A-012`）からは投入できない（API 側は `demo` プリセット固定）。
//   ⑥ 🔴 **規模が仕様どおり**であることを投入の最後に件数で検証し、ずれていれば例外にする（黙って少なく作らない）。
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  assignmentMachine,
  idempotencyKey,
  PREFECTURE_CODES,
  proposalMachine,
  type AssignmentState,
  type ProposalState,
} from '@ses/domain';
import { auditLogRowValues, type AuditLogEntry } from '../../src/audit.js';
import { PROPOSAL_AUDIT_TARGET_TYPE } from '../../src/proposal-draft.js';
import { computeProposalContentHash, gateContentHash } from '../../src/gate-content-hash.js';
import { addDays, advanceState, dateOnly, seedUuid, type StateStep } from '../support.js';
import type { SeedRng } from '../rng.js';
import type { SeedContext, SeedPreset } from '../types.js';
import { DEMO_SEED_NAME_RULES, DEMO_SEED_PASSWORD, DEMO_SEED_PASSWORD_HASH } from './demo.js';
import { GLOBAL_SKILL_IDS, GLOBAL_SKILLS, seedGlobalSkills } from './global-skills.js';

// ---------------------------------------------------------------------------
// 配分表（🔴 docs/03 §3.7.2。合計がちょうど 10,000 / 10,000 であることを `seed.test.ts` が固定する）
// ---------------------------------------------------------------------------

export type PerfTenantProfile = {
  /** 1..30。 */
  readonly tenantIndex: number;
  readonly engineers: number;
  readonly projects: number;
  readonly partners: number;
  /** `engineers` のうち取引先所属の人数（各取引先へ均等に割る。残りがホスト所属）。 */
  readonly partnerEngineers: number;
};

function tenantProfile(
  tenantIndex: number,
  engineers: number,
  projects: number,
  partners: number,
  partnerEngineers: number,
): PerfTenantProfile {
  return { tenantIndex, engineers, projects, partners, partnerEngineers };
}

/**
 * 🔴 30 テナントの配分表。1 位が 3,000 / 3,000 / 15 社、以下 1,500 / 1,000 / 700 / … / 65 と裾を引く。
 *    残り 29 テナントの取引先は 2〜5 社（docs/03 §3.7.2「パートナー 2〜5 社」）。
 */
export const PERF_SEED_PROFILES: readonly PerfTenantProfile[] = [
  tenantProfile(1, 3000, 3000, 15, 2250),
  tenantProfile(2, 1500, 1500, 5, 600),
  tenantProfile(3, 1000, 1000, 5, 400),
  tenantProfile(4, 700, 700, 5, 280),
  tenantProfile(5, 500, 500, 4, 200),
  tenantProfile(6, 400, 400, 4, 160),
  tenantProfile(7, 300, 300, 4, 120),
  tenantProfile(8, 250, 250, 3, 100),
  tenantProfile(9, 200, 200, 3, 80),
  tenantProfile(10, 200, 200, 3, 80),
  tenantProfile(11, 130, 130, 3, 52),
  tenantProfile(12, 130, 130, 3, 52),
  tenantProfile(13, 130, 130, 3, 52),
  tenantProfile(14, 130, 130, 3, 52),
  tenantProfile(15, 130, 130, 3, 52),
  tenantProfile(16, 130, 130, 3, 52),
  tenantProfile(17, 130, 130, 3, 52),
  tenantProfile(18, 130, 130, 3, 52),
  tenantProfile(19, 130, 130, 3, 52),
  tenantProfile(20, 130, 130, 3, 52),
  tenantProfile(21, 65, 65, 2, 26),
  tenantProfile(22, 65, 65, 2, 26),
  tenantProfile(23, 65, 65, 2, 26),
  tenantProfile(24, 65, 65, 2, 26),
  tenantProfile(25, 65, 65, 2, 26),
  tenantProfile(26, 65, 65, 2, 26),
  tenantProfile(27, 65, 65, 2, 26),
  tenantProfile(28, 65, 65, 2, 26),
  tenantProfile(29, 65, 65, 2, 26),
  tenantProfile(30, 65, 65, 2, 26),
];

/** 🔴 仕様の規模（docs/03 §3.7.2）。投入の最後に実測と突き合わせる。 */
export const PERF_SEED_TOTALS = {
  tenants: 30,
  engineers: 10_000,
  projects: 10_000,
  /** 🔴 全件を最大テナントの取引先に置く。 */
  engineerShares: 2_000,
  largestTenantIndex: 1,
  largestEngineers: 3_000,
  largestProjects: 3_000,
  largestPartners: 15,
} as const;

/** 各テナントに置く提案（`transition()` で進める少量分）。 */
export const PERF_SEED_PROPOSALS_PER_TENANT = 4;

export function perfSeedProfile(tenantIndex: number): PerfTenantProfile {
  const found = PERF_SEED_PROFILES.find((row) => row.tenantIndex === tenantIndex);
  if (found === undefined) throw new Error(`perf: tenantIndex=${tenantIndex} は配分表にありません。`);
  return found;
}

/** 取引先 `partnerIndex`（1 始まり）に割り当てる自社エンジニア数（均等割。端数は先頭の取引先から 1 名ずつ）。 */
export function perfPartnerEngineerCount(profile: PerfTenantProfile, partnerIndex: number): number {
  const base = Math.floor(profile.partnerEngineers / profile.partners);
  const remainder = profile.partnerEngineers % profile.partners;
  return base + (partnerIndex <= remainder ? 1 : 0);
}

/**
 * 🔴 取引先 `partnerIndex` が共有可（`EngineerShare`）にする人数。最大テナント以外は 0。
 *    最大テナントでは 2,000 件を 15 社へ均等に割る（133 × 15 + 端数 5 = 先頭 5 社が 134）。
 */
export function perfPartnerShareCount(profile: PerfTenantProfile, partnerIndex: number): number {
  if (profile.tenantIndex !== PERF_SEED_TOTALS.largestTenantIndex) return 0;
  const base = Math.floor(PERF_SEED_TOTALS.engineerShares / profile.partners);
  const remainder = PERF_SEED_TOTALS.engineerShares % profile.partners;
  const count = base + (partnerIndex <= remainder ? 1 : 0);
  const owned = perfPartnerEngineerCount(profile, partnerIndex);
  if (count > owned) {
    throw new Error(`perf: 取引先 ${partnerIndex} の共有 ${count} 件が所属 ${owned} 名を超えています（配分表の矛盾）。`);
  }
  return count;
}

// ---------------------------------------------------------------------------
// ID（🔴 決定的。`demo`（`de00`）/ `isolation`（`150a`）/ 辞書（`5c11`）と ID 空間を分ける）
// ---------------------------------------------------------------------------

const PRESET_CODE = 'fe4f';

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
  PROPOSAL: 0x0c,
  ASSIGNMENT: 0x12,
  CAREER: 0x17,
  ENGINEER_SKILL: 0x18,
  SNAPSHOT: 0x1a,
  PROPOSAL_EVENT: 0x1b,
  SEND_ATTEMPT: 0x1c,
  SENDING_DOMAIN: 0x1d,
  AUDIT_LOG: 0x1e,
} as const;

function id(tenantIndex: number, entityCode: number, seq: number): string {
  return seedUuid({ presetCode: PRESET_CODE, tenantIndex, entityCode, seq });
}

/** 提案のゲート行は案件公開のゲート行（連番 = 案件連番）と衝突しない範囲に置く。 */
const PROPOSAL_GATE_SEQ_BASE = 0x100000;

export type PerfPartnerIds = {
  readonly partnerIndex: number;
  readonly partnerCompanyId: string;
  readonly adminUserId: string;
  readonly salesUserId: string;
  readonly adminMembershipId: string;
  readonly salesMembershipId: string;
};

export type PerfTenantIds = {
  readonly tenantIndex: number;
  readonly tenantId: string;
  readonly hostOwnerUserId: string;
  readonly hostAdminUserId: string;
  /** `SALES` 2 名。🔴 負荷測定（T-12-02）は最大テナントの `hostSalesUserIds[0]` で行う。 */
  readonly hostSalesUserIds: readonly [string, string];
  readonly partners: readonly PerfPartnerIds[];
  readonly sendingDomainId: string;
  /** `seq` は 1 始まり（ホスト所属 → 取引先所属の順に連番）。 */
  readonly engineerId: (seq: number) => string;
  readonly projectId: (seq: number) => string;
  /** 提案 1..4（`DRAFT` / `APPROVAL_PENDING` / `SUBMITTED` / `WON`）。 */
  readonly proposalId: (seq: number) => string;
  /** `WON` の提案から生まれた稼働（満了 `T+55`。`ACTIVE`）。 */
  readonly assignmentId: string;
};

function partnerSeq(partnerIndex: number, seq: number): number {
  return partnerIndex * 0x10 + seq;
}

export function perfSeedIds(tenantIndex: number): PerfTenantIds {
  const profile = perfSeedProfile(tenantIndex);
  return {
    tenantIndex,
    tenantId: id(tenantIndex, ENTITY.TENANT, 1),
    hostOwnerUserId: id(tenantIndex, ENTITY.USER, 1),
    hostAdminUserId: id(tenantIndex, ENTITY.USER, 2),
    hostSalesUserIds: [id(tenantIndex, ENTITY.USER, 3), id(tenantIndex, ENTITY.USER, 4)],
    partners: Array.from({ length: profile.partners }, (_, n) => {
      const partnerIndex = n + 1;
      return {
        partnerIndex,
        partnerCompanyId: id(tenantIndex, ENTITY.PARTNER, partnerIndex),
        adminUserId: id(tenantIndex, ENTITY.USER, partnerSeq(partnerIndex, 1)),
        salesUserId: id(tenantIndex, ENTITY.USER, partnerSeq(partnerIndex, 2)),
        adminMembershipId: id(tenantIndex, ENTITY.MEMBERSHIP, partnerSeq(partnerIndex, 1)),
        salesMembershipId: id(tenantIndex, ENTITY.MEMBERSHIP, partnerSeq(partnerIndex, 2)),
      };
    }),
    sendingDomainId: id(tenantIndex, ENTITY.SENDING_DOMAIN, 1),
    engineerId: (seq) => id(tenantIndex, ENTITY.ENGINEER, seq),
    projectId: (seq) => id(tenantIndex, ENTITY.PROJECT, seq),
    proposalId: (seq) => id(tenantIndex, ENTITY.PROPOSAL, seq),
    assignmentId: id(tenantIndex, ENTITY.ASSIGNMENT, 1),
  };
}

/** 🔴 `reset()` の対象（30 テナント）。 */
export const PERF_SEED_TENANT_IDS: readonly string[] = PERF_SEED_PROFILES.map(
  (row) => perfSeedIds(row.tenantIndex).tenantId,
);

/** API-A16 と同じ冪等キーの置き場所（`tenants.provisioning_request_id` は UNIQUE）。 */
export function perfSeedProvisioningRequestId(tenantIndex: number): string {
  return `seed-perf-provisioning-${tenantIndex}`;
}

// ---------------------------------------------------------------------------
// 合成データの素材（🔴 実在の企業名・個人名を使わない。BR-47。規則は `demo` と共有する）
// ---------------------------------------------------------------------------

/**
 * 🔴 氏名・商号の規則。氏名は `DEMO_SEED_NAME_RULES` の姓 × 名、商号は同じ接頭辞（`株式会社サンプル` / `株式会社ダミー` /
 *    `架空`）に「性能」+ 連番を足す（30 テナント × 最大 15 社を重複なく採番するため。`demo` の商号とも重ならない）。
 */
export const PERF_SEED_NAME_RULES = {
  familyNames: DEMO_SEED_NAME_RULES.familyNames,
  givenNames: DEMO_SEED_NAME_RULES.givenNames,
  hostCompanyPrefix: '株式会社サンプル性能',
  partnerCompanyPrefix: '株式会社ダミー性能',
  endClientPrefix: DEMO_SEED_NAME_RULES.endClientPrefix,
  endClientBodies: DEMO_SEED_NAME_RULES.endClientBodies,
} as const;

/** 🔴 合成データ専用のサインインパスワード（`demo` と同じ平文・同じハッシュ。`development` / `demo` にしか投入されない）。 */
export const PERF_SEED_PASSWORD = DEMO_SEED_PASSWORD;

/** 提案先（テナント外のエンド企業）の合成メールドメイン。 */
const RECIPIENT_MAIL_DOMAIN = 'kakuu-client.example';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 🔴 実在しないことが保証された TLD（RFC 6761 の `.example`）だけを使う。 */
export function perfSeedDomain(tenantIndex: number): string {
  return `perf-${pad2(tenantIndex)}.example`;
}

function seedEmail(tenantIndex: number, local: string): string {
  return `${local}@${perfSeedDomain(tenantIndex)}`;
}

export function perfSeedCompanyNames(tenantIndex: number): {
  readonly host: string;
  readonly partners: readonly string[];
} {
  const profile = perfSeedProfile(tenantIndex);
  return {
    host: `${PERF_SEED_NAME_RULES.hostCompanyPrefix}${pad2(tenantIndex)}`,
    partners: Array.from(
      { length: profile.partners },
      (_, n) => `${PERF_SEED_NAME_RULES.partnerCompanyPrefix}${pad2(tenantIndex)}${pad2(n + 1)}`,
    ),
  };
}

export function perfSeedEmails(tenantIndex: number): {
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

function endClientName(index: number): string {
  const { endClientPrefix, endClientBodies } = PERF_SEED_NAME_RULES;
  return `${endClientPrefix}${endClientBodies[index % endClientBodies.length] ?? '商事'}株式会社`;
}

/** 姓 × 名の直積を固定シードで並べ替え、先頭から順に配る（`demo` と同じ。96 通りを循環する）。 */
function shuffledPersonNames(rng: SeedRng): string[] {
  const pool: string[] = [];
  for (const family of PERF_SEED_NAME_RULES.familyNames) {
    for (const given of PERF_SEED_NAME_RULES.givenNames) pool.push(`${family} ${given}`);
  }
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = rng.int(0, index);
    const current = pool[index] as string;
    pool[index] = pool[swap] as string;
    pool[swap] = current;
  }
  return pool;
}

// ---------------------------------------------------------------------------
// 検索が当たる分布（🔴 固定シードの重み付き抽出。値の集合は辞書・`@ses/domain` の定数から取る）
// ---------------------------------------------------------------------------

/** 辞書のカテゴリごとの重み（言語・設計工程が多く、ツールは少ない）。 */
const SKILL_CATEGORY_WEIGHT: Readonly<Record<string, number>> = {
  LANGUAGE: 3,
  FRAMEWORK: 2,
  DATABASE: 2,
  CLOUD: 2,
  INFRA: 2,
  TOOL: 1,
  PROCESS: 2,
};

/** よく検索される語を厚くする（`F-009` の代表的な条件が数百件当たるように）。 */
const SKILL_NAME_BOOST: Readonly<Record<string, number>> = {
  Java: 6,
  TypeScript: 4,
  Python: 3,
  SQL: 4,
  AWS: 5,
  React: 3,
  'Spring Boot': 2,
  PostgreSQL: 2,
  Linux: 2,
  Git: 3,
  要件定義: 2,
  基本設計: 3,
};

/** 重みの回数だけ名前を並べた抽出用の配列（`rng.pick` で重み付き抽出になる）。 */
const WEIGHTED_SKILL_NAMES: readonly string[] = GLOBAL_SKILLS.flatMap((skill) => {
  const weight = (SKILL_CATEGORY_WEIGHT[skill.category] ?? 1) + (SKILL_NAME_BOOST[skill.name] ?? 0);
  return Array.from({ length: weight }, () => skill.name);
});

/** 都道府県: 全 47 を 1 ずつ + 首都圏・関西・主要都市を厚くする。 */
const PREFECTURE_BOOST: Readonly<Record<string, number>> = {
  '13': 40,
  '14': 8,
  '11': 6,
  '12': 6,
  '27': 10,
  '23': 6,
  '28': 3,
  '40': 4,
  '01': 2,
  '04': 2,
  '26': 2,
};

const WEIGHTED_PREFECTURES: readonly string[] = PREFECTURE_CODES.flatMap((code) =>
  Array.from({ length: 1 + (PREFECTURE_BOOST[code] ?? 0) }, () => code),
);

type RemoteMode = 'FULL_REMOTE' | 'PARTIAL_REMOTE' | 'ONSITE_ONLY';

function pickRemoteMode(rng: SeedRng): RemoteMode {
  const r = rng.next();
  return r < 0.3 ? 'FULL_REMOTE' : r < 0.8 ? 'PARTIAL_REMOTE' : 'ONSITE_ONLY';
}

type Availability = 'WORKING' | 'STANDBY_SCHEDULED' | 'STANDBY';

function pickAvailability(rng: SeedRng): Availability {
  const r = rng.next();
  return r < 0.55 ? 'WORKING' : r < 0.85 ? 'STANDBY_SCHEDULED' : 'STANDBY';
}

/** フリーワード検索（`preference_note`）の母集団。🔴 個人・企業を特定しうる語を含めない。 */
const PREFERENCE_NOTES = [
  'フルリモートを希望',
  '週2日までの出社可',
  '常駐可',
  '上流工程を希望',
  '長期案件を希望',
  '短期案件も可',
  '金融系の経験を活かしたい',
  'フロントエンド開発を希望',
  'クラウド移行案件を希望',
  '夜間対応は不可',
  '複数拠点への移動可',
  '英語での業務可',
] as const;

const CAREER_ROLES = ['PG', 'SE', 'PL', 'テスター', 'インフラ担当'] as const;
/** 業務内容に書く業種（🔴 企業名ではない）。 */
const CAREER_INDUSTRIES = ['商社', '金融', '製造', '物流', '通信', '小売', '公共', '医療'] as const;
const PROJECT_TOPICS = [
  '受発注システムの刷新',
  '会員向けWebサービスの機能追加',
  '販売管理システムのクラウド移行',
  '社内ポータルの保守運用',
  'データ連携基盤の構築',
  'モバイルアプリのバックエンド開発',
  '在庫管理システムの再構築',
  '認証基盤の更改',
] as const;

// ---------------------------------------------------------------------------
// 計画（🔴 純粋。DB に触れない。`seed.test.ts` が 2 回生成して一致することを固定する）
// ---------------------------------------------------------------------------

export type PerfSkillPlan = { readonly name: string; readonly years: number; readonly level: number };

export type PerfCareerPlan = {
  readonly periodFrom: string;
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
};

export type PerfEngineerPlan = {
  readonly seq: number;
  readonly engineerId: string;
  /** 1 始まりの取引先番号。`null` = ホスト所属。 */
  readonly ownerPartnerIndex: number | null;
  readonly displayName: string;
  readonly availability: Availability;
  readonly availableFrom: Date;
  readonly unitPriceMin: number;
  readonly unitPriceMax: number;
  readonly prefecture: string;
  readonly remoteMode: RemoteMode;
  readonly preferenceNote: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly skills: readonly PerfSkillPlan[];
  readonly careers: readonly PerfCareerPlan[];
  /** 🔴 越境経路 4 の opt-in（最大テナントの取引先所属だけ）。 */
  readonly shared: boolean;
};

export type PerfRequirementPlan = {
  readonly kind: 'MUST' | 'NICE';
  readonly skillName: string;
  readonly requiredYears: number | null;
  readonly freeText: string;
};

export type PerfProjectPlan = {
  readonly seq: number;
  readonly projectId: string;
  readonly name: string;
  readonly endClientName: string;
  readonly internalUnitPrice: number;
  readonly publicSummary: string;
  readonly unitPriceMin: number;
  readonly unitPriceMax: number;
  readonly status: 'OPEN' | 'FILLED' | 'SUCCESSOR_WANTED';
  readonly startDate: Date;
  readonly prefecture: string;
  readonly remoteMode: RemoteMode;
  readonly headcount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly requirements: readonly PerfRequirementPlan[];
  /** 公開先の取引先番号（1 始まり）。空 = 未公開。 */
  readonly audience: readonly number[];
  readonly publishedAt: Date | null;
};

export type PerfTenantPlan = {
  readonly profile: PerfTenantProfile;
  readonly ids: PerfTenantIds;
  readonly personNames: readonly string[];
  readonly engineers: readonly PerfEngineerPlan[];
  readonly projects: readonly PerfProjectPlan[];
};

function yearMonth(base: Date, monthsAgo: number): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - monthsAgo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function pickSkills(rng: SeedRng, required: readonly { readonly name: string; readonly years: number }[]): PerfSkillPlan[] {
  const chosen = new Map<string, PerfSkillPlan>();
  for (const skill of required) chosen.set(skill.name, { name: skill.name, years: skill.years, level: rng.int(3, 5) });
  const target = Math.max(chosen.size, rng.int(3, 8));
  let guard = 0;
  while (chosen.size < target && guard < 64) {
    guard += 1;
    const name = rng.pick(WEIGHTED_SKILL_NAMES);
    if (chosen.has(name)) continue;
    chosen.set(name, { name, years: rng.int(1, 30) / 2, level: rng.int(1, 5) });
  }
  return [...chosen.values()];
}

/**
 * 経歴（`count` 行。直近から過去へ連続する期間）。
 * 🔴 業務内容に企業名を書かない（業種と架空の案件名だけ。ゲートの商流層で FAIL になる行を作らない）。
 */
function buildCareers(rng: SeedRng, now: Date, count: number, skills: readonly PerfSkillPlan[]): PerfCareerPlan[] {
  const rows: PerfCareerPlan[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const length = rng.int(6, 24);
    const periodTo = index === 0 ? null : yearMonth(now, cursor);
    const periodFrom = yearMonth(now, cursor + length);
    cursor += length + 1;
    const industry = rng.pick(CAREER_INDUSTRIES);
    const first = rng.pick(skills).name;
    const second = rng.pick(skills).name;
    rows.push({
      periodFrom,
      periodTo,
      role: rng.pick(CAREER_ROLES),
      description: `${industry}向け${rng.pick(PROJECT_TOPICS)}。設計から結合テストを担当（合成データ）。`,
      technologies: first === second ? first : `${first} / ${second}`,
    });
  }
  return rows;
}

/** 提案・稼働に使うホスト所属の 4 名が満たす必須要件（案件 1 / 2 の MUST と同じ）。 */
const PROPOSAL_MUST = { name: 'Java', years: 3 } as const;
const PROPOSAL_NICE = 'AWS';

function buildEngineer(
  rng: SeedRng,
  now: Date,
  tenantIndex: number,
  seq: number,
  ownerPartnerIndex: number | null,
  displayName: string,
  shared: boolean,
): PerfEngineerPlan {
  const availability = pickAvailability(rng);
  const availableFromDays =
    availability === 'WORKING' ? rng.int(30, 240) : availability === 'STANDBY_SCHEDULED' ? rng.int(7, 90) : rng.int(-14, 7);
  const min = rng.int(45, 95) * 10_000;
  const createdDaysAgo = rng.int(30, 400);
  const updatedDaysAgo = rng.int(0, createdDaysAgo);
  const required = ownerPartnerIndex === null && seq <= PERF_SEED_PROPOSALS_PER_TENANT ? [PROPOSAL_MUST] : [];
  const skills = pickSkills(rng, required);
  const noteCount = rng.int(1, 2);
  const notes = new Set<string>();
  while (notes.size < noteCount) notes.add(rng.pick(PREFERENCE_NOTES));
  return {
    seq,
    engineerId: id(tenantIndex, ENTITY.ENGINEER, seq),
    ownerPartnerIndex,
    displayName,
    availability,
    availableFrom: dateOnly(addDays(now, availableFromDays)),
    unitPriceMin: min,
    unitPriceMax: min + rng.int(5, 20) * 10_000,
    prefecture: rng.pick(WEIGHTED_PREFECTURES),
    remoteMode: pickRemoteMode(rng),
    preferenceNote: [...notes].join('。'),
    createdAt: addDays(now, -createdDaysAgo),
    updatedAt: addDays(now, -updatedDaysAgo),
    skills,
    careers: buildCareers(rng, now, rng.int(2, 4), skills),
    shared,
  };
}

function buildRequirements(rng: SeedRng, seq: number): PerfRequirementPlan[] {
  // 🔴 案件 1（充足済み。稼働の生成元）と案件 2（提案の対象）は提案するエンジニアが満たす固定の要件にする。
  if (seq <= 2) {
    return [
      { kind: 'MUST', skillName: PROPOSAL_MUST.name, requiredYears: PROPOSAL_MUST.years, freeText: `${PROPOSAL_MUST.name} での開発経験 ${PROPOSAL_MUST.years} 年以上` },
      { kind: 'NICE', skillName: PROPOSAL_NICE, requiredYears: null, freeText: `${PROPOSAL_NICE} の経験があれば歓迎` },
    ];
  }
  const rows: PerfRequirementPlan[] = [];
  const used = new Set<string>();
  const mustCount = rng.int(1, 3);
  const niceCount = rng.int(0, 2);
  let guard = 0;
  while (rows.length < mustCount + niceCount && guard < 64) {
    guard += 1;
    const skillName = rng.pick(WEIGHTED_SKILL_NAMES);
    if (used.has(skillName)) continue;
    used.add(skillName);
    if (rows.length < mustCount) {
      const years = rng.int(1, 5);
      rows.push({ kind: 'MUST', skillName, requiredYears: years, freeText: `${skillName} での開発経験 ${years} 年以上` });
    } else {
      rows.push({ kind: 'NICE', skillName, requiredYears: null, freeText: `${skillName} の経験があれば歓迎` });
    }
  }
  return rows;
}

function buildProject(rng: SeedRng, now: Date, profile: PerfTenantProfile, seq: number): PerfProjectPlan {
  const industry = rng.pick(CAREER_INDUSTRIES);
  const topic = rng.pick(PROJECT_TOPICS);
  const requirements = buildRequirements(rng, seq);
  const must = requirements.find((row) => row.kind === 'MUST') as PerfRequirementPlan;
  const internalUnitPrice = rng.int(70, 130) * 10_000;
  const statusRoll = rng.next();
  // 🔴 案件 1 = 充足済み（`WON` → 稼働）、案件 2 = 募集中（提案の対象）。それ以外は 70 / 25 / 5 の分布。
  const status: PerfProjectPlan['status'] =
    seq === 1 ? 'FILLED' : seq === 2 ? 'OPEN' : statusRoll < 0.7 ? 'OPEN' : statusRoll < 0.95 ? 'FILLED' : 'SUCCESSOR_WANTED';
  const createdDaysAgo = rng.int(10, 400);
  const updatedDaysAgo = rng.int(0, createdDaysAgo);
  const remoteMode = pickRemoteMode(rng);
  const published = seq === 2 ? true : rng.next() < 0.5;
  const audienceCount = published ? (seq === 2 ? 1 : rng.int(1, Math.min(3, profile.partners))) : 0;
  const audienceStart = published ? rng.int(0, profile.partners - 1) : 0;
  const audience = Array.from({ length: audienceCount }, (_, n) => ((audienceStart + n) % profile.partners) + 1);
  const publishedAt = published ? addDays(now, -rng.int(0, createdDaysAgo)) : null;
  return {
    seq,
    projectId: id(profile.tenantIndex, ENTITY.PROJECT, seq),
    name: `${industry}向け${topic}`,
    endClientName: endClientName(seq - 1),
    internalUnitPrice,
    publicSummary: `${must.skillName} を用いた${topic}。${industry}業界向けで、${must.skillName} の経験 ${must.requiredYears ?? 1} 年以上を想定。${
      remoteMode === 'ONSITE_ONLY' ? '常駐' : remoteMode === 'FULL_REMOTE' ? 'フルリモート' : 'リモート併用'
    }。`,
    unitPriceMin: internalUnitPrice - 250_000,
    unitPriceMax: internalUnitPrice - 150_000,
    status,
    startDate: dateOnly(addDays(now, seq === 1 ? -35 : rng.int(-60, 120))),
    prefecture: rng.pick(WEIGHTED_PREFECTURES),
    remoteMode,
    headcount: rng.int(1, 3),
    createdAt: addDays(now, -createdDaysAgo),
    updatedAt: addDays(now, -updatedDaysAgo),
    requirements,
    audience,
    publishedAt,
  };
}

/** 1 テナント分の計画。🔴 `rng` の消費順が固定なので、同じシード・同じ `now` なら同じ計画になる。 */
export function buildPerfTenantPlan(rng: SeedRng, now: Date, profile: PerfTenantProfile): PerfTenantPlan {
  const ids = perfSeedIds(profile.tenantIndex);
  const personNames = shuffledPersonNames(rng);
  let personCursor = 0;
  const nextPersonName = (): string => {
    const name = personNames[personCursor % personNames.length] as string;
    personCursor += 1;
    return name;
  };
  // 利用者（ホスト 4 名 + 取引先 2 名 × 社）の氏名を先に配る（投入順と同じ）。
  const userNames = Array.from({ length: 4 + profile.partners * 2 }, () => nextPersonName());

  const engineers: PerfEngineerPlan[] = [];
  const hostCount = profile.engineers - profile.partnerEngineers;
  let seq = 0;
  for (let n = 0; n < hostCount; n += 1) {
    seq += 1;
    engineers.push(buildEngineer(rng, now, profile.tenantIndex, seq, null, nextPersonName(), false));
  }
  for (let partnerIndex = 1; partnerIndex <= profile.partners; partnerIndex += 1) {
    const owned = perfPartnerEngineerCount(profile, partnerIndex);
    const shareCount = perfPartnerShareCount(profile, partnerIndex);
    for (let n = 0; n < owned; n += 1) {
      seq += 1;
      engineers.push(buildEngineer(rng, now, profile.tenantIndex, seq, partnerIndex, nextPersonName(), n < shareCount));
    }
  }
  if (engineers.length !== profile.engineers) {
    throw new Error(`perf: tenantIndex=${profile.tenantIndex} のエンジニア数 ${engineers.length} が配分表 ${profile.engineers} と一致しません。`);
  }

  const projects = Array.from({ length: profile.projects }, (_, n) => buildProject(rng, now, profile, n + 1));
  return { profile, ids, personNames: userNames, engineers, projects };
}

/** 30 テナント分の計画（配分表の順）。 */
export function buildPerfTenantPlans(rng: SeedRng, now: Date): PerfTenantPlan[] {
  return PERF_SEED_PROFILES.map((profile) => buildPerfTenantPlan(rng, now, profile));
}

// ---------------------------------------------------------------------------
// 投入（🔴 `createMany` のバッチ。1 バッチ 1,000 行）
// ---------------------------------------------------------------------------

const BATCH_SIZE = 1_000;

async function createManyInBatches<T>(
  label: string,
  rows: readonly T[],
  create: (batch: T[]) => Promise<{ readonly count: number }>,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const result = await create(batch);
    if (result.count !== batch.length) {
      throw new Error(`perf: ${label} のバッチ（offset=${offset}）が ${result.count} / ${batch.length} 行しか入りませんでした。`);
    }
  }
}

/** 全層 PASS の `review_gates` 行の共通部分（`demo` と同じ。seed は LLM を呼ばないので `role` 等は `null`）。 */
const PASS_GATE = {
  execution: 'DONE',
  piiVerdict: 'PASS',
  commerceVerdict: 'PASS',
  consistencyVerdict: 'PASS',
  findings: [] as Prisma.InputJsonValue,
  aiWarnings: [] as Prisma.InputJsonValue,
  aiFailed: false,
};

class AuditWriter {
  private seq = 0;

  constructor(
    private readonly db: PrismaClient,
    private readonly tenantIndex: number,
    private readonly tenantId: string,
  ) {}

  private row(entry: AuditLogEntry & { readonly createdAt: Date }) {
    this.seq += 1;
    const { createdAt, ...rest } = entry;
    return { id: id(this.tenantIndex, ENTITY.AUDIT_LOG, this.seq), tenantId: this.tenantId, ...auditLogRowValues(rest), createdAt };
  }

  async write(entry: AuditLogEntry & { readonly createdAt: Date }): Promise<void> {
    await this.db.auditLog.create({ data: this.row(entry) });
  }

  async writeMany(entries: readonly (AuditLogEntry & { readonly createdAt: Date })[]): Promise<void> {
    const rows = entries.map((entry) => this.row(entry));
    await createManyInBatches('audit_logs', rows, (batch) => this.db.auditLog.createMany({ data: batch }));
  }
}

type ProposalStep = StateStep<ProposalState, Prisma.ProposalUpdateManyMutationInput> & {
  readonly at: Date;
  /** `null` = system（ゲート / 送信ジョブ）。 */
  readonly actorUserId: string | null;
  readonly note?: string;
};

/** 🔴 提案を `DRAFT` から順に進め、1 手ごとに `proposal_events` を残す（`demo` と同じ形。飛び級をしない）。 */
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
      const result = await db.assignment.updateMany({ where: { id: rowId, state: from }, data: { ...(data ?? {}), state: to } });
      return result.count;
    },
  });
}

async function seedTenant(db: PrismaClient, now: Date, plan: PerfTenantPlan): Promise<void> {
  const { profile, ids } = plan;
  const tenantIndex = profile.tenantIndex;
  const names = perfSeedCompanyNames(tenantIndex);
  const emails = perfSeedEmails(tenantIndex);
  const audit = new AuditWriter(db, tenantIndex, ids.tenantId);
  const [salesUserId, sales2UserId] = ids.hostSalesUserIds;
  let personCursor = 0;
  const nextPersonName = (): string => {
    const name = plan.personNames[personCursor] as string;
    personCursor += 1;
    return name;
  };

  // --- テナント本体（🔴 `demo` 環境のテナントとして扱う。docs/02 章 5.4 注記）---------------------
  await db.tenant.create({
    data: {
      id: ids.tenantId,
      name: names.host,
      environment: 'demo',
      lifecycleState: 'ACTIVE',
      // 🔴 「実行日 = T」を残す唯一の列（`readSeedPresence` の `seededAt`）。
      lifecycleChangedAt: now,
      provisioningRequestId: perfSeedProvisioningRequestId(tenantIndex),
      autoApproveEnabled: false,
    },
  });

  // --- 送信ドメイン（Issue #57 の暫定対応。`demo` と同じく合成ドメインの VERIFIED 行を直接作る）----
  const domain = perfSeedDomain(tenantIndex);
  await db.tenantSendingDomain.create({
    data: {
      id: ids.sendingDomainId,
      tenantId: ids.tenantId,
      domain,
      state: 'VERIFIED',
      mailFromDomain: `mail.${domain}`,
      verifiedAt: addDays(now, -100),
      lastCheckedAt: addDays(now, -1),
      dkimTokens: ['seed-perf-dkim-1', 'seed-perf-dkim-2', 'seed-perf-dkim-3'],
    },
  });

  // --- 取引先 / 利用者 / 所属 ---------------------------------------------------------------
  const hostUserNames = [nextPersonName(), nextPersonName(), nextPersonName(), nextPersonName()] as const;
  const partnerUserNames = ids.partners.map(() => [nextPersonName(), nextPersonName()] as const);
  await db.partnerCompany.createMany({
    data: ids.partners.map((partner, index) => ({
      id: partner.partnerCompanyId,
      tenantId: ids.tenantId,
      name: names.partners[index] ?? `${PERF_SEED_NAME_RULES.partnerCompanyPrefix}${pad2(tenantIndex)}`,
      contactName: partnerUserNames[index]?.[0] ?? hostUserNames[0],
      contactEmail: seedEmail(tenantIndex, `partner-${index + 1}-contact`),
      invitedAt: addDays(now, -150 + (index % 20) * 5),
    })),
  });
  await db.user.createMany({
    data: [
      { id: ids.hostOwnerUserId, email: emails.hostOwner, displayName: hostUserNames[0] },
      { id: ids.hostAdminUserId, email: emails.hostAdmin, displayName: hostUserNames[1] },
      { id: salesUserId, email: emails.hostSales[0], displayName: hostUserNames[2] },
      { id: sales2UserId, email: emails.hostSales[1], displayName: hostUserNames[3] },
    ].map((user) => ({ ...user, tenantId: ids.tenantId, ownerPartnerCompanyId: null, passwordHash: DEMO_SEED_PASSWORD_HASH })),
  });
  await db.user.createMany({
    data: ids.partners.flatMap((partner, index) => [
      {
        id: partner.adminUserId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: partner.partnerCompanyId,
        email: emails.partnerAdmin(partner.partnerIndex),
        displayName: partnerUserNames[index]?.[0] ?? hostUserNames[0],
        passwordHash: DEMO_SEED_PASSWORD_HASH,
      },
      {
        id: partner.salesUserId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: partner.partnerCompanyId,
        email: emails.partnerSales(partner.partnerIndex),
        displayName: partnerUserNames[index]?.[1] ?? hostUserNames[0],
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
    ].map((row) => ({ ...row, tenantId: ids.tenantId, partnerCompanyId: null, joinedAt: addDays(now, -180) })),
  });
  await db.membership.createMany({
    data: ids.partners.flatMap((partner, index) => [
      {
        id: partner.adminMembershipId,
        tenantId: ids.tenantId,
        userId: partner.adminUserId,
        role: 'PARTNER_ADMIN',
        partnerCompanyId: partner.partnerCompanyId,
        joinedAt: addDays(now, -140 + (index % 20) * 5),
      },
      {
        id: partner.salesMembershipId,
        tenantId: ids.tenantId,
        userId: partner.salesUserId,
        role: 'PARTNER_SALES',
        partnerCompanyId: partner.partnerCompanyId,
        joinedAt: addDays(now, -140 + (index % 20) * 5),
      },
    ]),
  });

  // --- エンジニア（🔴 1 万件の母集団。`createMany` バッチ）--------------------------------------
  const partnerOf = (partnerIndex: number): PerfPartnerIds => ids.partners[partnerIndex - 1] as PerfPartnerIds;
  await createManyInBatches(
    'engineers',
    plan.engineers.map((engineer) => ({
      id: engineer.engineerId,
      tenantId: ids.tenantId,
      ownerPartnerCompanyId: engineer.ownerPartnerIndex === null ? null : partnerOf(engineer.ownerPartnerIndex).partnerCompanyId,
      displayName: engineer.displayName,
      affiliationLabel: engineer.ownerPartnerIndex === null ? null : (names.partners[engineer.ownerPartnerIndex - 1] ?? null),
      contactEmail: seedEmail(tenantIndex, `engineer-${engineer.seq}`),
      availability: engineer.availability,
      availableFrom: engineer.availableFrom,
      unitPriceMin: engineer.unitPriceMin,
      unitPriceMax: engineer.unitPriceMax,
      prefecture: engineer.prefecture,
      remoteMode: engineer.remoteMode,
      preferenceNote: engineer.preferenceNote,
      createdAt: engineer.createdAt,
      updatedAt: engineer.updatedAt,
    })),
    (batch) => db.engineer.createMany({ data: batch }),
  );

  await createManyInBatches(
    'engineer_skills',
    plan.engineers.flatMap((engineer) =>
      engineer.skills.map((skill, index) => {
        const skillId = GLOBAL_SKILL_IDS[skill.name];
        if (skillId === undefined) throw new Error(`perf: 辞書に無いスキル名です: ${skill.name}`);
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
    (batch) => db.engineerSkill.createMany({ data: batch }),
  );

  // 🔴 `owner_partner_company_id` は渡さない（継承トリガが親の値で上書きする）。
  await createManyInBatches(
    'engineer_careers',
    plan.engineers.flatMap((engineer) =>
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
        createdAt: engineer.createdAt,
        updatedAt: engineer.createdAt,
      })),
    ),
    (batch) => db.engineerCareer.createMany({ data: batch }),
  );

  // --- 匿名共有（🔴 越境経路 4。明示的な opt-in。最大テナントの取引先所属だけ）-------------------
  const shared = plan.engineers.filter((engineer) => engineer.shared);
  await createManyInBatches(
    'engineer_shares',
    shared.map((engineer) => {
      const partner = partnerOf(engineer.ownerPartnerIndex as number);
      return {
        id: id(tenantIndex, ENTITY.SHARE, engineer.seq),
        tenantId: ids.tenantId,
        engineerId: engineer.engineerId,
        partnerCompanyId: partner.partnerCompanyId,
        sharedAt: addDays(now, -60 + (engineer.seq % 30)),
        sharedBy: partner.salesUserId,
      };
    }),
    (batch) => db.engineerShare.createMany({ data: batch }),
  );
  await audit.writeMany(
    shared.map((engineer) => ({
      action: 'engineer_share.create',
      actorKind: 'USER' as const,
      actorId: partnerOf(engineer.ownerPartnerIndex as number).salesUserId,
      targetType: 'EngineerShare',
      targetId: id(tenantIndex, ENTITY.SHARE, engineer.seq),
      summary: { engineerId: engineer.engineerId, shared: true },
      createdAt: addDays(now, -60 + (engineer.seq % 30)),
    })),
  );

  // --- 案件（🔴 1 万件の母集団）-------------------------------------------------------------
  await createManyInBatches(
    'projects',
    plan.projects.map((project) => ({
      id: project.projectId,
      tenantId: ids.tenantId,
      name: project.name,
      // 🔴 公開範囲の外に出さない項目（`F-013 AC-2`）。
      endClientName: project.endClientName,
      internalUnitPrice: project.internalUnitPrice,
      publicSummary: project.publicSummary,
      unitPriceMin: project.unitPriceMin,
      unitPriceMax: project.unitPriceMax,
      status: project.status,
      startDate: project.startDate,
      prefecture: project.prefecture,
      remoteMode: project.remoteMode,
      headcount: project.headcount,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })),
    (batch) => db.project.createMany({ data: batch }),
  );

  const requirementRows = plan.projects.flatMap((project) =>
    project.requirements.map((requirement, index) => {
      const skillId = GLOBAL_SKILL_IDS[requirement.skillName];
      if (skillId === undefined) throw new Error(`perf: 辞書に無いスキル名です: ${requirement.skillName}`);
      return {
        id: id(tenantIndex, ENTITY.REQUIREMENT, project.seq * 0x10 + index + 1),
        tenantId: ids.tenantId,
        projectId: project.projectId,
        kind: requirement.kind,
        skillId,
        freeText: requirement.freeText,
        requiredYears: requirement.requiredYears,
      };
    }),
  );
  await createManyInBatches('project_requirements', requirementRows, (batch) => db.projectRequirement.createMany({ data: batch }));

  // --- 案件の公開（🔴 越境経路 1。ゲート PASS の行 → 公開範囲。実物と同じ材料のハッシュ）-----------
  const partnerCompanies = ids.partners.map((partner, index) => ({ partnerCompanyId: partner.partnerCompanyId, name: names.partners[index] ?? '' }));
  const publishedProjects = plan.projects.filter((project) => project.publishedAt !== null);
  const gateRows = publishedProjects.map((project) => ({
    id: id(tenantIndex, ENTITY.GATE, project.seq),
    tenantId: ids.tenantId,
    targetType: 'PROJECT_PUBLISH',
    targetId: project.projectId,
    contentHash: gateContentHash({
      targetType: 'PROJECT_PUBLISH',
      name: project.name,
      // `readProjectRequirementTexts` と同じ並び（`kind` 昇順 → `id` 昇順 = MUST → NICE の投入順）。
      requirementTexts: project.requirements.map((row) => row.freeText),
      publicSummary: project.publicSummary,
      endClientName: project.endClientName,
      internalUnitPrice: project.internalUnitPrice.toFixed(2),
      audiencePartnerCompanyIds: project.audience.map((partnerIndex) => partnerOf(partnerIndex).partnerCompanyId),
      partnerCompanies,
    }),
    ...PASS_GATE,
    executedAt: project.publishedAt as Date,
  }));
  await createManyInBatches('review_gates', gateRows, (batch) => db.reviewGate.createMany({ data: batch }));
  await createManyInBatches(
    'project_visibilities',
    publishedProjects.flatMap((project) =>
      project.audience.map((partnerIndex) => ({
        id: id(tenantIndex, ENTITY.VISIBILITY, project.seq * 0x10 + partnerIndex),
        tenantId: ids.tenantId,
        projectId: project.projectId,
        partnerCompanyId: partnerOf(partnerIndex).partnerCompanyId,
        publishedAt: project.publishedAt as Date,
        publishedBy: salesUserId,
        reviewGateId: id(tenantIndex, ENTITY.GATE, project.seq),
      })),
    ),
    (batch) => db.projectVisibility.createMany({ data: batch }),
  );
  await audit.writeMany(
    publishedProjects.map((project) => ({
      action: 'project.visibility_change',
      actorKind: 'SYSTEM' as const,
      targetType: 'Project',
      targetId: project.projectId,
      summary: { operation: 'GATE_RESULT', overall: 'PASS', publishedCount: project.audience.length },
      createdAt: project.publishedAt as Date,
    })),
  );

  // --- 提案（🔴 少量。経路 2。すべて `DRAFT` で作り `transition()` で進める）-------------------------
  const projectBySeq = (seq: number): PerfProjectPlan => plan.projects[seq - 1] as PerfProjectPlan;
  const engineerBySeq = (seq: number): PerfEngineerPlan => plan.engineers[seq - 1] as PerfEngineerPlan;
  type ProposalPlan = { readonly seq: number; readonly projectSeq: number; readonly engineerSeq: number; readonly createdAt: Date };
  const plans: readonly ProposalPlan[] = [
    { seq: 1, projectSeq: 2, engineerSeq: 1, createdAt: addDays(now, -1) }, // DRAFT
    { seq: 2, projectSeq: 2, engineerSeq: 2, createdAt: addDays(now, -3) }, // APPROVAL_PENDING
    { seq: 3, projectSeq: 2, engineerSeq: 3, createdAt: addDays(now, -6) }, // SUBMITTED（T-5）
    { seq: 4, projectSeq: 1, engineerSeq: 4, createdAt: addDays(now, -75) }, // WON → Assignment
  ];
  if (plans.length !== PERF_SEED_PROPOSALS_PER_TENANT) throw new Error('perf: 提案の件数が定数と一致しません。');

  for (const proposal of plans) {
    const project = projectBySeq(proposal.projectSeq);
    const engineer = engineerBySeq(proposal.engineerSeq);
    const proposalId = ids.proposalId(proposal.seq);
    await db.proposal.create({
      data: {
        id: proposalId,
        tenantId: ids.tenantId,
        ownerPartnerCompanyId: null,
        projectId: project.projectId,
        engineerId: engineer.engineerId,
        proposalRequestId: null,
        recipientCompanyName: project.endClientName,
        recipientEmail: `proposal-${proposal.seq}@${RECIPIENT_MAIL_DOMAIN}`,
        offeredUnitPrice: engineer.unitPriceMax,
        offeredStartDate: engineer.availableFrom,
        workStyle: engineer.remoteMode === 'ONSITE_ONLY' ? '常駐' : 'リモート併用',
        subject: `【ご提案】${project.name}`,
        body: `ご提案のエンジニアは ${PROPOSAL_MUST.name} での開発経験が ${PROPOSAL_MUST.years} 年以上あり、${project.name}の要件を満たします。稼働開始時期・単価はご相談可能です。`,
        createdBy: salesUserId,
        createdAt: proposal.createdAt,
        updatedAt: proposal.createdAt,
      },
    });
    // 🔴 凍結は値の複製（docs/05 §3.6）。
    await db.engineerSnapshot.create({
      data: {
        id: id(tenantIndex, ENTITY.SNAPSHOT, proposal.seq),
        tenantId: ids.tenantId,
        proposalId,
        displayName: engineer.displayName,
        affiliationLabel: null,
        skills: engineer.skills
          .map((skill) => ({ skillId: GLOBAL_SKILL_IDS[skill.name] as string, name: skill.name, years: skill.years, level: skill.level }))
          .sort((a, b) => (a.skillId < b.skillId ? -1 : 1)),
        careers: engineer.careers.map((career) => ({ ...career })),
        unitPriceMin: engineer.unitPriceMin,
        unitPriceMax: engineer.unitPriceMax,
        availableFrom: engineer.availableFrom,
        prefecture: engineer.prefecture,
        remoteMode: engineer.remoteMode,
        skillSheetId: null,
        frozenAt: proposal.createdAt,
      },
    });
    await db.proposalEvent.create({
      data: {
        id: id(tenantIndex, ENTITY.PROPOSAL_EVENT, proposal.seq * 0x10),
        tenantId: ids.tenantId,
        proposalId,
        kind: 'STATE',
        fromState: null,
        toState: 'DRAFT',
        actorUserId: salesUserId,
        occurredAt: proposal.createdAt,
      },
    });
    await audit.write({
      action: 'proposal.create',
      actorKind: 'USER',
      actorId: salesUserId,
      targetType: PROPOSAL_AUDIT_TARGET_TYPE,
      targetId: proposalId,
      summary: { projectId: project.projectId, proposalRequestId: null },
      createdAt: proposal.createdAt,
    });
  }

  // 🔴 ゲート結果は「現在の内容のハッシュ」に対して残す（承認 CAS / 送信 CAS の三つ巴。docs/05 §11.5。`demo` と同じ 1 実装）。
  const gateFor = async (proposalSeq: number, executedAt: Date): Promise<{ readonly gateId: string; readonly contentHash: string }> => {
    const proposalId = ids.proposalId(proposalSeq);
    const contentHash = await computeProposalContentHash(db.$extends({}), proposalId);
    if (contentHash === null) throw new Error(`perf: 提案 ${proposalSeq} の内容を読めません。`);
    const gateId = id(tenantIndex, ENTITY.GATE, PROPOSAL_GATE_SEQ_BASE + proposalSeq);
    await db.reviewGate.create({
      data: { id: gateId, tenantId: ids.tenantId, targetType: 'PROPOSAL', targetId: proposalId, contentHash, ...PASS_GATE, executedAt },
    });
    await audit.write({
      action: 'proposal.update',
      actorKind: 'SYSTEM',
      targetType: PROPOSAL_AUDIT_TARGET_TYPE,
      targetId: proposalId,
      summary: {
        operation: 'GATE_RESULT',
        overall: 'PASS',
        piiVerdict: 'PASS',
        commerceVerdict: 'PASS',
        consistencyVerdict: 'PASS',
        aiFailed: false,
        findingCount: 0,
        warningCount: 0,
      },
      createdAt: executedAt,
    });
    return { gateId, contentHash };
  };
  const passSteps = (gate: { readonly contentHash: string }, gateAt: Date): ProposalStep[] => [
    { to: 'GATE_RUNNING', at: addDays(gateAt, -0.01), actorUserId: salesUserId, data: { contentHash: gate.contentHash } },
    { to: 'APPROVAL_PENDING', at: gateAt, actorUserId: null },
  ];
  const approveStep = (gate: { readonly gateId: string }, approvedAt: Date): ProposalStep => ({
    to: 'APPROVED',
    at: approvedAt,
    actorUserId: sales2UserId,
    note: `REVIEW_GATE:${gate.gateId}`,
    // 🔴 DB の CHECK（承認記録の無い行を APPROVED にさせない。docs/05 §10.3 / §11.5）。
    data: { approvedBy: sales2UserId, approvedAt, approvedBySystem: false },
  });
  const sendSteps = (submittedAt: Date): ProposalStep[] => [
    { to: 'SUBMITTING', at: addDays(submittedAt, -0.001), actorUserId: null },
    { to: 'SUBMITTED', at: submittedAt, actorUserId: null, data: { submittedAt } },
  ];
  const recordApproval = async (proposalSeq: number, gate: { readonly gateId: string; readonly contentHash: string }, approvedAt: Date): Promise<void> =>
    audit.write({
      action: 'proposal.approve',
      actorKind: 'USER',
      actorId: sales2UserId,
      targetType: PROPOSAL_AUDIT_TARGET_TYPE,
      targetId: ids.proposalId(proposalSeq),
      summary: { operation: 'APPROVE', reviewGateId: gate.gateId, contentHash: gate.contentHash, approvedBySystem: false },
      createdAt: approvedAt,
    });
  const recordSend = async (proposalSeq: number, submittedAt: Date): Promise<void> => {
    // 🔴 外部送信は必ず `SendAttempt`（冪等キー `proposal:{id}:1`）を伴う（docs/05 §10.1 / T-09-05）。モック送信の合成値。
    await db.sendAttempt.create({
      data: {
        id: id(tenantIndex, ENTITY.SEND_ATTEMPT, proposalSeq),
        tenantId: ids.tenantId,
        entityType: 'PROPOSAL',
        entityId: ids.proposalId(proposalSeq),
        attemptSeq: 1,
        idempotencyKey: idempotencyKey('PROPOSAL', ids.proposalId(proposalSeq), 1),
        status: 'SUCCEEDED',
        externalId: `mock-message-perf-${tenantIndex}-${proposalSeq}`,
        startedAt: addDays(submittedAt, -0.001),
        settledAt: submittedAt,
        requestedBy: null,
      },
    });
    await audit.write({
      action: 'proposal.submit',
      actorKind: 'SYSTEM',
      targetType: PROPOSAL_AUDIT_TARGET_TYPE,
      targetId: ids.proposalId(proposalSeq),
      summary: { operation: 'SUBMIT_SETTLE', attemptSeq: 1, result: 'SUCCEEDED', toState: 'SUBMITTED', externalCallMade: true },
      createdAt: submittedAt,
    });
  };

  {
    // 提案 2: APPROVAL_PENDING（T-2 にゲート PASS）。
    const gateAt = addDays(now, -2);
    const gate = await gateFor(2, gateAt);
    await advanceProposal(db, tenantIndex, ids.tenantId, ids.proposalId(2), 2, passSteps(gate, gateAt));
  }
  {
    // 提案 3: SUBMITTED（T-5 に送信）。
    const gateAt = addDays(now, -6);
    const approvedAt = addDays(now, -5.5);
    const submittedAt = addDays(now, -5);
    const gate = await gateFor(3, gateAt);
    await advanceProposal(db, tenantIndex, ids.tenantId, ids.proposalId(3), 3, [...passSteps(gate, gateAt), approveStep(gate, approvedAt), ...sendSteps(submittedAt)]);
    await recordApproval(3, gate, approvedAt);
    await recordSend(3, submittedAt);
  }
  {
    // 提案 4: WON（T-40）→ 稼働（満了 T+55 = 次の `assignment.expiry-scan` で起票される位置）。
    const gateAt = addDays(now, -74);
    const approvedAt = addDays(now, -73);
    const submittedAt = addDays(now, -70);
    const gate = await gateFor(4, gateAt);
    await advanceProposal(db, tenantIndex, ids.tenantId, ids.proposalId(4), 4, [
      ...passSteps(gate, gateAt),
      approveStep(gate, approvedAt),
      ...sendSteps(submittedAt),
      { to: 'INTERVIEW_SCHEDULED', at: addDays(now, -66), actorUserId: salesUserId },
      { to: 'INTERVIEWED', at: addDays(now, -60), actorUserId: salesUserId },
      { to: 'RESULT_PENDING', at: addDays(now, -55), actorUserId: salesUserId },
      { to: 'WON', at: addDays(now, -40), actorUserId: salesUserId },
    ]);
    await recordApproval(4, gate, approvedAt);
    await recordSend(4, submittedAt);
    const engineer = engineerBySeq(4);
    await db.assignment.create({
      data: {
        id: ids.assignmentId,
        tenantId: ids.tenantId,
        engineerId: engineer.engineerId,
        projectId: projectBySeq(1).projectId,
        proposalId: ids.proposalId(4),
        startDate: dateOnly(addDays(now, -35)),
        endDate: dateOnly(addDays(now, 55)),
        unitPrice: engineer.unitPriceMax,
        ownerUserId: salesUserId,
      },
    });
    await advanceAssignment(db, ids.assignmentId, [{ to: 'ACTIVE' }]);
  }
}

// ---------------------------------------------------------------------------
// 規模の検証（🔴 黙って少なく作らない）
// ---------------------------------------------------------------------------

export class PerfSeedScaleError extends Error {
  constructor(readonly mismatches: readonly string[]) {
    super(`seed:perf の規模が仕様（docs/03 §3.7.2）と一致しません: ${mismatches.join(' / ')}`);
    this.name = 'PerfSeedScaleError';
  }
}

/** 投入後の実測（テナント ID で絞る）。結合テストも同じ数え方を使う。 */
export async function readPerfSeedScale(db: PrismaClient): Promise<{
  readonly tenants: number;
  readonly engineers: number;
  readonly projects: number;
  readonly engineerShares: number;
  readonly skillSheets: number;
  readonly largestEngineers: number;
  readonly largestProjects: number;
  readonly largestPartners: number;
  readonly largestShares: number;
}> {
  const all = { tenantId: { in: [...PERF_SEED_TENANT_IDS] } };
  const largestTenantId = perfSeedIds(PERF_SEED_TOTALS.largestTenantIndex).tenantId;
  const largest = { tenantId: largestTenantId };
  const [tenants, engineers, projects, engineerShares, skillSheets, largestEngineers, largestProjects, largestPartners, largestShares] =
    await Promise.all([
      db.tenant.count({ where: { id: { in: [...PERF_SEED_TENANT_IDS] } } }),
      db.engineer.count({ where: all }),
      db.project.count({ where: all }),
      db.engineerShare.count({ where: { ...all, revokedAt: null } }),
      db.skillSheet.count({ where: all }),
      db.engineer.count({ where: largest }),
      db.project.count({ where: largest }),
      db.partnerCompany.count({ where: largest }),
      db.engineerShare.count({ where: { ...largest, revokedAt: null } }),
    ]);
  return { tenants, engineers, projects, engineerShares, skillSheets, largestEngineers, largestProjects, largestPartners, largestShares };
}

async function assertPerfScale(db: PrismaClient): Promise<void> {
  const actual = await readPerfSeedScale(db);
  const expected: Record<keyof typeof actual, number> = {
    tenants: PERF_SEED_TOTALS.tenants,
    engineers: PERF_SEED_TOTALS.engineers,
    projects: PERF_SEED_TOTALS.projects,
    engineerShares: PERF_SEED_TOTALS.engineerShares,
    skillSheets: 0,
    largestEngineers: PERF_SEED_TOTALS.largestEngineers,
    largestProjects: PERF_SEED_TOTALS.largestProjects,
    largestPartners: PERF_SEED_TOTALS.largestPartners,
    largestShares: PERF_SEED_TOTALS.engineerShares,
  };
  const mismatches = (Object.keys(expected) as (keyof typeof actual)[])
    .filter((key) => actual[key] !== expected[key])
    .map((key) => `${key}: 期待 ${expected[key]} / 実測 ${actual[key]}`);
  if (mismatches.length > 0) throw new PerfSeedScaleError(mismatches);
}

export const perfPreset: SeedPreset = {
  name: 'perf',
  rngSeed: 'ses-perf-v1',
  tenantIds: PERF_SEED_TENANT_IDS,
  async seed(ctx: SeedContext): Promise<void> {
    // 🔴 グローバルなスキル辞書（マスタ。`upsert` で冪等。docs/05 §13.6）。
    await seedGlobalSkills(ctx.db);
    for (const profile of PERF_SEED_PROFILES) {
      // 計画（純粋）→ 投入。`rng` は配分表の順に消費されるので、テナントごとの計画も決定的である。
      const plan = buildPerfTenantPlan(ctx.rng, ctx.now, profile);
      await seedTenant(ctx.db, ctx.now, plan);
    }
    // 🔴 規模が仕様どおりでなければ例外（黙って少なく作らない）。
    await assertPerfScale(ctx.db);
    // 🔴 `perf` は `PlatformUser` を作らない（`demo` と同じ。運営者が要るなら `isolation` を使う）。
  },
};
