// tests/isolation/proposal-gate-constraints.test.ts
// T-02-03（docs/sprints/SP-02-schema-isolation.md）: docs/05 §3.6「提案・提案依頼・品質ゲート」で
// 追加した 5 表（proposal_requests / proposals / engineer_snapshots / proposal_events /
// review_gates）について、
//   ① ENABLE + FORCE ROW LEVEL SECURITY が入っており、所有者（app_migrator）からは
//      1 行も見えない・書けないこと（T-02-06 でポリシーは `TO app_tenant` で本適用済み）
//      （C5 PARTY 等のポリシー本体は T-02-06 で適用済み。`skills` と違い
//      これらは射程外ではないため、後続タスクで必ずポリシーが付く）
//   ② migration.sql に手で追加した CHECK 制約 / FK / 部分 UNIQUE が実際に機能すること
// を検証する（tests/isolation/engineer-project-visibility-constraints.test.ts と同じ方針）。
//
// 🔴 ②は RLS を一時的に DISABLE してテーブル所有者（app_migrator）接続で直接 INSERT を試みる。
//    🔴 PostgreSQL の FK 検証は RLS を経由しない（常にバイパスする）ため、参照先テーブル
//    （engineers / projects / partner_companies 等）自体への RLS 適用有無は FK チェックの成否に
//    影響しない。DISABLE が要るのは「そのテーブル自身へ直接 INSERT する」ときだけである
//    （engineer-project-visibility-constraints.test.ts の review_gates FK テストで実測済み）。
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createUnextendedClient,
  readTableRlsStatus,
  setRowLevelSecurity,
  type UnextendedClient,
} from '@ses/db/testing';
import { ENGINEER_A_HOST, PARTNER_A1, TENANT_A } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

const NEW_TABLES = [
  'proposal_requests',
  'proposals',
  'engineer_snapshots',
  'proposal_events',
  'review_gates',
] as const;

