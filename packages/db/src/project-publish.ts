// packages/db/src/project-publish.ts
// 🔴 案件の公開（越境経路 1）の**ゲート待ち → 確定**（docs/05 §11.11 / `F-014` / `F-020 AC-1`）。T-07-09。
//
// ============================================================================
// 🔴 このファイルが持っている 2 つのこと
// ============================================================================
//   ① **「これから公開する相手」を保持する**（`ProjectPublishRequest`）
//      —— `project_visibilities.review_gate_id` は NOT NULL なので、ゲート PASS より前に
//         公開先を置ける場所が無い。置かないとゲートは「すでに公開済みの相手」しか
//         公開範囲として知らず、**新規公開先の社名が公開文に出ていても他社名として
//         検出されない**（`F-014 AC-3` が素通りする。docs/05 §11.9 ⑧-5 の申し送り）。
//   ② 🔴 **`project_visibilities` の行を作る唯一の場所**（`settleProjectPublish`）
//      —— 作れるのは「全層 PASS のゲート結果を手にしたワーカー」だけである。
//         `apps/web`（#28）は**解除（`revoked_at` を入れる）しかしない**。
//         `apps/web` と `apps/worker` は相互に import できない（`CLAUDE.md` §2.1）ので、
//         共有点は `packages/db` しか無い。
//
// ============================================================================
// 🔴 消費は (project_id, content_hash) の CAS である
// ============================================================================
// 公開要求は案件ごとに 1 行で、差し替えは UPDATE である。ワーカーは**自分が実行した内容の
// ハッシュと一致する行だけ**を消費するので、差し替え前の古い実行は何も公開しないまま終わる
// （`ReviewGate` の行は残るが、それは「その内容を検査した」という事実であって公開ではない）。

import { Prisma } from '@prisma/client';
import type { GateVerdict } from '@ses/domain';
import { writeAuditLog } from './audit.js';
import type { SystemTenantCtx } from './context.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction, withTenant } from './with-tenant.js';

/** `withTenant` が `fn` に渡すクライアントのうち、公開要求の書き込みに要るものだけ。 */
type TenantDbArg = Parameters<Parameters<typeof withTenant<void>>[1]>[0];
export type ProjectPublishRequestWriter = Pick<TenantDbArg, 'projectPublishRequest'>;

/**
 * docs/05 §16.1 の `project.visibility_change`（`F-014 AC-5`）。
 *
 * 🔴 **`apps/web`（#28）と同じ action である。** 公開の 1 サイクルは「要求（`pending`）→ 確定
 *    （`published` / `blocked`）」の 2 行で 1 つの物語になり、`S-041` の同じフィルタで並ぶ。
 *    ワーカー側だけ独自 action にすると、**「公開範囲の変更」で検索したときに、
 *    実際に公開が成立した行だけが出てこない**（`BR-27`）。
 */
export const PROJECT_VISIBILITY_AUDIT_ACTION = 'project.visibility_change';

/** `AuditLog.summary.operation`。🔴 ゲート結果による確定（`gate.run` の `GATE_RESULT` と同じ形）。 */
export const PROJECT_PUBLISH_SETTLE_OPERATION = 'GATE_RESULT';

/** ゲート待ちの公開要求（ジョブが読む形）。 */
export type PendingProjectPublish = {
  readonly projectId: string;
  /** 🔴 これから公開する相手だけ（すでに公開中の相手は含まない）。 */
  readonly partnerCompanyIds: readonly string[];
  readonly contentHash: string;
  readonly requestedBy: string;
};

export type ProjectPublishRequestInput = {
  readonly projectId: string;
  readonly partnerCompanyIds: readonly string[];
  readonly contentHash: string;
  readonly requestedAt: Date;
  readonly requestedBy: string;
};

/**
 * 🔴 公開要求を置く / 差し替える（#28 の業務トランザクションの内側で呼ぶ）。
 *
 * 🔴 **案件ごとに 1 行**（`@@unique(tenant_id, project_id)`）。積み上げないのは、
 *    「どの要求が生きているか」が 2 行以上あると決まらなくなるためである。
 *    先に出した要求のゲートが後から完了しても、`content_hash` が違えば消費できない
 *    （＝ 古い要求では公開が成立しない）。
 * 🔴 `requestedBy` は `ProjectVisibility.published_by` になる —— 公開したのはワーカーではなく、
 *    公開範囲を決めた利用者である（`F-014 AC-5` の「実施者」）。
 */
