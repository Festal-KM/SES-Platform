// packages/db/src/platform/queries/demo-seed.ts
// `A-012` デモ環境の合成データ管理（docs/04 §A-012 / docs/05 §6.9 API-A16 / §13.6 / `F-053`）。T-10-06。
//
// 🔴 画面 1 対 1 の専用クエリ（docs/05 §5.2）。ここが返すのは**件数・状態・日時と、`demo` プリセットのテナント名**だけである
//    （`tenants.name` は `A-002` と同じく運営者に見せる列。`docs/04` §A-012「投入状況」の 6 項目）。
//    エンジニアの氏名・提案の本文・単価には到達しない（`tests/static/admin-no-content-reach.test.ts` が走査する）。
// 🔴 **投入そのもの**（`runSeed`）はここに無い。合成データの書き込みは `withPlatformWrite` の 7 ドメインの外（特権接続）であり、
//    この関数は「投入の前後に状況を読む」ことと「その読み取り・投入を `AuditLog` に残す」ことだけを担う。
//    `action` を引数で受けるのは、`POST`（投入）の直後に**同じトランザクションで** `admin.demo.seed` を残し、`GET` は
//    `admin.demo.view` を残すためである（どちらも `withPlatformRead` = 監査の先行。§5.3）。
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import { withPlatformRead, type PlatformAction, type PlatformReadDb } from '../../platform.js';

/** `A-012` の「現在の投入状況」の 1 テナント分。 */
export type DemoSeedTenantStatus = {
  readonly tenantId: string;
  /** 合成の商号（`株式会社サンプルアルファ` 等。`A-002` と同じ列）。 */
  readonly name: string;
  readonly lifecycleState: string;
  readonly partnerCompanyCount: number;
  readonly engineerCount: number;
  readonly projectCount: number;
  /** 進行中の提案（`WON` / `LOST` / `WITHDRAWN` / `SUBMIT_FAILED` を除く）。 */
  readonly proposalInProgressCount: number;
  /** 満了が近い稼働（`ACTIVE` かつ `end_date` が `withinDays` 日以内）。 */
  readonly assignmentExpiringCount: number;
  /** ゲートで止まっている提案（`GATE_FAILED`）。 */
  readonly gateFailedProposalCount: number;
  /** 匿名共有が有効な候補（`engineer_shares.revoked_at IS NULL`）。 */
  readonly sharedEngineerCount: number;
};

export type DemoSeedStatus =
  | { readonly seeded: false; readonly tenants: readonly [] }
  | {
      readonly seeded: true;
      /** 「実行日 = T」（プリセットが `tenants.lifecycle_changed_at` に書いた値の最大）。 */
      readonly seededAt: string;
      readonly tenants: readonly DemoSeedTenantStatus[];
    };

export type DemoSeedStatusQuery = {
  /** 🔴 `demo` プリセットのテナント ID（`@ses/db/seed` の `DEMO_SEED_IDS`）。呼び出し側が渡す（この層は seed を import しない）。 */
  readonly tenantIds: readonly string[];
  /** 「満了が近い」の閾値（日）。`assignment.expiry-scan` の 60 日に合わせる。 */
  readonly expiringWithinDays: number;
};

export type DemoSeedStatusMeta = {
  readonly ipAddress?: string | null;
  readonly now?: Date;
  /**
   * 記録する操作。`GET` は `admin.demo.view`、投入直後の読み返しは `admin.demo.seed`（投入を運営者の操作として残す）。
   * 🔴 2 値に閉じる（他の action をこの関数から書けない）。
   */
  readonly action: Extract<PlatformAction, 'admin.demo.view' | 'admin.demo.seed'>;
  /**
   * `admin.demo.seed` のとき: `REQUESTED` = 投入の**前**（監査の先行。何も書いていない）/ `COMPLETED` = 投入の**後**。
   * 🔴 前後の 2 行を同じ action で残し、`phase` で区別する（途中で失敗しても要求の記録が残る）。
   */
  readonly phase?: 'REQUESTED' | 'COMPLETED';
  /** `phase='COMPLETED'` のとき、`runSeed` の帰結（`SEEDED` / `ALREADY_SEEDED`）を `summary` に載せる。 */
  readonly outcome?: 'SEEDED' | 'ALREADY_SEEDED';
};