describe('T-02-03: docs/05 §3.6 の新 5 表', () => {
  let database: IsolationDatabase;
  let owner: UnextendedClient;

  beforeAll(async () => {
    database = await startIsolationDatabase();
    owner = createUnextendedClient(database.migratorUrl);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await owner?.$disconnect();
    await database?.stop();
  }, SETUP_TIMEOUT_MS);

  it('① 全 5 表で RLS が有効かつ FORCE されている（docs/05 §4.1 第 1 防御。既定は fail-closed）', async () => {
    const status = await readTableRlsStatus(owner, [...NEW_TABLES]);
    expect(status).toHaveLength(NEW_TABLES.length); // 空振り防止（対照）
    for (const table of status) {
      expect(table.rlsEnabled, `${table.table}: RLS が有効でない`).toBe(true);
      expect(table.rlsForced, `${table.table}: RLS が FORCE されていない`).toBe(true);
    }
  });

  // 🔴 T-02-06 でポリシー C0〜C8 を本適用した。ポリシーはすべて `TO app_tenant` で作られており、
  //    テーブル所有者（app_migrator）に適用されるポリシーは 1 つも無い。したがって
  //    FORCE ROW LEVEL SECURITY の下では所有者接続からも 0 件・書き込み不可のままである
  //    （この 2 件が確かめているのは「所有者が RLS を素通りしないこと」であり、
  //     T-02-06 前の「ポリシーが 0 件だから」から**理由は変わったが結論は同じ**）。
  it('① 所有者（app_migrator）接続に適用されるポリシーが無いため SELECT は 0 件（fail-closed）', async () => {
    const rows = await owner.proposal.findMany();
    expect(rows).toEqual([]);
  });

  it('① 所有者（app_migrator）接続に適用されるポリシーが無いため INSERT は拒否される', async () => {
    await expect(
      owner.proposalRequest.create({
        data: {
          tenantId: TENANT_A,
          projectId: randomUUID(),
          engineerId: randomUUID(),
          partnerCompanyId: randomUUID(),
          message: 'RLS 越境未検証の提案依頼',
          expiresAt: new Date(),
          issuedBy: randomUUID(),
        },
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  describe('② CHECK 制約 / FK / 部分 UNIQUE（RLS を一時 DISABLE して直接検証）', () => {
    // 🔴 projects は T-02-02 から fail-closed（0 ポリシー）。案件行を用意するために disable する。
    const TABLES_TO_DISABLE = [...NEW_TABLES, 'projects'] as const;

    let projectId: string;

    beforeAll(async () => {
      await setRowLevelSecurity({
        ownerDatasourceUrl: database.migratorUrl,
        tables: [...TABLES_TO_DISABLE],
        enabled: false,
      });

      const project = await owner.project.create({
        data: { tenantId: TENANT_A, name: 'T-02-03 CHECK 制約検証用案件' },
      });
      projectId = project.id;
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      await setRowLevelSecurity({
        ownerDatasourceUrl: database.migratorUrl,
        tables: [...TABLES_TO_DISABLE],
        enabled: true,
      });
    }, SETUP_TIMEOUT_MS);

    it('対照: RLS が確かに落ちている（所有者接続で ProposalRequest を作成できる）', async () => {
      const request = await owner.proposalRequest.create({
        data: {
          tenantId: TENANT_A,
          projectId,
          engineerId: ENGINEER_A_HOST,
          partnerCompanyId: PARTNER_A1,
          message: '対照用の提案依頼',
          expiresAt: new Date(),
          issuedBy: randomUUID(),
        },
      });
      expect(request.id).toBeTruthy();
    });

    describe('proposal_requests_state_check（docs/05 §3.6。単一の出所は @ses/domain PROPOSAL_REQUEST_STATES）', () => {
      it('不正な state は拒否される', async () => {
        await expect(
          owner.proposalRequest.create({
            data: {
              tenantId: TENANT_A,
              projectId,
              engineerId: ENGINEER_A_HOST,
              partnerCompanyId: PARTNER_A1,
              state: 'BOGUS',
              message: 'X',
              expiresAt: new Date(),
              issuedBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/proposal_requests_state_check/);
      });

      it('対照: 許容値は成立する', async () => {
        // 🔴 UNIQUE(tenant, project, engineer) と衝突しないよう別案件を用意する
        //    （直前のテストが同じ projectId + ENGINEER_A_HOST の組を使い切っている）。
        const dedicatedProject = await owner.project.create({
          data: { tenantId: TENANT_A, name: 'state CHECK 許容値検証用案件' },
        });
        const request = await owner.proposalRequest.create({
          data: {
            tenantId: TENANT_A,
            projectId: dedicatedProject.id,
            engineerId: ENGINEER_A_HOST,
            partnerCompanyId: PARTNER_A1,
            state: 'ACCEPTED',
            message: 'X',
            expiresAt: new Date(),
            issuedBy: randomUUID(),
          },
        });
        expect(request.state).toBe('ACCEPTED');
      });
    });

    describe('🔴 proposal_requests の UNIQUE(tenant, project, engineer)（docs/05 §3.6。同一案件 × 同一候補への重複依頼を防ぐ）', () => {
      it('同一案件・同一エンジニアへの重複依頼は拒否される', async () => {
        const dedicatedProject = await owner.project.create({
          data: { tenantId: TENANT_A, name: '重複依頼検証用案件' },
        });
        await owner.proposalRequest.create({
          data: {
            tenantId: TENANT_A,
            projectId: dedicatedProject.id,
            engineerId: ENGINEER_A_HOST,
            partnerCompanyId: PARTNER_A1,
            message: 'X',
            expiresAt: new Date(),
            issuedBy: randomUUID(),
          },
        });
        await expect(
          owner.proposalRequest.create({
            data: {
              tenantId: TENANT_A,
              projectId: dedicatedProject.id,
              engineerId: ENGINEER_A_HOST,
              partnerCompanyId: PARTNER_A1,
              message: 'Y',
              expiresAt: new Date(),
              issuedBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });
    });

    describe('🔴 proposals_state_check（docs/05 §3.6。CLAUDE.md §4.2 の 14 状態。単一の出所は @ses/domain PROPOSAL_STATES）', () => {
      it('不正な state は拒否される', async () => {
        await expect(
          owner.proposal.create({
            data: {
              tenantId: TENANT_A,
              projectId,
              engineerId: ENGINEER_A_HOST,
              state: 'BOGUS',
              recipientCompanyName: 'Recipient Inc.',
              recipientEmail: 'sales@recipient.example',
              createdBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/proposals_state_check/);
      });

      it('対照: 許容値（DRAFT）は成立する', async () => {
        const proposal = await owner.proposal.create({
          data: {
            tenantId: TENANT_A,
            projectId,
            engineerId: ENGINEER_A_HOST,
            recipientCompanyName: 'Recipient Inc.',
            recipientEmail: 'sales@recipient.example',
            createdBy: randomUUID(),
          },
        });
        expect(proposal.state).toBe('DRAFT');
      });
    });

    describe('🔴 proposals_approved_requires_hash_check（docs/05 §10.3 / §11.5。承認記録の無い APPROVED を作れない）', () => {
      it('APPROVED なのに approved_at / content_hash が無いと拒否される', async () => {
        await expect(
          owner.proposal.create({
            data: {
              tenantId: TENANT_A,
              projectId,
              engineerId: ENGINEER_A_HOST,
              state: 'APPROVED',
              recipientCompanyName: 'Recipient Inc.',
              recipientEmail: 'sales@recipient.example',
              createdBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/proposals_approved_requires_hash_check/);
      });

      it('対照: approved_at と content_hash が揃っていれば成立する', async () => {
        const proposal = await owner.proposal.create({
          data: {
            tenantId: TENANT_A,
            projectId,
            engineerId: ENGINEER_A_HOST,
            state: 'APPROVED',
            recipientCompanyName: 'Recipient Inc.',
            recipientEmail: 'sales@recipient.example',
            approvedAt: new Date(),
            contentHash: 'sha256-hash-value',
            createdBy: randomUUID(),
          },
        });
        expect(proposal.state).toBe('APPROVED');
      });
    });

    describe('🔴 proposals_submitting_requires_approval_check（docs/05 §10.3。承認を経ない SUBMITTING を作れない）', () => {
      it('SUBMITTING なのに approved_at が無いと拒否される', async () => {
        await expect(
          owner.proposal.create({
            data: {
              tenantId: TENANT_A,
              projectId,
              engineerId: ENGINEER_A_HOST,
              state: 'SUBMITTING',
              recipientCompanyName: 'Recipient Inc.',
              recipientEmail: 'sales@recipient.example',
              contentHash: 'sha256-hash-value',
              createdBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/proposals_submitting_requires_approval_check/);
      });

      it('対照: approved_at があれば成立する', async () => {
        const proposal = await owner.proposal.create({
          data: {
            tenantId: TENANT_A,
            projectId,
            engineerId: ENGINEER_A_HOST,
            state: 'SUBMITTING',
            recipientCompanyName: 'Recipient Inc.',
            recipientEmail: 'sales@recipient.example',
            approvedAt: new Date(),
            contentHash: 'sha256-hash-value',
            createdBy: randomUUID(),
          },
        });
        expect(proposal.state).toBe('SUBMITTING');
      });
    });

    describe('🔴 proposals_one_submitting（部分 UNIQUE。docs/05 §3.6。A-005 が SUBMITTING 滞留を数える根拠）', () => {
      it('id が PK のため 2 件目の SUBMITTING 自体は成立する（部分インデックスは一意化ではなく計数用）', async () => {
        const first = await owner.proposal.create({
          data: {
            tenantId: TENANT_A,
            projectId,
            engineerId: ENGINEER_A_HOST,
            state: 'SUBMITTING',
            recipientCompanyName: 'Recipient Inc.',
            recipientEmail: 'sales@recipient.example',
            approvedAt: new Date(),
            contentHash: 'sha256-hash-value',
            createdBy: randomUUID(),
          },
        });
        const second = await owner.proposal.create({
          data: {
            tenantId: TENANT_A,
            projectId,
            engineerId: ENGINEER_A_HOST,
            state: 'SUBMITTING',
            recipientCompanyName: 'Recipient Inc. 2',
            recipientEmail: 'sales2@recipient.example',
            approvedAt: new Date(),
            contentHash: 'sha256-hash-value-2',
            createdBy: randomUUID(),
          },
        });
        const submitting = await owner.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM proposals WHERE state = 'SUBMITTING' AND id IN (${first.id}::uuid, ${second.id}::uuid)`;
        expect(Number(submitting[0]?.count)).toBe(2);
      });
    });

    describe('proposals_owner_partner_company_id_fkey / proposals_project_id_fkey / proposals_engineer_id_fkey（docs/05 §3.6）', () => {
      it('存在しない owner_partner_company_id を指すと拒否される', async () => {
        await expect(
          owner.proposal.create({
            data: {
              tenantId: TENANT_A,
              ownerPartnerCompanyId: randomUUID(),
              projectId,
              engineerId: ENGINEER_A_HOST,
              recipientCompanyName: 'Recipient Inc.',
              recipientEmail: 'sales@recipient.example',
              createdBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/foreign key constraint/i);
      });

      it('対照: 実在する owner_partner_company_id（PARTNER_A1）を指すと成立する', async () => {
        const proposal = await owner.proposal.create({
          data: {
            tenantId: TENANT_A,
            ownerPartnerCompanyId: PARTNER_A1,
            projectId,
            engineerId: ENGINEER_A_HOST,
            recipientCompanyName: 'Recipient Inc.',
            recipientEmail: 'sales@recipient.example',
            createdBy: randomUUID(),
          },
        });
        expect(proposal.ownerPartnerCompanyId).toBe(PARTNER_A1);
      });
    });

    describe('engineer_snapshots_remote_mode_check / UNIQUE(proposal_id)（docs/05 §3.6。越境経路 2 の唯一の実体）', () => {
      let proposalId: string;

      beforeAll(async () => {
        const proposal = await owner.proposal.create({
          data: {
            tenantId: TENANT_A,
            projectId,
            engineerId: ENGINEER_A_HOST,
            recipientCompanyName: 'Recipient Inc.',
            recipientEmail: 'sales@recipient.example',
            createdBy: randomUUID(),
          },
        });
        proposalId = proposal.id;
      });

      it('不正な remote_mode は拒否される', async () => {
        await expect(
          owner.engineerSnapshot.create({
            data: {
              tenantId: TENANT_A,
              proposalId,
              displayName: 'スナップショット太郎',
              skills: [],
              careers: [],
              remoteMode: 'BOGUS',
              frozenAt: new Date(),
            },
          }),
        ).rejects.toThrow(/engineer_snapshots_remote_mode_check/);
      });

      it('対照: 許容値の組み合わせは成立する', async () => {
        const snapshot = await owner.engineerSnapshot.create({
          data: {
            tenantId: TENANT_A,
            proposalId,
            displayName: 'スナップショット太郎',
            skills: [{ skillId: randomUUID(), name: 'TypeScript', years: 3 }],
            careers: [],
            remoteMode: 'FULL_REMOTE',
            frozenAt: new Date(),
          },
        });
        expect(snapshot.remoteMode).toBe('FULL_REMOTE');
      });

      it('🔴 部分 UNIQUE ではなく通常 UNIQUE: 同一 proposal への 2 件目のスナップショットは拒否される', async () => {
        await expect(
          owner.engineerSnapshot.create({
            data: {
              tenantId: TENANT_A,
              proposalId,
              displayName: 'スナップショット次郎',
              skills: [],
              careers: [],
              frozenAt: new Date(),
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });
    });

    describe('proposal_events_kind_check / from_state_check / to_state_check（docs/05 §3.6）', () => {
      let proposalId: string;

      beforeAll(async () => {
        const proposal = await owner.proposal.create({
          data: {
            tenantId: TENANT_A,
            projectId,
            engineerId: ENGINEER_A_HOST,
            recipientCompanyName: 'Recipient Inc.',
            recipientEmail: 'sales@recipient.example',
            createdBy: randomUUID(),
          },
        });
        proposalId = proposal.id;
      });

      it('不正な kind は拒否される', async () => {
        await expect(
          owner.proposalEvent.create({
            data: { tenantId: TENANT_A, proposalId, kind: 'BOGUS' },
          }),
        ).rejects.toThrow(/proposal_events_kind_check/);
      });

      it('不正な from_state は拒否される', async () => {
        await expect(
          owner.proposalEvent.create({
            data: { tenantId: TENANT_A, proposalId, kind: 'STATE', fromState: 'BOGUS' },
          }),
        ).rejects.toThrow(/proposal_events_from_state_check/);
      });

      it('不正な to_state は拒否される', async () => {
        await expect(
          owner.proposalEvent.create({
            data: { tenantId: TENANT_A, proposalId, kind: 'STATE', toState: 'BOGUS' },
          }),
        ).rejects.toThrow(/proposal_events_to_state_check/);
      });

      it('対照: 許容値の組み合わせは成立する', async () => {
        const event = await owner.proposalEvent.create({
          data: {
            tenantId: TENANT_A,
            proposalId,
            kind: 'STATE',
            fromState: 'DRAFT',
            toState: 'GATE_RUNNING',
          },
        });
        expect(event.kind).toBe('STATE');
      });

      it('from_state / to_state 未指定（null）は CHECK を通る（nullable 列は NULL を許容する）', async () => {
        const event = await owner.proposalEvent.create({
          data: { tenantId: TENANT_A, proposalId, kind: 'NOTE', note: 'メモ' },
        });
        expect(event.fromState).toBeNull();
        expect(event.toState).toBeNull();
      });
    });

    describe('review_gates_target_type_check / execution_check / verdict チェック（docs/05 §3.6）', () => {
      it('不正な target_type は拒否される', async () => {
        await expect(
          owner.reviewGate.create({
            data: {
              tenantId: TENANT_A,
              targetType: 'BOGUS',
              targetId: randomUUID(),
              contentHash: 'hash',
              piiVerdict: 'PASS',
              commerceVerdict: 'PASS',
              consistencyVerdict: 'PASS',
              findings: [],
              aiWarnings: [],
              executedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/review_gates_target_type_check/);
      });

      it('🔴 対照: CONTRACT_DOCUMENT は許容値である（決定済み。Issue #15 / BR-15）', async () => {
        const gate = await owner.reviewGate.create({
          data: {
            tenantId: TENANT_A,
            targetType: 'CONTRACT_DOCUMENT',
            targetId: randomUUID(),
            contentHash: 'hash-contract-doc',
            piiVerdict: 'PASS',
            commerceVerdict: 'PASS',
            consistencyVerdict: 'PASS',
            findings: [],
            aiWarnings: [],
            executedAt: new Date(),
          },
        });
        expect(gate.targetType).toBe('CONTRACT_DOCUMENT');
      });

      it('不正な execution は拒否される', async () => {
        // 🔴 pii/commerce/executedAt/heldSince をあえて渡さない: これらを渡すと execution='BOGUS'
        //    は 'DONE' でも 'HELD_AI_COST_LIMIT' でもないため review_gates_done_requires_verdicts_check /
        //    review_gates_held_requires_since_check も同時に FALSE になり、Postgres がどちらの
        //    CHECK 違反を報告するかが宣言順に依存しなくなる（CHECK の評価順は宣言順とは限らない。
        //    実測でも制約名の辞書順に近い順で評価された）。目的の execution_check だけを
        //    単独で違反させるため、他の CHECK が「両辺 false で通る」条件に揃える。
        await expect(
          owner.reviewGate.create({
            data: {
              tenantId: TENANT_A,
              targetType: 'PROPOSAL',
              targetId: randomUUID(),
              contentHash: 'hash',
              execution: 'BOGUS',
              consistencyVerdict: 'PASS',
              findings: [],
              aiWarnings: [],
            },
          }),
        ).rejects.toThrow(/review_gates_execution_check/);
      });

      it('不正な pii_verdict / commerce_verdict / consistency_verdict は拒否される', async () => {
        await expect(
          owner.reviewGate.create({
            data: {
              tenantId: TENANT_A,
              targetType: 'PROPOSAL',
              targetId: randomUUID(),
              contentHash: 'hash',
              piiVerdict: 'BOGUS',
              commerceVerdict: 'PASS',
              consistencyVerdict: 'PASS',
              findings: [],
              aiWarnings: [],
              executedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/review_gates_pii_verdict_check/);

        await expect(
          owner.reviewGate.create({
            data: {
              tenantId: TENANT_A,
              targetType: 'PROPOSAL',
              targetId: randomUUID(),
              contentHash: 'hash',
              piiVerdict: 'PASS',
              commerceVerdict: 'BOGUS',
              consistencyVerdict: 'PASS',
              findings: [],
              aiWarnings: [],
              executedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/review_gates_commerce_verdict_check/);

        await expect(
          owner.reviewGate.create({
            data: {
              tenantId: TENANT_A,
              targetType: 'PROPOSAL',
              targetId: randomUUID(),
              contentHash: 'hash',
              piiVerdict: 'PASS',
              commerceVerdict: 'PASS',
              consistencyVerdict: 'BOGUS',
              findings: [],
              aiWarnings: [],
              executedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/review_gates_consistency_verdict_check/);
      });
    });

    describe('🔴 review_gates_done_requires_verdicts_check（docs/05 §3.6。execution=DONE のときのみ判定 3 点が確定する）', () => {
      it('DONE なのに pii_verdict / commerce_verdict / executed_at が欠けると拒否される', async () => {
        await expect(
          owner.reviewGate.create({
            data: {
              tenantId: TENANT_A,
              targetType: 'PROPOSAL',
              targetId: randomUUID(),
              contentHash: 'hash',
              consistencyVerdict: 'PASS',
              findings: [],
              aiWarnings: [],
              // piiVerdict / commerceVerdict / executedAt を渡さない（execution は既定 DONE）。
            },
          }),
        ).rejects.toThrow(/review_gates_done_requires_verdicts_check/);
      });
    });

    describe('🔴 review_gates_held_requires_since_check + 部分 UNIQUE（docs/05 §3.6 / §9.3。HELD 行は対象ごとに 1 行）', () => {
      it('HELD_AI_COST_LIMIT なのに held_since が無いと拒否される', async () => {
        await expect(
          owner.reviewGate.create({
            data: {
              tenantId: TENANT_A,
              targetType: 'PROPOSAL',
              targetId: randomUUID(),
              contentHash: 'hash',
              execution: 'HELD_AI_COST_LIMIT',
              consistencyVerdict: 'PASS',
              findings: [],
              aiWarnings: [],
            },
          }),
        ).rejects.toThrow(/review_gates_held_requires_since_check/);
      });

      it('対照: held_since があれば成立する（pii/commerce/executed_at は未判定のまま NULL）', async () => {
        const target = randomUUID();
        const gate = await owner.reviewGate.create({
          data: {
            tenantId: TENANT_A,
            targetType: 'PROPOSAL',
            targetId: target,
            contentHash: 'hash-held',
            execution: 'HELD_AI_COST_LIMIT',
            heldSince: new Date(),
            consistencyVerdict: 'PASS',
            findings: [],
            aiWarnings: [],
          },
        });
        expect(gate.execution).toBe('HELD_AI_COST_LIMIT');
        expect(gate.piiVerdict).toBeNull();
        expect(gate.commerceVerdict).toBeNull();
        expect(gate.executedAt).toBeNull();
      });

      it('🔴 部分 UNIQUE: 同一対象への 2 件目の保留行（execution <> DONE）は拒否される', async () => {
        const target = randomUUID();
        await owner.reviewGate.create({
          data: {
            tenantId: TENANT_A,
            targetType: 'PROJECT_PUBLISH',
            targetId: target,
            contentHash: 'hash-a',
            execution: 'HELD_AI_COST_LIMIT',
            heldSince: new Date(),
            consistencyVerdict: 'PASS',
            findings: [],
            aiWarnings: [],
          },
        });
        await expect(
          owner.reviewGate.create({
            data: {
              tenantId: TENANT_A,
              targetType: 'PROJECT_PUBLISH',
              targetId: target,
              contentHash: 'hash-b',
              execution: 'HELD_AI_COST_LIMIT',
              heldSince: new Date(),
              consistencyVerdict: 'PASS',
              findings: [],
              aiWarnings: [],
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });

      it('対照: 同一対象でも DONE 行は複数許される（部分 UNIQUE は execution <> DONE のみを対象にする）', async () => {
        const target = randomUUID();
        await owner.reviewGate.create({
          data: {
            tenantId: TENANT_A,
            targetType: 'CHAT_ATTACHMENT',
            targetId: target,
            contentHash: 'hash-c1',
            piiVerdict: 'PASS',
            commerceVerdict: 'PASS',
            consistencyVerdict: 'PASS',
            findings: [],
            aiWarnings: [],
            executedAt: new Date(),
          },
        });
        const second = await owner.reviewGate.create({
          data: {
            tenantId: TENANT_A,
            targetType: 'CHAT_ATTACHMENT',
            targetId: target,
            contentHash: 'hash-c2',
            piiVerdict: 'FAIL',
            commerceVerdict: 'PASS',
            consistencyVerdict: 'PASS',
            findings: [],
            aiWarnings: [],
            executedAt: new Date(),
          },
        });
        expect(second.id).toBeTruthy();
      });
    });
  });
});