export async function upsertProjectPublishRequest(
  db: ProjectPublishRequestWriter,
  tenantId: string,
  input: ProjectPublishRequestInput,
): Promise<void> {
  const values = {
    partnerCompanyIds: [...input.partnerCompanyIds],
    contentHash: input.contentHash,
    requestedAt: input.requestedAt,
    requestedBy: input.requestedBy,
  };
  await db.projectPublishRequest.upsert({
    where: { tenantId_projectId: { tenantId, projectId: input.projectId } },
    // 🔴 分離キーは呼び出し側の引数ではなく Prisma 拡張が文脈の値で確定させる。
    //    値が文脈と違えば拡張が例外にする（`CLAUDE.md` §3.1）。
    create: { tenantId, projectId: input.projectId, ...values },
    update: values,
  });
}

/**
 * 🔴 ゲート待ちの公開要求を**取り下げる**（`#28` の要求に新しい公開先が 1 件も無いとき）。
 *
 * 🔴 **これが無いと、取り下げたはずの公開が後から成立する**: 「A に公開」→（ゲート実行前に）
 *    「やっぱり誰にも公開しない」と操作しても、先に置いた公開要求が残っていれば、
 *    走り出していたジョブがそれを消費して A に公開してしまう。公開要求は**常に最後の要求**を
 *    表していなければならない。
 * 🔴 取り下げても `ReviewGate` は消さない（検査した事実は残る）。消えるのは「公開する意思」だけである。
 */
export async function withdrawProjectPublishRequest(
  db: ProjectPublishRequestWriter,
  projectId: string,
): Promise<void> {
  await db.projectPublishRequest.deleteMany({ where: { projectId } });
}

/**
 * ゲート待ちの公開要求を読む（`gate.run` が `GateInput` を組み立てるために使う）。
 *
 * 🔴 引数の `db` はすでに開いているトランザクションのクライアントである（`loadGateInput` と
 *    同じトランザクションで読む）。別トランザクションで読むと、検査した公開先と
 *    確定する公開先がずれうる。
 */
export async function readProjectPublishRequest(
  db: Pick<TenantDbArg, 'projectPublishRequest'>,
  projectId: string,
): Promise<PendingProjectPublish | null> {
  const row = await db.projectPublishRequest.findFirst({
    where: { projectId },
    select: { projectId: true, partnerCompanyIds: true, contentHash: true, requestedBy: true },
  });
  return row === null
    ? null
    : {
        projectId: row.projectId,
        partnerCompanyIds: row.partnerCompanyIds,
        contentHash: row.contentHash,
        requestedBy: row.requestedBy,
      };
}

/**
 * 公開の確定の帰結。
 *
 * - `PUBLISHED` … 全層 PASS だったので公開範囲の行を確定させた
 * - 🔴 `BLOCKED` … 1 層でも FAIL。**要求を消費したうえで 1 行も公開しない**（`F-014 AC-3`）
 * - `NOT_PENDING` … その内容の公開要求がもう無い（差し替えられた / 既に確定した / 別の実行が消費した）
 */
export type ProjectPublishSettlement =
  | { readonly kind: 'PUBLISHED' | 'BLOCKED'; readonly partnerCompanyIds: readonly string[] }
  | { readonly kind: 'NOT_PENDING' };

export type ProjectPublishSettleInput = {
  readonly projectId: string;
  readonly contentHash: string;
  /** 確定した `ReviewGate` の ID（`project_visibilities.review_gate_id`）。 */
  readonly reviewGateId: string;
  readonly piiVerdict: GateVerdict;
  readonly commerceVerdict: GateVerdict;
  readonly consistencyVerdict: GateVerdict;
  readonly now: Date;
};

