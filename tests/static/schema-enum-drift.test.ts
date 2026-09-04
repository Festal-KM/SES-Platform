// tests/static/schema-enum-drift.test.ts
// T-02-01 code-reviewer 指摘 2:
// docs/05 §3.1「列挙」規約（Prisma の `enum` を使わず `String` + CHECK にする。schema.prisma 冒頭
// コメント参照）を採ると、DB 側の CHECK 制約の値集合と TS 側の単一出所の定数配列が「人手で揃える」
// 状態になり、静かに drift しうる。本テストは
// packages/db/prisma/migrations/**/migration.sql の CHECK 制約をテキストとして読み、
// TS 側の単一出所（@ses/domain の TENANT_LIFECYCLE_STATES / packages/db の TENANT_ROLES /
// @ses/config の APP_ENV_KINDS / packages/db の TWO_FACTOR_SUBJECT_TYPES・
// TENANT_SENDING_DOMAIN_STATES）と機械的に突合する。
//
// 🔴 これは「静的テスト（コードの構造そのものを検査する）」であり DB を必要としない
// （docs/05 §17.2 の分類。tests/static/platform-user-no-flag.test.ts と同じ位置づけ）。
//
// 🔴 新規依存を追加しない制約のため、@ses/domain / @ses/config は package 名ではなく相対パスで
// ソースを直接 import する（tests/static/config-env-example.test.ts が既に採っているのと同じ
// パターン。root の package.json はこの 2 パッケージを依存として宣言していないため、package 名での
// import は pnpm の strict node_modules ではリンクされない）。packages/db 自体は root の
// package.json に `@ses/db: workspace:*` が既にあるが、ここでも他と同じ相対パスに統一する
// （ビルド〔dist〕を要求せず、ソースを直接見に行けるほうがドリフト検知として素直なため）。
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_ENV_KINDS } from '../../packages/config/src/app-env.js';
import { TENANT_ROLES } from '../../packages/db/src/context.js';
import {
  AI_ROLES,
  AI_USAGE_FAILURE_KINDS,
  AI_USAGE_PURPOSES,
  ANNOUNCEMENT_KINDS,
  APPROVAL_MODE_CONFIGURABLE_ROLES,
  AUDIT_ACTOR_KINDS,
  AUDIT_DEVICE_KINDS,
  CHAT_THREAD_KINDS,
  CONTRACT_DOCUMENT_EXTERNAL_PROVIDERS,
  CONTRACT_DOCUMENT_SENT_VIAS,
  CONTRACT_KINDS,
  DATA_EXPORT_KINDS,
  DATA_EXPORT_STATUSES,
  EMAIL_DISPATCH_STATUSES,
  EMAIL_EVENT_TYPES,
  EMAIL_RECIPIENT_CLASSES,
  ENGINEER_AVAILABILITIES,
  ENGINEER_SKILL_SOURCES,
  ESIGN_SIGNING_ORDERS,
  EXTENSION_REVIEW_DECISIONS,
  GATE_VERDICTS,
  IMPERSONATION_END_KINDS,
  MATCH_WEIGHT_FACTORS,
  ORDER_PAYMENT_STATES,
  PLATFORM_ROLES,
  PROJECT_STATUSES,
  PROPOSAL_EVENT_KINDS,
  REMOTE_MODES,
  REQUIREMENT_KINDS,
  REVIEW_GATE_EXECUTIONS,
  REVIEW_GATE_TARGET_TYPES,
  SCAN_STATUSES,
  SCHEDULER_RUN_STATUSES,
  SEND_ATTEMPT_ENTITY_TYPES,
  SEND_ATTEMPT_STATUSES,
  SKILL_ALIAS_ORIGINS,
  SKILL_ALIAS_STATUSES,
  SKILL_SHEET_EXTRACTION_STATUSES,
  SUBSCRIPTION_BILLING_STATES,
  TASK_KINDS,
  TASK_STATES,
  TENANT_PURGE_CAUSES,
  TENANT_PURGE_STATUSES,
  TENANT_ROLE_APPROVAL_MODE_VALUES,
  TENANT_SENDING_DOMAIN_STATES,
  TWO_FACTOR_SUBJECT_TYPES,
  USAGE_COUNTER_METRICS,
  USAGE_COUNTER_PERIOD_KINDS,
  WEBHOOK_PROVIDERS,
} from '../../packages/db/src/schema-value-sets.js';
import { ASSIGNMENT_STATES } from '../../packages/domain/src/state/assignment.js';
import { CONTRACT_STATES } from '../../packages/domain/src/state/contract.js';
import { PROPOSAL_STATES } from '../../packages/domain/src/state/proposal.js';
import { PROPOSAL_REQUEST_STATES } from '../../packages/domain/src/state/proposalRequest.js';
import {
  TENANT_ENVIRONMENTS,
  TENANT_LIFECYCLE_STATES,
} from '../../packages/domain/src/state/tenant.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const migrationsDir = path.join(repoRoot, 'packages', 'db', 'prisma', 'migrations');

