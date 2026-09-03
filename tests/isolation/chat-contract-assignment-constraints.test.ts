// tests/isolation/chat-contract-assignment-constraints.test.ts
// T-02-04（docs/sprints/SP-02-schema-isolation.md）: docs/05 §3.7「チャット・契約・稼働」で
// 追加した 9 表（chat_threads / thread_participants / messages / contracts /
// contract_documents / contract_templates / orders / assignments / extension_reviews）+
// 当事者列（counterparty_partner_company_id。CLAUDE.md §3.1-5 の経路 5）について、
//   ① ENABLE + FORCE ROW LEVEL SECURITY が入っており、所有者（app_migrator）からは
//      1 行も見えない・書けないこと（T-02-06 でポリシーは `TO app_tenant` で本適用済み）
//      （fail-closed。C2/C5/C6 のポリシー本体は T-02-06 で適用済み。C9 と射影ビュー 4 本は T-02-07）
//   ② migration.sql に手で追加した CHECK 制約 / FK / 部分 UNIQUE / トリガが実際に機能すること
//   ③ 当事者列が assignments / contracts / contract_documents / orders の 4 表だけに存在し、
//      他の 5 表（chat_threads / thread_participants / messages / contract_templates /
//      extension_reviews）には無いこと（軽量な対照。DB 全体を対象にした本検証は T-02-09 の範囲）
// を検証する（tests/isolation/proposal-gate-constraints.test.ts と同じ方針）。
//
// 🔴 ②は RLS を一時的に DISABLE してテーブル所有者（app_migrator）接続で直接 INSERT を試みる。
//    PostgreSQL の FK 検証は RLS を経由しない（常にバイパスする）ため、参照先テーブル
//    （engineers / projects / proposals / review_gates 等）自体への RLS 適用有無は FK チェックの
//    成否に影響しない。DISABLE が要るのは「そのテーブル自身へ直接 INSERT する」ときだけである。
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createUnextendedClient,
  readTableColumns,
  readTableRlsStatus,
  setRowLevelSecurity,
  type UnextendedClient,
} from '@ses/db/testing';
import { ENGINEER_A_HOST, PARTNER_A1, TENANT_A } from './support/fixtures.js';
import { startIsolationDatabase, type IsolationDatabase } from './support/postgres.js';

const SETUP_TIMEOUT_MS = 600_000;

const NEW_TABLES = [
  'chat_threads',
  'thread_participants',
  'messages',
  'contracts',
  'contract_documents',
  'contract_templates',
  'orders',
  'assignments',
  'extension_reviews',
] as const;

// 🔴 docs/05 §3.1 共通規約 / CLAUDE.md §3.1-5: 経路 5 の対象はこの 4 表だけ。
const COUNTERPARTY_COLUMN_TABLES = ['assignments', 'contracts', 'contract_documents', 'orders'] as const;