/**
 * 🔴 ゲート結果で公開を確定させる（`F-014` 処理② / `F-020 AC-1`）。
 *
 * 手順（1 トランザクション）:
 *   1. 🔴 **CAS** —— `(project_id, content_hash)` が一致する公開要求を**削除する**。
 *      0 件なら `NOT_PENDING`（差し替えられたか、別の実行が先に消費した）。**何も公開しない。**
 *   2. 1 層でも FAIL なら**行を 1 つも作らずに**監査を残して `BLOCKED`。
 *   3. 全層 PASS なら公開先ごとに `project_visibilities` を確定させる。
 *      🔴 **INSERT ではなく upsert である**（`@@unique(tenant_id, project_id, partner_company_id)`）。
 *      解除された行は**消えていない**（`revoked_at` を入れただけ。T-06-07 の決着）ので、
 *      再公開は `revoked_at` を NULL に戻す UPDATE になる。素の INSERT だと一意制約で落ち、
 *      **一度解除した相手には二度と公開できない**。
 *   4. 監査ログを 1 行（#28 の `pending` と対になる `published` / `blocked`。`F-014 AC-5`）。
 *
 * 🔴 **判定そのものをここで作らない。** 引数は確定済みの 3 層の判定であり、この関数に
 *    「FAIL を無視して公開する」経路は無い（`BR-18` / `F-020 AC-2`）。
 */
export async function settleProjectPublish(
  ctx: SystemTenantCtx,
  input: ProjectPublishSettleInput,
): Promise<ProjectPublishSettlement> {
  const passed =
    input.piiVerdict === 'PASS' &&
    input.commerceVerdict === 'PASS' &&
    input.consistencyVerdict === 'PASS';

  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx): Promise<ProjectPublishSettlement> => {
      const pending = await tx.projectPublishRequest.findFirst({
        where: { projectId: input.projectId, contentHash: input.contentHash },
        select: { id: true, partnerCompanyIds: true, requestedBy: true },
      });
      if (pending === null) return { kind: 'NOT_PENDING' };

      // 1. CAS（同じ行を 2 つの実行が消費しない）。
      const consumed = await tx.projectPublishRequest.deleteMany({
        where: { id: pending.id, contentHash: input.contentHash },
      });
      if (consumed.count !== 1) return { kind: 'NOT_PENDING' };

      const partnerCompanyIds = [...pending.partnerCompanyIds].sort();

      if (passed) {
        for (const partnerCompanyId of partnerCompanyIds) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO project_visibilities
              (id, tenant_id, project_id, partner_company_id, published_at, published_by,
               revoked_at, review_gate_id)
            VALUES
              (${uuidV7(input.now)}::uuid, ${ctx.tenantId}::uuid, ${input.projectId}::uuid,
               ${partnerCompanyId}::uuid, ${input.now}::timestamptz, ${pending.requestedBy}::uuid,
               NULL, ${input.reviewGateId}::uuid)
            ON CONFLICT (tenant_id, project_id, partner_company_id) DO UPDATE SET
              revoked_at = NULL,
              published_at = EXCLUDED.published_at,
              published_by = EXCLUDED.published_by,
              review_gate_id = EXCLUDED.review_gate_id
          `);
        }
      }

      // 🔴 記録は業務トランザクションの内側（書けなければ公開そのものが巻き戻る。`F-014 AC-5`）。
      // 🔴 `summary` に載せるのは ID・列挙値・件数だけ（社名・案件名・公開文を載せない。§16.2）。
      await writeAuditLog(tx, {
        action: PROJECT_VISIBILITY_AUDIT_ACTION,
        actorKind: 'SYSTEM',
        targetType: 'Project',
        targetId: input.projectId,
        summary: {
          operation: PROJECT_PUBLISH_SETTLE_OPERATION,
          verdict: passed ? 'PUBLISHED' : 'BLOCKED',
          // 🔴 #28 の `pending` と同じ並び（ID の昇順）で書く。連鎖が読めなくなるため。
          published: passed ? partnerCompanyIds.join(',') : '',
          blocked: passed ? '' : partnerCompanyIds.join(','),
          reviewGateId: input.reviewGateId,
          piiVerdict: input.piiVerdict,
          commerceVerdict: input.commerceVerdict,
          consistencyVerdict: input.consistencyVerdict,
        },
      });

      return { kind: passed ? 'PUBLISHED' : 'BLOCKED', partnerCompanyIds };
    },
  );
}