/**
 * `packages/db/prisma/migrations/**\/migration.sql` を全て連結したテキスト。
 * 🔴 特定のマイグレーションフォルダ名（タイムスタンプ）に依存しない。将来マイグレーションが
 * 増えても、対象の CONSTRAINT がどのファイルにあっても拾える。
 */
function readAllMigrationSql(): string {
  const entries = readdirSync(migrationsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  return entries
    .map((entry) => readFileSync(path.join(migrationsDir, entry.name, 'migration.sql'), 'utf8'))
    .join('\n');
}

/**
 * `CONSTRAINT "<name>" CHECK ("col" IN ('A', 'B', ...))` 形式から値集合を抽出する。
 * 対象の 6 制約はいずれも `col IN (...)` の前後に丸括弧のネストが無い単一行の宣言のため、
 * 「CHECK の直後の開き括弧」〜「IN リストの閉じ括弧 + CHECK の閉じ括弧」を欲張らずに切り出せば足りる。
 *
 * 🔴 `matchAll`（`g` フラグ）で全マッチを取り、同名 `CONSTRAINT` が 2 件以上ヒットしたら throw する
 * （code-reviewer 指摘）。migration.sql は複数ファイルを連結したテキストであり、将来 DROP + 再定義
 * のような形で同名 CHECK が複数マイグレーションにまたがって現れても、素朴に「最初の 1 件」を拾うと
 * 古い定義とだけ突合して silent に drift を見逃す。「最後の定義を採る」等へパーサを更新すべき状況を
 * loud failure にする。
 */
function extractCheckInValues(sql: string, constraintName: string): string[] {
  const pattern = new RegExp(
    String.raw`CONSTRAINT\s+"${constraintName}"\s+CHECK\s*\([^()]*IN\s*\(([^)]*)\)\)`,
    'g',
  );
  const matches = [...sql.matchAll(pattern)];
  if (matches.length === 0) {
    throw new Error(`CHECK constraint "${constraintName}" が migration.sql に見つかりません`);
  }
  if (matches.length > 1) {
    throw new Error(
      `CHECK constraint "${constraintName}" の定義が migration.sql 群に ${matches.length} 件見つかりました` +
        `（再定義を検知した）。DROP + 再定義等で同名 CHECK が複数回宣言されています。` +
        `extractCheckInValues を「最後の定義を採る」等の意図的な方針に更新してください。`,
    );
  }
  const match = matches[0]!;
  return match[1]!.split(',').map((raw) => {
    const trimmed = raw.trim();
    const valueMatch = /^'([^']*)'$/.exec(trimmed);
    if (!valueMatch) {
      throw new Error(`"${constraintName}" の値のパースに失敗しました: ${trimmed}`);
    }
    return valueMatch[1]!;
  });
}

/** 値集合として順不同で一致するかを見る（CHECK の列挙順と TS 配列の宣言順は独立でよい）。 */
function expectSameValueSet(actual: readonly string[], expected: readonly string[]): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

const migrationSql = readAllMigrationSql();