describe('T-02-04: docs/05 §3.7 の新 9 表 + 当事者列', () => {
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

  it('① 全 9 表で RLS が有効かつ FORCE されている（docs/05 §4.1 第 1 防御。既定は fail-closed）', async () => {
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
    const rows = await owner.contract.findMany();
    expect(rows).toEqual([]);
  });

  it('① 所有者（app_migrator）接続に適用されるポリシーが無いため INSERT は拒否される', async () => {
    await expect(
      owner.chatThread.create({
        data: { tenantId: TENANT_A, kind: 'COMPANY', partnerCompanyId: PARTNER_A1 },
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('③ 当事者列（counterparty_partner_company_id）は 4 表だけに存在する（軽量な対照。DB 全体の走査は T-02-09）', async () => {
    for (const table of NEW_TABLES) {
      const columns = await readTableColumns(owner, table);
      const hasColumn = columns.includes('counterparty_partner_company_id');
      const expected = (COUNTERPARTY_COLUMN_TABLES as readonly string[]).includes(table);
      expect(hasColumn, `${table}: counterparty_partner_company_id の有無が期待と不一致`).toBe(expected);
    }
  });

  it('③ 対照: extension_reviews は当事者列を持たない（BR-67。ホスト内部の検討内容は経路 5 の対象外）', async () => {
    const columns = await readTableColumns(owner, 'extension_reviews');
    expect(columns).not.toContain('counterparty_partner_company_id');
  });

  describe('② CHECK 制約 / FK / 部分 UNIQUE / トリガ（RLS を一時 DISABLE して直接検証）', () => {
    // 🔴 projects / proposals / review_gates は T-02-02/03 から fail-closed（0 ポリシー）。
    //    参照先の行を用意するために disable する（FK 検証自体は RLS を経由しないため本来は
    //    disable 不要だが、engineers は T-02-08 の継承トリガ〔assignments ← engineers〕が
    //    SELECT を発行するため、こちらは RLS の対象になる。disable しないと
    //    owner.assignment.create() が「親が見えない」で毎回 RAISE する）。
    const TABLES_TO_DISABLE = [
      ...NEW_TABLES,
      'projects',
      'proposals',
      'review_gates',
      'engineers',
    ] as const;

    let projectId: string;

    beforeAll(async () => {
      await setRowLevelSecurity({
        ownerDatasourceUrl: database.migratorUrl,
        tables: [...TABLES_TO_DISABLE],
        enabled: false,
      });

      const project = await owner.project.create({
        data: { tenantId: TENANT_A, name: 'T-02-04 CHECK 制約検証用案件' },
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

    async function createProposal(): Promise<string> {
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
      return proposal.id;
    }

    async function createAssignment(overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
      const proposalId = await createProposal();
      return owner.assignment.create({
        data: {
          tenantId: TENANT_A,
          engineerId: ENGINEER_A_HOST,
          projectId,
          proposalId,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          ownerUserId: randomUUID(),
          ...overrides,
        },
      });
    }

    async function createReviewGate(targetType = 'CONTRACT_DOCUMENT'): Promise<string> {
      const gate = await owner.reviewGate.create({
        data: {
          tenantId: TENANT_A,
          targetType,
          targetId: randomUUID(),
          contentHash: `hash-${randomUUID()}`,
          piiVerdict: 'PASS',
          commerceVerdict: 'PASS',
          consistencyVerdict: 'PASS',
          findings: [],
          aiWarnings: [],
          executedAt: new Date(),
        },
      });
      return gate.id;
    }

    async function createContract(overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
      return owner.contract.create({
        data: {
          tenantId: TENANT_A,
          kind: 'INDIVIDUAL',
          counterpartyName: 'Counterparty Inc.',
          ...overrides,
        },
      });
    }

    describe('chat_threads_kind_check（docs/05 §3.7）+ UNIQUE(tenant, kind, project, partner)', () => {
      it('不正な kind は拒否される', async () => {
        await expect(
          owner.chatThread.create({
            data: { tenantId: TENANT_A, kind: 'BOGUS', partnerCompanyId: PARTNER_A1 },
          }),
        ).rejects.toThrow(/chat_threads_kind_check/);
      });

      it('対照: 許容値（COMPANY）は成立する', async () => {
        const thread = await owner.chatThread.create({
          data: { tenantId: TENANT_A, kind: 'COMPANY', partnerCompanyId: PARTNER_A1 },
        });
        expect(thread.kind).toBe('COMPANY');
      });

      it('🔴 F-038 AC-2 の下支え: 同一 (tenant, kind, project, partner) の 2 件目は拒否される', async () => {
        await owner.chatThread.create({
          data: { tenantId: TENANT_A, kind: 'PROJECT', projectId, partnerCompanyId: PARTNER_A1 },
        });
        await expect(
          owner.chatThread.create({
            data: { tenantId: TENANT_A, kind: 'PROJECT', projectId, partnerCompanyId: PARTNER_A1 },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });
    });

    describe('thread_participants（docs/05 §3.7。越境経路 3 の唯一の根拠）', () => {
      it('存在しない thread_id は拒否される（FK）', async () => {
        await expect(
          owner.threadParticipant.create({
            data: { tenantId: TENANT_A, threadId: randomUUID(), joinedAt: new Date() },
          }),
        ).rejects.toThrow(/foreign key constraint/i);
      });

      it('対照: 実在する thread_id と null（ホスト）の partner_company_id は成立する', async () => {
        const thread = await owner.chatThread.create({
          data: { tenantId: TENANT_A, kind: 'COMPANY', partnerCompanyId: PARTNER_A1 },
        });
        const participant = await owner.threadParticipant.create({
          data: { tenantId: TENANT_A, threadId: thread.id, joinedAt: new Date() },
        });
        expect(participant.partnerCompanyId).toBeNull();
      });
    });

    describe('messages_attachment_scan_status_check（docs/05 §3.4 ScanStatus を共有）', () => {
      let threadId: string;

      beforeAll(async () => {
        const thread = await owner.chatThread.create({
          data: { tenantId: TENANT_A, kind: 'COMPANY', partnerCompanyId: PARTNER_A1 },
        });
        threadId = thread.id;
      });

      it('不正な attachment_scan_status は拒否される', async () => {
        await expect(
          owner.message.create({
            data: {
              tenantId: TENANT_A,
              ownerPartnerCompanyId: PARTNER_A1,
              threadId,
              senderUserId: randomUUID(),
              body: 'x',
              attachmentScanStatus: 'BOGUS',
            },
          }),
        ).rejects.toThrow(/messages_attachment_scan_status_check/);
      });

      it('対照: 許容値（CLEAN）と未指定（null）はどちらも成立する', async () => {
        const withScan = await owner.message.create({
          data: {
            tenantId: TENANT_A,
            ownerPartnerCompanyId: PARTNER_A1,
            threadId,
            senderUserId: randomUUID(),
            body: 'x',
            attachmentScanStatus: 'CLEAN',
          },
        });
        expect(withScan.attachmentScanStatus).toBe('CLEAN');

        const withoutScan = await owner.message.create({
          data: {
            tenantId: TENANT_A,
            ownerPartnerCompanyId: PARTNER_A1,
            threadId,
            senderUserId: randomUUID(),
            body: 'y',
          },
        });
        expect(withoutScan.attachmentScanStatus).toBeNull();
      });

      it('review_gate_id は review_gates を参照する FK（不正な ID は拒否される）', async () => {
        await expect(
          owner.message.create({
            data: {
              tenantId: TENANT_A,
              ownerPartnerCompanyId: PARTNER_A1,
              threadId,
              senderUserId: randomUUID(),
              body: 'z',
              reviewGateId: randomUUID(),
            },
          }),
        ).rejects.toThrow(/foreign key constraint/i);
      });
    });

    describe('🔴 contracts_kind_check / contracts_state_check（docs/05 §3.7。CLAUDE.md §4.2 の 7 状態）', () => {
      it('不正な kind は拒否される', async () => {
        await expect(
          owner.contract.create({
            data: { tenantId: TENANT_A, kind: 'BOGUS', counterpartyName: 'X' },
          }),
        ).rejects.toThrow(/contracts_kind_check/);
      });

      it('不正な state は拒否される', async () => {
        await expect(
          owner.contract.create({
            data: { tenantId: TENANT_A, kind: 'NDA', state: 'BOGUS', counterpartyName: 'X' },
          }),
        ).rejects.toThrow(/contracts_state_check/);
      });

      it('対照: 許容値（既定 DRAFT）は成立する', async () => {
        const contract = await createContract();
        expect(contract.id).toBeTruthy();
      });
    });

    describe('🔴 contracts_counterparty_partner_company_id_fkey（docs/05 §4.4.1。当事者列の根。経路 5 の唯一の実体）', () => {
      it('存在しない counterparty_partner_company_id を指すと拒否される', async () => {
        await expect(
          owner.contract.create({
            data: {
              tenantId: TENANT_A,
              kind: 'INDIVIDUAL',
              counterpartyName: 'X',
              counterpartyPartnerCompanyId: randomUUID(),
            },
          }),
        ).rejects.toThrow(/foreign key constraint/i);
      });

      it('対照: 実在する counterparty_partner_company_id（PARTNER_A1）を指すと成立する', async () => {
        const contract = await createContract({ counterpartyPartnerCompanyId: PARTNER_A1 });
        expect(contract).toMatchObject({ counterpartyPartnerCompanyId: PARTNER_A1 });
      });

      it('対照: null（相手方がパートナーでない）も成立する', async () => {
        const contract = await createContract();
        expect(contract).toMatchObject({ counterpartyPartnerCompanyId: null });
      });
    });

    describe('🔴 contracts_executed_requires_executed_at_check（docs/05 §3.7）', () => {
      it('EXECUTED なのに executed_at が無いと拒否される', async () => {
        await expect(
          owner.contract.create({
            data: { tenantId: TENANT_A, kind: 'NDA', state: 'EXECUTED', counterpartyName: 'X' },
          }),
        ).rejects.toThrow(/contracts_executed_requires_executed_at_check/);
      });

      it('対照: executed_at があれば成立する', async () => {
        const contract = await owner.contract.create({
          data: {
            tenantId: TENANT_A,
            kind: 'NDA',
            state: 'EXECUTED',
            counterpartyName: 'X',
            executedAt: new Date(),
          },
        });
        expect(contract.state).toBe('EXECUTED');
      });
    });

    describe('🔴 assert_contract_executed_immutable（docs/05 §3.7 / F-047 AC-5。EXECUTED は書き換え不可）', () => {
      it('EXECUTED な契約の counterparty_name（対象外の列）を書き換えようとすると拒否される', async () => {
        const contract = await owner.contract.create({
          data: {
            tenantId: TENANT_A,
            kind: 'NDA',
            state: 'EXECUTED',
            counterpartyName: '訂正前',
            executedAt: new Date(),
          },
        });
        await expect(
          owner.contract.update({
            where: { id: contract.id },
            data: { counterpartyName: '訂正後' },
          }),
        ).rejects.toThrow(/変更できません/);
      });

      it('対照: state（EXPIRED への遷移）と expired_at は書き換えられる（許可列）', async () => {
        const contract = await owner.contract.create({
          data: {
            tenantId: TENANT_A,
            kind: 'NDA',
            state: 'EXECUTED',
            counterpartyName: '許可列のみ更新',
            executedAt: new Date(),
          },
        });
        const updated = await owner.contract.update({
          where: { id: contract.id },
          data: { state: 'EXPIRED', expiredAt: new Date() },
        });
        expect(updated.state).toBe('EXPIRED');
      });

      it('対照: EXECUTED でない契約は自由に書き換えられる（トリガは EXECUTED のときだけ働く）', async () => {
        const contract = await createContract({ state: 'DRAFT' });
        const updated = await owner.contract.update({
          where: { id: contract.id },
          data: { counterpartyName: '書き換え後' },
        });
        expect(updated.counterpartyName).toBe('書き換え後');
      });
    });

    describe('contract_documents（docs/05 §3.7。C9 は signed_at IS NOT NULL の版のみ）', () => {
      it('不正な scan_status / external_provider / sent_via は拒否される', async () => {
        const contract = await createContract();

        await expect(
          owner.contractDocument.create({
            data: { tenantId: TENANT_A, contractId: contract.id, version: 1, objectKey: 'k', scanStatus: 'BOGUS' },
          }),
        ).rejects.toThrow(/contract_documents_scan_status_check/);

        await expect(
          owner.contractDocument.create({
            data: {
              tenantId: TENANT_A,
              contractId: contract.id,
              version: 1,
              objectKey: 'k',
              externalProvider: 'BOGUS',
            },
          }),
        ).rejects.toThrow(/contract_documents_external_provider_check/);

        await expect(
          owner.contractDocument.create({
            data: { tenantId: TENANT_A, contractId: contract.id, version: 1, objectKey: 'k', sentVia: 'BOGUS' },
          }),
        ).rejects.toThrow(/contract_documents_sent_via_check/);
      });

      it('🔴 requested_at には review_gate_id が必須（F-047 処理⑥ / F-048 AC-3）', async () => {
        const contract = await createContract();
        await expect(
          owner.contractDocument.create({
            data: {
              tenantId: TENANT_A,
              contractId: contract.id,
              version: 1,
              objectKey: 'k',
              requestedAt: new Date(),
            },
          }),
        ).rejects.toThrow(/contract_documents_requested_at_requires_gate_check/);
      });

      it('対照: review_gate_id と一緒なら requested_at は成立する', async () => {
        const contract = await createContract();
        const gateId = await createReviewGate();
        const doc = await owner.contractDocument.create({
          data: {
            tenantId: TENANT_A,
            contractId: contract.id,
            version: 1,
            objectKey: 'k',
            reviewGateId: gateId,
            requestedAt: new Date(),
          },
        });
        expect(doc.requestedAt).not.toBeNull();
      });

      it('UNIQUE(tenant, contract, version): 同一契約の同一版は 2 件目が拒否される', async () => {
        const contract = await createContract();
        await owner.contractDocument.create({
          data: { tenantId: TENANT_A, contractId: contract.id, version: 1, objectKey: 'k1' },
        });
        await expect(
          owner.contractDocument.create({
            data: { tenantId: TENANT_A, contractId: contract.id, version: 1, objectKey: 'k2' },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });

      it('UNIQUE(external_provider, external_document_id): Webhook からの逆引きキーは重複できない', async () => {
        const contractA = await createContract();
        const contractB = await createContract();
        const externalDocumentId = `envelope-${randomUUID()}`;
        await owner.contractDocument.create({
          data: {
            tenantId: TENANT_A,
            contractId: contractA.id,
            version: 1,
            objectKey: 'k1',
            externalProvider: 'docusign',
            externalDocumentId,
          },
        });
        await expect(
          owner.contractDocument.create({
            data: {
              tenantId: TENANT_A,
              contractId: contractB.id,
              version: 1,
              objectKey: 'k2',
              externalProvider: 'docusign',
              externalDocumentId,
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });
    });

    describe('contract_templates（docs/05 §3.7 / F-048。BR-26）', () => {
      it('不正な kind / scan_status は拒否される', async () => {
        await expect(
          owner.contractTemplate.create({
            data: {
              tenantId: TENANT_A,
              name: `T-${randomUUID()}`,
              kind: 'BOGUS',
              version: 1,
              objectKey: 'k',
              placeholders: [],
              mapping: [],
              createdBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/contract_templates_kind_check/);

        await expect(
          owner.contractTemplate.create({
            data: {
              tenantId: TENANT_A,
              name: `T-${randomUUID()}`,
              kind: 'NDA',
              version: 1,
              objectKey: 'k',
              scanStatus: 'BOGUS',
              placeholders: [],
              mapping: [],
              createdBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/contract_templates_scan_status_check/);
      });

      it('🔴 is_latest=true は scan_status=CLEAN のときのみ成立する（BR-26）', async () => {
        const name = `T-${randomUUID()}`;
        await expect(
          owner.contractTemplate.create({
            data: {
              tenantId: TENANT_A,
              name,
              kind: 'NDA',
              version: 1,
              objectKey: 'k',
              scanStatus: 'SCANNING',
              isLatest: true,
              placeholders: [],
              mapping: [],
              createdBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/contract_templates_latest_requires_clean_check/);

        const template = await owner.contractTemplate.create({
          data: {
            tenantId: TENANT_A,
            name,
            kind: 'NDA',
            version: 1,
            objectKey: 'k',
            scanStatus: 'CLEAN',
            isLatest: true,
            placeholders: [],
            mapping: [],
            createdBy: randomUUID(),
          },
        });
        expect(template.isLatest).toBe(true);
      });

      it('🔴 部分 UNIQUE: 同一テナント・同一名で is_latest=true（かつ未アーカイブ）は高々 1 件', async () => {
        const name = `T-${randomUUID()}`;
        await owner.contractTemplate.create({
          data: {
            tenantId: TENANT_A,
            name,
            kind: 'NDA',
            version: 1,
            objectKey: 'k1',
            scanStatus: 'CLEAN',
            isLatest: true,
            placeholders: [],
            mapping: [],
            createdBy: randomUUID(),
          },
        });
        await expect(
          owner.contractTemplate.create({
            data: {
              tenantId: TENANT_A,
              name,
              kind: 'NDA',
              version: 2,
              objectKey: 'k2',
              scanStatus: 'CLEAN',
              isLatest: true,
              placeholders: [],
              mapping: [],
              createdBy: randomUUID(),
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });
    });

    describe('🔴 assignments_state_check + UNIQUE(proposal_id)（docs/05 §3.7。CLAUDE.md §4.2 の 5 状態）', () => {
      it('不正な state は拒否される', async () => {
        const proposalId = await createProposal();
        await expect(
          owner.assignment.create({
            data: {
              tenantId: TENANT_A,
              engineerId: ENGINEER_A_HOST,
              projectId,
              proposalId,
              state: 'BOGUS',
              startDate: new Date('2026-01-01'),
              endDate: new Date('2026-12-31'),
              ownerUserId: randomUUID(),
            },
          }),
        ).rejects.toThrow(/assignments_state_check/);
      });

      it('対照: 許容値（既定 SCHEDULED）は成立する', async () => {
        const assignment = await createAssignment();
        expect(assignment.id).toBeTruthy();
      });

      it('🔴 1 つの Proposal から生成できる Assignment は 1 件だけ（F-042 AC-1）', async () => {
        const proposalId = await createProposal();
        await owner.assignment.create({
          data: {
            tenantId: TENANT_A,
            engineerId: ENGINEER_A_HOST,
            projectId,
            proposalId,
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-12-31'),
            ownerUserId: randomUUID(),
          },
        });
        await expect(
          owner.assignment.create({
            data: {
              tenantId: TENANT_A,
              engineerId: ENGINEER_A_HOST,
              projectId,
              proposalId,
              startDate: new Date('2026-01-01'),
              endDate: new Date('2026-12-31'),
              ownerUserId: randomUUID(),
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });
    });

    describe('🔴 orders_payment_state_check / orders_contract_or_assignment_check（docs/05 §3.7。F-050 AC-1）', () => {
      it('不正な payment_state は拒否される', async () => {
        const assignment = await createAssignment();
        await expect(
          owner.order.create({
            data: {
              tenantId: TENANT_A,
              assignmentId: assignment.id,
              amount: '100000',
              periodStart: new Date('2026-01-01'),
              periodEnd: new Date('2026-01-31'),
              paymentState: 'BOGUS',
            },
          }),
        ).rejects.toThrow(/orders_payment_state_check/);
      });

      it('contract_id / assignment_id が両方 null だと拒否される', async () => {
        await expect(
          owner.order.create({
            data: {
              tenantId: TENANT_A,
              amount: '100000',
              periodStart: new Date('2026-01-01'),
              periodEnd: new Date('2026-01-31'),
              paymentState: 'UNPAID',
            },
          }),
        ).rejects.toThrow(/orders_contract_or_assignment_check/);
      });

      it('対照: assignment_id だけでも成立する', async () => {
        const assignment = await createAssignment();
        const order = await owner.order.create({
          data: {
            tenantId: TENANT_A,
            assignmentId: assignment.id,
            amount: '100000',
            periodStart: new Date('2026-01-01'),
            periodEnd: new Date('2026-01-31'),
            paymentState: 'UNPAID',
          },
        });
        expect(order.id).toBeTruthy();
      });

      it('対照: contract_id だけでも成立する', async () => {
        const contract = await createContract();
        const order = await owner.order.create({
          data: {
            tenantId: TENANT_A,
            contractId: contract.id,
            amount: '100000',
            periodStart: new Date('2026-01-01'),
            periodEnd: new Date('2026-01-31'),
            paymentState: 'PAID',
          },
        });
        expect(order.id).toBeTruthy();
      });
    });

    describe('extension_reviews_decision_check + UNIQUE(tenant, assignment, opened_at)（docs/05 §3.7）', () => {
      it('不正な decision は拒否される', async () => {
        const assignment = await createAssignment();
        await expect(
          owner.extensionReview.create({
            data: {
              tenantId: TENANT_A,
              assignmentId: assignment.id,
              openedAt: new Date(),
              ownerUserId: randomUUID(),
              facts: {},
              decision: 'BOGUS',
            },
          }),
        ).rejects.toThrow(/extension_reviews_decision_check/);
      });

      it('対照: 許容値（EXTEND）と未指定（null）はどちらも成立する', async () => {
        const assignment = await createAssignment();
        const withDecision = await owner.extensionReview.create({
          data: {
            tenantId: TENANT_A,
            assignmentId: assignment.id,
            openedAt: new Date('2026-01-01T00:00:00Z'),
            ownerUserId: randomUUID(),
            facts: {},
            decision: 'EXTEND',
          },
        });
        expect(withDecision.decision).toBe('EXTEND');

        const withoutDecision = await owner.extensionReview.create({
          data: {
            tenantId: TENANT_A,
            assignmentId: assignment.id,
            openedAt: new Date('2026-02-01T00:00:00Z'),
            ownerUserId: randomUUID(),
            facts: {},
          },
        });
        expect(withoutDecision.decision).toBeNull();
      });

      it('🔴 同一稼働・同一起票日時の 2 件目は拒否される（再起票は openedAt を変えて許す）', async () => {
        const assignment = await createAssignment();
        const openedAt = new Date('2026-03-01T00:00:00Z');
        await owner.extensionReview.create({
          data: {
            tenantId: TENANT_A,
            assignmentId: assignment.id,
            openedAt,
            ownerUserId: randomUUID(),
            facts: {},
          },
        });
        await expect(
          owner.extensionReview.create({
            data: {
              tenantId: TENANT_A,
              assignmentId: assignment.id,
              openedAt,
              ownerUserId: randomUUID(),
              facts: {},
            },
          }),
        ).rejects.toThrow(/Unique constraint failed/);
      });
    });
  });
});