const IN_PROGRESS_EXCLUDED_STATES = ['WON', 'LOST', 'WITHDRAWN', 'SUBMIT_FAILED'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

async function countsFor(db: PlatformReadDb, tenantId: string, now: Date, withinDays: number): Promise<Omit<DemoSeedTenantStatus, 'tenantId' | 'name' | 'lifecycleState'>> {
  const horizon = new Date(now.getTime() + withinDays * DAY_MS);
  const [partnerCompanyCount, engineerCount, projectCount, proposalInProgressCount, assignmentExpiringCount, gateFailedProposalCount, sharedEngineerCount] =
    await Promise.all([
      db.partnerCompany.count({ where: { tenantId } }),
      db.engineer.count({ where: { tenantId } }),
      db.project.count({ where: { tenantId } }),
      db.proposal.count({ where: { tenantId, state: { notIn: [...IN_PROGRESS_EXCLUDED_STATES] } } }),
      db.assignment.count({ where: { tenantId, state: 'ACTIVE', endDate: { lte: horizon } } }),
      db.proposal.count({ where: { tenantId, state: 'GATE_FAILED' } }),
      db.engineerShare.count({ where: { tenantId, revokedAt: null } }),
    ]);
  return {
    partnerCompanyCount,
    engineerCount,
    projectCount,
    proposalInProgressCount,
    assignmentExpiringCount,
    gateFailedProposalCount,
    sharedEngineerCount,
  };
}

/**
 * `A-012` の投入状況を読む（🔴 閲覧そのものが `AuditLog` に残る。`F-055 AC-4` / `BR-41`）。
 *
 * 🔴 `targetTenantId: null`（横断）。対象は `query.tenantIds`（`demo` プリセットの 2 テナント）に限り、他のテナントの件数を返さない。
 */
export async function readDemoSeedStatus(
  ctx: AuthenticatedPlatformCtx,
  query: DemoSeedStatusQuery,
  meta: DemoSeedStatusMeta,
): Promise<DemoSeedStatus> {
  const now = meta.now ?? new Date();
  return withPlatformRead(
    {
      ctx,
      action: meta.action,
      targetTenantId: null,
      summary: {
        preset: 'demo',
        tenantCount: query.tenantIds.length,
        ...(meta.phase === undefined ? {} : { phase: meta.phase }),
        ...(meta.outcome === undefined ? {} : { outcome: meta.outcome }),
      },
      ipAddress: meta.ipAddress ?? null,
    },
    async (db): Promise<DemoSeedStatus> => {
      const tenants = await db.tenant.findMany({
        where: { id: { in: [...query.tenantIds] } },
        select: { id: true, name: true, lifecycleState: true, lifecycleChangedAt: true },
        orderBy: [{ id: 'asc' }],
      });
      // 🔴 「投入済み」はプリセットの全テナントが揃っているときだけ（`readSeedPresence` と同じ判定）。
      if (tenants.length === 0 || tenants.length !== query.tenantIds.length) return { seeded: false, tenants: [] };
      const seededAt = tenants.reduce(
        (latest, row) => (row.lifecycleChangedAt > latest ? row.lifecycleChangedAt : latest),
        tenants[0]?.lifecycleChangedAt ?? now,
      );
      const rows: DemoSeedTenantStatus[] = [];
      for (const tenant of tenants) {
        rows.push({
          tenantId: tenant.id,
          name: tenant.name,
          lifecycleState: tenant.lifecycleState,
          ...(await countsFor(db, tenant.id, now, query.expiringWithinDays)),
        });
      }
      return { seeded: true, seededAt: seededAt.toISOString(), tenants: rows };
    },
  );
}