describe('CHECK 制約と TS 単一出所の drift 検査（docs/05 §3.1「列挙」規約）', () => {
  it('対照: パーサ自体が空振りしていない（既知の制約から非空の値集合を取れる）', () => {
    const values = extractCheckInValues(migrationSql, 'tenants_lifecycle_state_check');
    expect(values.length).toBeGreaterThan(0);
  });

  it('対照: 存在しない制約名は例外になる（「常に一致」の空振りを防ぐ）', () => {
    expect(() => extractCheckInValues(migrationSql, 'no_such_constraint_check')).toThrow();
  });

  it('tenants_lifecycle_state_check ⇔ @ses/domain TENANT_LIFECYCLE_STATES', () => {
    const values = extractCheckInValues(migrationSql, 'tenants_lifecycle_state_check');
    expectSameValueSet(values, TENANT_LIFECYCLE_STATES);
  });

  it('対照: lifecycle_state の CHECK が 1 値でも欠けたら検知する（改変 SQL での確認）', () => {
    const tampered = migrationSql.replace("'PURGED'", "'PURGED_TYPO'");
    const values = extractCheckInValues(tampered, 'tenants_lifecycle_state_check');
    expect(values).not.toEqual([...TENANT_LIFECYCLE_STATES]);
  });

  it('memberships_role_check ⇔ packages/db TENANT_ROLES', () => {
    const values = extractCheckInValues(migrationSql, 'memberships_role_check');
    expectSameValueSet(values, TENANT_ROLES);
  });

  it('invitations_role_check ⇔ packages/db TENANT_ROLES', () => {
    const values = extractCheckInValues(migrationSql, 'invitations_role_check');
    expectSameValueSet(values, TENANT_ROLES);
  });

  it('対照: role の CHECK が 1 値でも欠けたら検知する（改変 SQL での確認）', () => {
    const tampered = migrationSql.replace("'VIEWER'", "'VIEWER_TYPO'");
    const values = extractCheckInValues(tampered, 'memberships_role_check');
    expect(values).not.toEqual([...TENANT_ROLES]);
  });

  // docs/05 §3.3: Tenant.environment（AppEnvKind）はテナントの「種別」（本番顧客 / sandbox 見込み客 /
  // デモ）であり、packages/config の APP_ENV（development/demo/sandbox/staging/production の 5 値。
  // デプロイ環境）とは別概念（schema.prisma 冒頭コメント参照）。だが値そのものは
  // APP_ENV_KINDS の部分集合であり、単一の出所は APP_ENV_KINDS に置く。
  // 🔴 「除外リストで引く」書き方にする（config-env-example.test.ts 等と同じ思想。
  //    tests/isolation の「除外は 4 表のみ」規約とも揃える）: APP_ENV_KINDS に新しい値が増えたとき、
  //    ここで明示的に除外しない限り期待値に混入し、CHECK との不一致でテストが必ず落ちる
  //    （「テナント種別として扱うか」を機械的に人間へ問い返す設計）。
  const DEPLOYMENT_ONLY_APP_ENV_KINDS: readonly string[] = ['development', 'staging'];

  it('tenants_environment_check ⇔ @ses/config APP_ENV_KINDS（development/staging を除く部分集合）', () => {
    const expected = APP_ENV_KINDS.filter((kind) => !DEPLOYMENT_ONLY_APP_ENV_KINDS.includes(kind));
    const values = extractCheckInValues(migrationSql, 'tenants_environment_check');
    expectSameValueSet(values, expected);
  });

  it('対照: environment の CHECK が 1 値でも欠けたら検知する（改変 SQL での確認）', () => {
    const tampered = migrationSql.replace("'demo'", "'demo_typo'");
    const values = extractCheckInValues(tampered, 'tenants_environment_check');
    const expected = APP_ENV_KINDS.filter((kind) => !DEPLOYMENT_ONLY_APP_ENV_KINDS.includes(kind));
    expect(values).not.toEqual(expected);
  });

  // 🔴 T-03-10: API-A4 の Zod スキーマ（`createTenantBodySchema`）は `@ses/domain` の
  //    `TENANT_ENVIRONMENTS` を enum の出所にしている（`packages/domain` は `@ses/config` に
  //    依存できないため、値の写しがもう 1 つ生まれた）。**3 者が一致していること**を
  //    ここで固定する（片方だけ増えると「API では受け付けるが DB が拒否する」が起きる）。
  it('🔴 tenants_environment_check ⇔ @ses/domain TENANT_ENVIRONMENTS', () => {
    const values = extractCheckInValues(migrationSql, 'tenants_environment_check');
    expectSameValueSet(values, TENANT_ENVIRONMENTS);
  });

  it('🔴 @ses/domain TENANT_ENVIRONMENTS ⇔ @ses/config APP_ENV_KINDS（デプロイ専用の 2 値を除く）', () => {
    const expected = APP_ENV_KINDS.filter((kind) => !DEPLOYMENT_ONLY_APP_ENV_KINDS.includes(kind));
    expect([...TENANT_ENVIRONMENTS].sort()).toEqual([...expected].sort());
  });

  it('two_factor_credentials_subject_type_check ⇔ packages/db TWO_FACTOR_SUBJECT_TYPES', () => {
    const values = extractCheckInValues(migrationSql, 'two_factor_credentials_subject_type_check');
    expectSameValueSet(values, TWO_FACTOR_SUBJECT_TYPES);
  });

  it('tenant_sending_domains_state_check ⇔ packages/db TENANT_SENDING_DOMAIN_STATES', () => {
    const values = extractCheckInValues(migrationSql, 'tenant_sending_domains_state_check');
    expectSameValueSet(values, TENANT_SENDING_DOMAIN_STATES);
  });

  // 🔴 T-02-02（docs/05 §3.4 / §3.5。docs/sprints/SP-02-schema-isolation.md）:
  // 20260903010000_engineer_project_visibility_share/migration.sql が追加した CHECK 制約群。
  describe('T-02-02: 新 migration の CHECK 制約', () => {
    it('engineers_availability_check ⇔ packages/db ENGINEER_AVAILABILITIES', () => {
      const values = extractCheckInValues(migrationSql, 'engineers_availability_check');
      expectSameValueSet(values, ENGINEER_AVAILABILITIES);
    });

    it('対照: availability の CHECK が 1 値でも欠けたら検知する（改変 SQL での確認）', () => {
      const tampered = migrationSql.replace("'INACTIVE'", "'INACTIVE_TYPO'");
      const values = extractCheckInValues(tampered, 'engineers_availability_check');
      expect(values).not.toEqual([...ENGINEER_AVAILABILITIES]);
    });

    it('engineers_remote_mode_check ⇔ packages/db REMOTE_MODES', () => {
      const values = extractCheckInValues(migrationSql, 'engineers_remote_mode_check');
      expectSameValueSet(values, REMOTE_MODES);
    });

    it('projects_remote_mode_check ⇔ packages/db REMOTE_MODES（engineers と同じ値集合を共有）', () => {
      const values = extractCheckInValues(migrationSql, 'projects_remote_mode_check');
      expectSameValueSet(values, REMOTE_MODES);
    });

    it('skill_aliases_status_check ⇔ packages/db SKILL_ALIAS_STATUSES', () => {
      const values = extractCheckInValues(migrationSql, 'skill_aliases_status_check');
      expectSameValueSet(values, SKILL_ALIAS_STATUSES);
    });

    it('skill_aliases_origin_check ⇔ packages/db SKILL_ALIAS_ORIGINS', () => {
      const values = extractCheckInValues(migrationSql, 'skill_aliases_origin_check');
      expectSameValueSet(values, SKILL_ALIAS_ORIGINS);
    });

    it('engineer_skills_source_check ⇔ packages/db ENGINEER_SKILL_SOURCES', () => {
      const values = extractCheckInValues(migrationSql, 'engineer_skills_source_check');
      expectSameValueSet(values, ENGINEER_SKILL_SOURCES);
    });

    it('skill_sheets_scan_status_check ⇔ packages/db SCAN_STATUSES', () => {
      const values = extractCheckInValues(migrationSql, 'skill_sheets_scan_status_check');
      expectSameValueSet(values, SCAN_STATUSES);
    });

    it('file_scan_results_status_check ⇔ packages/db SCAN_STATUSES（skill_sheets と同じ値集合を共有）', () => {
      const values = extractCheckInValues(migrationSql, 'file_scan_results_status_check');
      expectSameValueSet(values, SCAN_STATUSES);
    });

    it('skill_sheet_extractions_status_check ⇔ packages/db SKILL_SHEET_EXTRACTION_STATUSES', () => {
      const values = extractCheckInValues(migrationSql, 'skill_sheet_extractions_status_check');
      expectSameValueSet(values, SKILL_SHEET_EXTRACTION_STATUSES);
    });

    it('projects_status_check ⇔ packages/db PROJECT_STATUSES', () => {
      const values = extractCheckInValues(migrationSql, 'projects_status_check');
      expectSameValueSet(values, PROJECT_STATUSES);
    });

    it('🔴 project_requirements_kind_check ⇔ packages/db REQUIREMENT_KINDS（F-013 AC-1 の完了判定）', () => {
      const values = extractCheckInValues(migrationSql, 'project_requirements_kind_check');
      expectSameValueSet(values, REQUIREMENT_KINDS);
    });

    it('対照: kind の CHECK が 1 値でも欠けたら検知する（改変 SQL での確認）', () => {
      const tampered = migrationSql.replace("'NICE'", "'NICE_TYPO'");
      const values = extractCheckInValues(tampered, 'project_requirements_kind_check');
      expect(values).not.toEqual([...REQUIREMENT_KINDS]);
    });
  });

  // 🔴 T-02-03（docs/05 §3.6。docs/sprints/SP-02-schema-isolation.md）:
  // 20260903020000_proposal_request_gate/migration.sql が追加した CHECK 制約群。
  // ProposalState / ProposalRequestState の単一の出所は既存の @ses/domain
  // （PROPOSAL_STATES / PROPOSAL_REQUEST_STATES。T-01-07 から既存。新しい配列を作らずここと突合する）。
  describe('T-02-03: 新 migration の CHECK 制約', () => {
    it('proposal_requests_state_check ⇔ @ses/domain PROPOSAL_REQUEST_STATES', () => {
      const values = extractCheckInValues(migrationSql, 'proposal_requests_state_check');
      expectSameValueSet(values, PROPOSAL_REQUEST_STATES);
    });

    it('🔴 proposals_state_check ⇔ @ses/domain PROPOSAL_STATES（CLAUDE.md §4.2 の 14 状態）', () => {
      const values = extractCheckInValues(migrationSql, 'proposals_state_check');
      expectSameValueSet(values, PROPOSAL_STATES);
    });

    it('対照: proposals の state CHECK が 1 値でも欠けたら検知する（改変 SQL での確認）', () => {
      const tampered = migrationSql.replace("'WITHDRAWN'", "'WITHDRAWN_TYPO'");
      const values = extractCheckInValues(tampered, 'proposals_state_check');
      expect(values).not.toEqual([...PROPOSAL_STATES]);
    });

    it('proposal_events_kind_check ⇔ packages/db PROPOSAL_EVENT_KINDS', () => {
      const values = extractCheckInValues(migrationSql, 'proposal_events_kind_check');
      expectSameValueSet(values, PROPOSAL_EVENT_KINDS);
    });

    it('proposal_events_from_state_check ⇔ @ses/domain PROPOSAL_STATES', () => {
      const values = extractCheckInValues(migrationSql, 'proposal_events_from_state_check');
      expectSameValueSet(values, PROPOSAL_STATES);
    });

    it('proposal_events_to_state_check ⇔ @ses/domain PROPOSAL_STATES', () => {
      const values = extractCheckInValues(migrationSql, 'proposal_events_to_state_check');
      expectSameValueSet(values, PROPOSAL_STATES);
    });

    it('🔴 review_gates_target_type_check ⇔ packages/db REVIEW_GATE_TARGET_TYPES（CONTRACT_DOCUMENT を含む 5 種。Issue #15）', () => {
      const values = extractCheckInValues(migrationSql, 'review_gates_target_type_check');
      expectSameValueSet(values, REVIEW_GATE_TARGET_TYPES);
    });

    it('review_gates_execution_check ⇔ packages/db REVIEW_GATE_EXECUTIONS（P-A-16。状態機械ではなく実行の属性）', () => {
      const values = extractCheckInValues(migrationSql, 'review_gates_execution_check');
      expectSameValueSet(values, REVIEW_GATE_EXECUTIONS);
    });

    it('対照: execution の CHECK が 1 値でも欠けたら検知する（改変 SQL での確認）', () => {
      const tampered = migrationSql.replace("'HELD_AI_COST_LIMIT'", "'HELD_AI_COST_LIMIT_TYPO'");
      const values = extractCheckInValues(tampered, 'review_gates_execution_check');
      expect(values).not.toEqual([...REVIEW_GATE_EXECUTIONS]);
    });

    it('review_gates_pii_verdict_check ⇔ packages/db GATE_VERDICTS', () => {
      const values = extractCheckInValues(migrationSql, 'review_gates_pii_verdict_check');
      expectSameValueSet(values, GATE_VERDICTS);
    });

    it('review_gates_commerce_verdict_check ⇔ packages/db GATE_VERDICTS', () => {
      const values = extractCheckInValues(migrationSql, 'review_gates_commerce_verdict_check');
      expectSameValueSet(values, GATE_VERDICTS);
    });

    it('review_gates_consistency_verdict_check ⇔ packages/db GATE_VERDICTS', () => {
      const values = extractCheckInValues(migrationSql, 'review_gates_consistency_verdict_check');
      expectSameValueSet(values, GATE_VERDICTS);
    });

    it('engineer_snapshots_remote_mode_check ⇔ packages/db REMOTE_MODES（engineers / projects と同じ値集合を共有）', () => {
      const values = extractCheckInValues(migrationSql, 'engineer_snapshots_remote_mode_check');
      expectSameValueSet(values, REMOTE_MODES);
    });
  });

  // 🔴 T-02-04（docs/05 §3.7。docs/sprints/SP-02-schema-isolation.md）:
  // 20260903030000_chat_contract_assignment/migration.sql が値集合の CHECK を持つ列。
  // AssignmentState / ContractState の単一の出所は既存の @ses/domain（ASSIGNMENT_STATES /
  // CONTRACT_STATES。T-01-07 から既存。新しい配列を作らずここと突合する）。
  describe('T-02-04: 新 migration の CHECK 制約', () => {
    it('chat_threads_kind_check ⇔ packages/db CHAT_THREAD_KINDS', () => {
      const values = extractCheckInValues(migrationSql, 'chat_threads_kind_check');
      expectSameValueSet(values, CHAT_THREAD_KINDS);
    });

    it('messages_attachment_scan_status_check ⇔ packages/db SCAN_STATUSES（messages / skill_sheets と同じ値集合を共有）', () => {
      const values = extractCheckInValues(migrationSql, 'messages_attachment_scan_status_check');
      expectSameValueSet(values, SCAN_STATUSES);
    });

    it('contracts_kind_check ⇔ packages/db CONTRACT_KINDS', () => {
      const values = extractCheckInValues(migrationSql, 'contracts_kind_check');
      expectSameValueSet(values, CONTRACT_KINDS);
    });

    it('🔴 contracts_state_check ⇔ @ses/domain CONTRACT_STATES（CLAUDE.md §4.2 の 7 状態）', () => {
      const values = extractCheckInValues(migrationSql, 'contracts_state_check');
      expectSameValueSet(values, CONTRACT_STATES);
    });

    it('対照: contracts の state CHECK が 1 値でも欠けたら検知する（改変 SQL での確認）', () => {
      // 🔴 'WITHDRAWN' は proposals_state_check にも含まれ、かつ migrationSql は全 migration.sql の
      //    連結テキストなので文字列 replace（最初の 1 件のみ置換）が先勝ちする proposals 側を
      //    改変してしまう。contracts_state_check にしか出現しない値（'UNDER_REVIEW'）を使う。
      const tampered = migrationSql.replace("'UNDER_REVIEW'", "'UNDER_REVIEW_TYPO'");
      const values = extractCheckInValues(tampered, 'contracts_state_check');
      expect(values).not.toEqual([...CONTRACT_STATES]);
    });

    it('contract_documents_scan_status_check ⇔ packages/db SCAN_STATUSES', () => {
      const values = extractCheckInValues(migrationSql, 'contract_documents_scan_status_check');
      expectSameValueSet(values, SCAN_STATUSES);
    });

    it('contract_documents_external_provider_check ⇔ packages/db CONTRACT_DOCUMENT_EXTERNAL_PROVIDERS（BYO 接続。決定済み Issue #11）', () => {
      const values = extractCheckInValues(migrationSql, 'contract_documents_external_provider_check');
      expectSameValueSet(values, CONTRACT_DOCUMENT_EXTERNAL_PROVIDERS);
    });

    it('contract_documents_sent_via_check ⇔ packages/db CONTRACT_DOCUMENT_SENT_VIAS', () => {
      const values = extractCheckInValues(migrationSql, 'contract_documents_sent_via_check');
      expectSameValueSet(values, CONTRACT_DOCUMENT_SENT_VIAS);
    });

    it('contract_templates_kind_check ⇔ packages/db CONTRACT_KINDS（contracts と同じ値集合を共有）', () => {
      const values = extractCheckInValues(migrationSql, 'contract_templates_kind_check');
      expectSameValueSet(values, CONTRACT_KINDS);
    });

    it('contract_templates_scan_status_check ⇔ packages/db SCAN_STATUSES', () => {
      const values = extractCheckInValues(migrationSql, 'contract_templates_scan_status_check');
      expectSameValueSet(values, SCAN_STATUSES);
    });

    it('🔴 assignments_state_check ⇔ @ses/domain ASSIGNMENT_STATES（CLAUDE.md §4.2 の 5 状態）', () => {
      const values = extractCheckInValues(migrationSql, 'assignments_state_check');
      expectSameValueSet(values, ASSIGNMENT_STATES);
    });

    it('対照: assignments の state CHECK が 1 値でも欠けたら検知する（改変 SQL での確認）', () => {
      const tampered = migrationSql.replace("'EXTENSION_REVIEW'", "'EXTENSION_REVIEW_TYPO'");
      const values = extractCheckInValues(tampered, 'assignments_state_check');
      expect(values).not.toEqual([...ASSIGNMENT_STATES]);
    });

    it('orders_payment_state_check ⇔ packages/db ORDER_PAYMENT_STATES', () => {
      const values = extractCheckInValues(migrationSql, 'orders_payment_state_check');
      expectSameValueSet(values, ORDER_PAYMENT_STATES);
    });

    it('extension_reviews_decision_check ⇔ packages/db EXTENSION_REVIEW_DECISIONS', () => {
      const values = extractCheckInValues(migrationSql, 'extension_reviews_decision_check');
      expectSameValueSet(values, EXTENSION_REVIEW_DECISIONS);
    });
  });

  // 🔴 T-02-05（docs/05 §3.8 / §3.9 / §3.10。docs/sprints/SP-02-schema-isolation.md）:
  // 20260903040000_cross_cutting_platform/migration.sql が値集合の CHECK を持つ列。
  describe('T-02-05: 新 migration の CHECK 制約', () => {
    it('tasks_kind_check ⇔ packages/db TASK_KINDS', () => {
      const values = extractCheckInValues(migrationSql, 'tasks_kind_check');
      expectSameValueSet(values, TASK_KINDS);
    });

    it('tasks_state_check ⇔ packages/db TASK_STATES', () => {
      const values = extractCheckInValues(migrationSql, 'tasks_state_check');
      expectSameValueSet(values, TASK_STATES);
    });

    it('🔴 ai_usage_role_check ⇔ packages/db AI_ROLES（F-026 AC-2 の完了判定）', () => {
      const values = extractCheckInValues(migrationSql, 'ai_usage_role_check');
      expectSameValueSet(values, AI_ROLES);
    });

    it('対照: ai_usage の role CHECK が 1 値でも欠けたら検知する（改変 SQL での確認）', () => {
      const tampered = migrationSql.replace("'renewal-advisor'", "'renewal-advisor-typo'");
      const values = extractCheckInValues(tampered, 'ai_usage_role_check');
      expect(values).not.toEqual([...AI_ROLES]);
    });

    it('ai_usage_purpose_check ⇔ packages/db AI_USAGE_PURPOSES', () => {
      const values = extractCheckInValues(migrationSql, 'ai_usage_purpose_check');
      expectSameValueSet(values, AI_USAGE_PURPOSES);
    });

    it('ai_usage_failure_kind_check ⇔ packages/db AI_USAGE_FAILURE_KINDS', () => {
      const values = extractCheckInValues(migrationSql, 'ai_usage_failure_kind_check');
      expectSameValueSet(values, AI_USAGE_FAILURE_KINDS);
    });

    it('audit_logs_actor_kind_check ⇔ packages/db AUDIT_ACTOR_KINDS', () => {
      const values = extractCheckInValues(migrationSql, 'audit_logs_actor_kind_check');
      expectSameValueSet(values, AUDIT_ACTOR_KINDS);
    });

    it('audit_logs_device_kind_check ⇔ packages/db AUDIT_DEVICE_KINDS', () => {
      const values = extractCheckInValues(migrationSql, 'audit_logs_device_kind_check');
      expectSameValueSet(values, AUDIT_DEVICE_KINDS);
    });

    it('usage_counters_period_kind_check ⇔ packages/db USAGE_COUNTER_PERIOD_KINDS', () => {
      const values = extractCheckInValues(migrationSql, 'usage_counters_period_kind_check');
      expectSameValueSet(values, USAGE_COUNTER_PERIOD_KINDS);
    });

    it('usage_counters_metric_check ⇔ packages/db USAGE_COUNTER_METRICS', () => {
      const values = extractCheckInValues(migrationSql, 'usage_counters_metric_check');
      expectSameValueSet(values, USAGE_COUNTER_METRICS);
    });

    it('tenant_esign_connections_provider_check ⇔ packages/db CONTRACT_DOCUMENT_EXTERNAL_PROVIDERS（ContractDocument と同じ値集合を共有。決定済み Issue #11）', () => {
      const values = extractCheckInValues(migrationSql, 'tenant_esign_connections_provider_check');
      expectSameValueSet(values, CONTRACT_DOCUMENT_EXTERNAL_PROVIDERS);
    });

    it('tenant_esign_connections_signing_order_default_check ⇔ packages/db ESIGN_SIGNING_ORDERS', () => {
      const values = extractCheckInValues(
        migrationSql,
        'tenant_esign_connections_signing_order_default_check',
      );
      expectSameValueSet(values, ESIGN_SIGNING_ORDERS);
    });

    it('🔴 send_attempts_entity_type_check ⇔ packages/db SEND_ATTEMPT_ENTITY_TYPES（docs/03 §4.7。K-5 の防御線）', () => {
      const values = extractCheckInValues(migrationSql, 'send_attempts_entity_type_check');
      expectSameValueSet(values, SEND_ATTEMPT_ENTITY_TYPES);
    });

    it('send_attempts_status_check ⇔ packages/db SEND_ATTEMPT_STATUSES', () => {
      const values = extractCheckInValues(migrationSql, 'send_attempts_status_check');
      expectSameValueSet(values, SEND_ATTEMPT_STATUSES);
    });

    it('email_dispatches_recipient_class_check ⇔ packages/db EMAIL_RECIPIENT_CLASSES', () => {
      const values = extractCheckInValues(migrationSql, 'email_dispatches_recipient_class_check');
      expectSameValueSet(values, EMAIL_RECIPIENT_CLASSES);
    });

    it('email_dispatches_status_check ⇔ packages/db EMAIL_DISPATCH_STATUSES（7 値）', () => {
      const values = extractCheckInValues(migrationSql, 'email_dispatches_status_check');
      expectSameValueSet(values, EMAIL_DISPATCH_STATUSES);
    });

    it('email_events_event_type_check ⇔ packages/db EMAIL_EVENT_TYPES（SES の実値）', () => {
      const values = extractCheckInValues(migrationSql, 'email_events_event_type_check');
      expectSameValueSet(values, EMAIL_EVENT_TYPES);
    });

    it('webhook_deliveries_provider_check ⇔ packages/db WEBHOOK_PROVIDERS', () => {
      const values = extractCheckInValues(migrationSql, 'webhook_deliveries_provider_check');
      expectSameValueSet(values, WEBHOOK_PROVIDERS);
    });

    it('data_export_requests_kind_check ⇔ packages/db DATA_EXPORT_KINDS', () => {
      const values = extractCheckInValues(migrationSql, 'data_export_requests_kind_check');
      expectSameValueSet(values, DATA_EXPORT_KINDS);
    });

    it('data_export_requests_status_check ⇔ packages/db DATA_EXPORT_STATUSES', () => {
      const values = extractCheckInValues(migrationSql, 'data_export_requests_status_check');
      expectSameValueSet(values, DATA_EXPORT_STATUSES);
    });

    it('tenant_purge_runs_cause_check ⇔ packages/db TENANT_PURGE_CAUSES', () => {
      const values = extractCheckInValues(migrationSql, 'tenant_purge_runs_cause_check');
      expectSameValueSet(values, TENANT_PURGE_CAUSES);
    });

    it('tenant_purge_runs_status_check ⇔ packages/db TENANT_PURGE_STATUSES', () => {
      const values = extractCheckInValues(migrationSql, 'tenant_purge_runs_status_check');
      expectSameValueSet(values, TENANT_PURGE_STATUSES);
    });

    it('scheduler_runs_status_check ⇔ packages/db SCHEDULER_RUN_STATUSES', () => {
      const values = extractCheckInValues(migrationSql, 'scheduler_runs_status_check');
      expectSameValueSet(values, SCHEDULER_RUN_STATUSES);
    });

    it('🔴 platform_users_role_check ⇔ packages/db PLATFORM_ROLES（BR-36 / CLAUDE.md §10.1）', () => {
      const values = extractCheckInValues(migrationSql, 'platform_users_role_check');
      expectSameValueSet(values, PLATFORM_ROLES);
    });

    it('subscriptions_billing_state_check ⇔ packages/db SUBSCRIPTION_BILLING_STATES', () => {
      const values = extractCheckInValues(migrationSql, 'subscriptions_billing_state_check');
      expectSameValueSet(values, SUBSCRIPTION_BILLING_STATES);
    });

    it('impersonation_sessions_end_kind_check ⇔ packages/db IMPERSONATION_END_KINDS', () => {
      const values = extractCheckInValues(migrationSql, 'impersonation_sessions_end_kind_check');
      expectSameValueSet(values, IMPERSONATION_END_KINDS);
    });

    it('announcements_kind_check ⇔ packages/db ANNOUNCEMENT_KINDS', () => {
      const values = extractCheckInValues(migrationSql, 'announcements_kind_check');
      expectSameValueSet(values, ANNOUNCEMENT_KINDS);
    });

    it('🔴 tenant_role_approval_modes_role_check ⇔ packages/db APPROVAL_MODE_CONFIGURABLE_ROLES（gate-inspector を含まない 5 値。CLAUDE.md §12.4）', () => {
      const values = extractCheckInValues(migrationSql, 'tenant_role_approval_modes_role_check');
      expectSameValueSet(values, APPROVAL_MODE_CONFIGURABLE_ROLES);
    });

    it('対照: tenant_role_approval_modes の role CHECK に gate-inspector が含まれない', () => {
      const values = extractCheckInValues(migrationSql, 'tenant_role_approval_modes_role_check');
      expect(values).not.toContain('gate-inspector');
    });

    it('tenant_role_approval_modes_mode_check ⇔ packages/db TENANT_ROLE_APPROVAL_MODE_VALUES', () => {
      const values = extractCheckInValues(migrationSql, 'tenant_role_approval_modes_mode_check');
      expectSameValueSet(values, TENANT_ROLE_APPROVAL_MODE_VALUES);
    });

    it('🔴 tenant_role_models_role_check ⇔ packages/db AI_ROLES（6 ロールすべて設定可。gate-inspector を含む）', () => {
      const values = extractCheckInValues(migrationSql, 'tenant_role_models_role_check');
      expectSameValueSet(values, AI_ROLES);
      expect(values).toContain('gate-inspector');
    });

    it('tenant_match_weights_factor_check ⇔ packages/db MATCH_WEIGHT_FACTORS（[Issue #3]）', () => {
      const values = extractCheckInValues(migrationSql, 'tenant_match_weights_factor_check');
      expectSameValueSet(values, MATCH_WEIGHT_FACTORS);
    });
  });
});
