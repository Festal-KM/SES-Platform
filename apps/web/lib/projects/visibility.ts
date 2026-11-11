// 案件の公開先は認証済みホストが指定し、テナント内で即時に反映する。
// 公開先の判定は RLS の ProjectVisibility 行を根拠とする。
import {
  requireHost,
  withdrawProjectPublishRequest,
  withTenant,
  writeAuditLog,
  type AuditSummary,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { NotFoundError, ValidationError } from '../api/errors';
import { toJstIsoDay } from '../format/datetime';
import type { ProjectPublishGate } from './publish-gate';

/**
 * docs/05 §16.1 の `project.visibility_change`（`#28`）。
 * 🔴 **`project.update` に畳まない。** §16.1 が固有の action として列挙しており、`S-041` の
 *    操作種別フィルタでも `VISIBILITY_CHANGE`（`lib/audit-logs/categories.ts`）に割り当て済みで
 *    ある。畳むと `BR-27` の「公開範囲の変更」で検索したときに 0 件になる
 *    （`membership.role_change` を `*.update` にしないのと同じ理由）。
 */
export const PROJECT_VISIBILITY_AUDIT_ACTION = 'project.visibility_change';

/**
 * 🔴 T-12-10: `#28` が扱う公開要求の種類（docs/05 §11.11「T-12-10 の実装の決着」②）。
 *    **この経路は `RECHECK` の行に一切触らない。**
 */
const PROJECT_PUBLISH_REQUEST_KIND = 'PUBLISH' as const;

/**
 * 🔴 T-12-10: 人の操作による解除の `revoked_reason`（docs/05 §3.5）。
 *    **必ず書く** —— `revoked_at` だけを入れる書き方は CHECK が拒む。
 *    これが無いと `S-010` / `S-011` が「公開先 0 社」を**設定し忘れ**と**検査で落ちた**に
 *    読み分けられない（`F-014 AC-9`）。
 */
const MANUAL_REVOKE_REASON = 'MANUAL' as const;

/**
 * `#28` の応答の `verdict`（docs/05 §6.4 #28）。
 *
 * 🔴 **`PASS` / `FAIL` を持たない。** ゲートは非同期であり（docs/05 §12.1 / §11.1）、
 *    `PUT` の応答時点で合否は存在しない。ここが表すのは「**この要求で公開が成立したか**」
 *    ではなく「**公開の要求をどう扱ったか**」である。
 *   - `PUBLISHED` … 新しい公開先を追加した。
 *   - `NO_PUBLISH_REQUESTED` … 新しい公開先が無い（解除のみ / 変更なし）。ゲートは起動しない。
 */
export const PROJECT_VISIBILITY_VERDICTS = ['PUBLISHED', 'NO_PUBLISH_REQUESTED'] as const;

export type ProjectVisibilityVerdict = (typeof PROJECT_VISIBILITY_VERDICTS)[number];

/**
 * `#28` の応答（docs/05 §6.4 #28 の `{ reviewGateId, verdict }`）。
 * 🔴 `reviewGateId` は**現時点では常に `null`** である（`publish-gate.ts` の 🔴。
 *    `review_gates` には確定した行しか存在できないため、実行中を指す ID が無い）。
 */
export type ProjectVisibilityUpdateView = {
  readonly reviewGateId: string | null;
  readonly verdict: ProjectVisibilityVerdict;
};

/** `S-013` セクション 2 の選択肢 1 件（🔴 ホストだけが受け取る）。 */
export type ProjectVisibilityChoice = {
  readonly partnerCompanyId: string;
  readonly name: string;
  /** 停止中の取引先（`S-014` の「状態」と同じ事実）。🔴 選択は妨げない（下記の注記）。 */
  readonly suspended: boolean;
  /** 公開中なら公開日（`YYYY-MM-DD`。JST の暦日）、公開していなければ `null`。 */
  readonly publishedOn: string | null;
};

/** `#28` の入力（境界検証は `schemas.ts` の `projectVisibilityBodySchema`）。 */
export type ProjectVisibilityInput = {
  readonly partnerCompanyIds: readonly string[];
};

/** 監査ログに残す実行環境（`ProjectViewMeta` と同じ形 + 操作時刻）。 */
export type ProjectVisibilityMeta = {
  readonly ipAddress: string | null;
  /** 公開解除の時刻（`revoked_at`）。🔴 呼び出し側から渡す（`packages/domain` と同じ規律）。 */
  readonly now: Date;
};

/**
 * 公開先の集合の差分（🔴 **純粋関数**。ユニットテストが規則を固定する）。
 *
 * 🔴 **`added` と `revoked` は非対称に扱う**（`updateProjectVisibility` の中核）:
 *    - `revoked`（境界を**狭める**）… ゲートは要らない。公開をやめることは、外へ出る情報を
 *      増やさないためである。
 *    - `added`（境界を**広げる**）… ゲートを通るまで行にしない（`F-014 AC-3`）。
 * 🔴 出力はすべて**昇順にそろえる**（監査ログの `before` / `after` が入力順で揺れると、
 *    同じ変更が別の記録に見える）。
 */
export function diffProjectVisibility(
  current: readonly string[],
  requested: readonly string[],
): {
  readonly added: readonly string[];
  readonly kept: readonly string[];
  readonly revoked: readonly string[];
} {
  const currentSet = new Set(current);
  const requestedSet = new Set(requested);
  const sorted = (values: Iterable<string>): readonly string[] => [...values].sort();
  return {
    added: sorted([...requestedSet].filter((id) => !currentSet.has(id))),
    kept: sorted([...requestedSet].filter((id) => currentSet.has(id))),
    revoked: sorted([...currentSet].filter((id) => !requestedSet.has(id))),
  };
}

/** 1 回の要求が公開範囲に対して起こしたこと（`diffProjectVisibility` の結果 + 文脈）。 */
export type ProjectVisibilityChange = {
  /** 変更前の公開先（`revoked_at IS NULL` の集合）。 */
  readonly before: readonly string[];
  /** 変更後の公開先（＝ 現在も公開されている相手。`diffProjectVisibility` の `kept`）。 */
  readonly kept: readonly string[];
  /** 要求された集合（`after` との差が「ゲート待ち」である）。 */
  readonly requested: readonly string[];
  /** ゲートに預けた公開先（🔴 **まだ公開されていない**）。 */
  readonly added: readonly string[];
  readonly revoked: readonly string[];
  readonly verdict: ProjectVisibilityVerdict;
};

/**
 * 監査ログの `summary`（`F-014 AC-5`「実施者・**変更前後の公開先**」。T-06-07）。
 *
 * 🔴 **純粋関数として切り出す**（`diffProjectVisibility` と同じ理由）。ここが `AC-5` の
 *    「何を残すか」の唯一の定義であり、ユニットテストが**キー集合と値の形**を固定する。
 * 🔴 **載せてよいのは ID・列挙値だけである**（docs/05 §16.2 / `F-058`）。取引先の**社名**を
 *    載せない —— 運営者の監査ログ横断検索に出るためであり、戻り値の型（`AuditSummary`）も
 *    値を文字列・数値・真偽・`null` に限っている。
 * 🔴 **`after` は「変更後に公開されている相手」であって「要求された相手」ではない。**
 *    追加はゲートを通るまで行にならない（`F-014 AC-3`）ので `pending` に出る。ここを
 *    混ぜると、記録だけを見た人が「公開済み」と読み違える。
 * 🔴 いずれも **ID の昇順で連結する**（`diffProjectVisibility` が昇順にそろえている）。
 *    入力順で揺れると、同じ変更が別の記録に見えて連鎖（前の `after` = 次の `before`）が切れる。
 */
export function projectVisibilityAuditSummary(change: ProjectVisibilityChange): AuditSummary {
  return {
    before: change.before.join(','),
    after: change.requested.join(','),
    requested: change.requested.join(','),
    pending: '',
    revoked: change.revoked.join(','),
    verdict: change.verdict,
  };
}

/** `withTenant` が `fn` に渡すクライアントのうち、本モジュールが使うデリゲートだけ。 */
type VisibilityDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/**
 * 🔴 対象の案件が**この文脈から見えること**を確かめる（見えなければ 404）。
 *    母集団を絞るのは `projects` の RLS（C4）であり、ここに `where` を足さない
 *    （docs/05 §4.8「見えない ＝ 存在しない」）。
 */
async function requireVisibleProject(db: VisibilityDb, projectId: string): Promise<void> {
  const row = await db.project.findFirst({ where: { id: projectId }, select: { id: true } });
  if (row === null) throw new NotFoundError();
}

/**
 * `S-013` セクション 1・2 が読む値（現在の公開状態 + 公開先の選択肢）。
 *
 * 🔴 **選択肢は「このテナントの取引先企業」そのもの**である。母集団を絞るのは
 *    `partner_companies` の RLS（ホストは C2 / C5 で自テナント全社）であり、
 *    ここに `tenantId` の `where` を書かない。
 * 🔴 **停止中の取引先も選択肢に残す**（`suspended` を添えるだけ）。取引先の停止が止めるのは
 *    **その取引先の配下アカウントの実行系**（`F-007 AC-2` / `requireExecutable`）であって、
 *    ホスト側の公開範囲の設定ではない。落とすと「停止を解除したら公開範囲が勝手に消えていた」
 *    のような、状態をまたいで意味が変わる挙動になる。
 * 🔴 並びは会社名 → ID（決定的順序。docs/05 §4.8）。
 */
export async function listProjectVisibilityChoices(
  ctx: AuthenticatedTenantCtx,
  projectId: string,
): Promise<readonly ProjectVisibilityChoice[]> {
  requireHost(ctx);
  return withTenant(ctx, async (db) => {
    await requireVisibleProject(db, projectId);

    const companies = await db.partnerCompany.findMany({
      select: { id: true, name: true, suspendedAt: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    if (companies.length === 0) return [];

    // 🔴 `revoked_at IS NULL` が「現在の公開先」の定義である（C4 の述語と鏡写し）。
    const published = await db.projectVisibility.findMany({
      where: { projectId, revokedAt: null },
      select: { partnerCompanyId: true, publishedAt: true },
    });
    const publishedAtById = new Map(published.map((row) => [row.partnerCompanyId, row.publishedAt]));

    return companies.map((company) => {
      const publishedAt = publishedAtById.get(company.id);
      return {
        partnerCompanyId: company.id,
        name: company.name,
        suspended: company.suspendedAt !== null,
        publishedOn: publishedAt === undefined ? null : toJstIsoDay(publishedAt),
      };
    });
  });
}

/**
 * 指定された取引先が**自テナントに実在すること**を確かめる（`assertRequirementSkillsExist` と同じ形）。
 * 🔴 実在しない ID を素通りさせると、①ゲートに存在しない相手を渡す ②SP-07 で行を作る段階に
 *    なって初めて FK 違反（500）になる —— どちらも「入力の誤り」を障害に見せる。**400 で断る。**
 * 🔴 母集団は RLS が決めるので、他テナントの取引先 ID も**同じ 400**になる（存在を教えない）。
 */
async function assertPartnerCompaniesExist(
  db: VisibilityDb,
  partnerCompanyIds: readonly string[],
): Promise<void> {
  if (partnerCompanyIds.length === 0) return;
  const found = await db.partnerCompany.findMany({
    where: { id: { in: [...partnerCompanyIds] } },
    select: { id: true },
  });
  if (found.length !== partnerCompanyIds.length) {
    throw new ValidationError(['body.partnerCompanyIds']);
  }
}

/** 公開先の差分を反映し、同じトランザクションで監査記録を残す。 */
export async function updateProjectVisibility(
  ctx: AuthenticatedTenantCtx,
  projectId: string,
  input: ProjectVisibilityInput,
  meta: ProjectVisibilityMeta,
  // 🔴 既定値を持たない。「実装が入るまで保留するスタブ」を既定にすると、配線を忘れた経路が
  //    **静かに公開されないまま成功を返す**（`CLAUDE.md` §11.1 の壊れ方）。
  _deps?: { readonly gate: ProjectPublishGate },
): Promise<ProjectVisibilityUpdateView> {
  void _deps;
  requireHost(ctx);
  // 🔴 重複を畳んでから扱う（同じ相手を 2 回選んでも 1 回の公開である）。
  const requested = [...new Set(input.partnerCompanyIds)].sort();

  const { view } = await withTenant(ctx, async (db) => {
    await requireVisibleProject(db, projectId);
    await assertPartnerCompaniesExist(db, requested);

    // 旧仕様の要求が残っていても後から公開・解除されないよう取り下げる。
    await withdrawProjectPublishRequest(db, projectId, PROJECT_PUBLISH_REQUEST_KIND);
    await withdrawProjectPublishRequest(db, projectId, 'RECHECK');

    const currentRows = await db.projectVisibility.findMany({
      where: { projectId, revokedAt: null },
      select: { partnerCompanyId: true },
    });
    const before = [...currentRows.map((row) => row.partnerCompanyId)].sort();
    const { added, kept, revoked } = diffProjectVisibility(before, requested);

    if (revoked.length > 0) {
      // 🔴 `revoked_at` を入れるだけ（行を消さない）。C4 の `revoked_at IS NULL` が偽になり、
      //    その時点で対象パートナーの一覧・検索・件数・通知から消える（`F-014` 処理④）。
      // ⚠️ 更新件数を検査しない: 直前に読んだ行が並行して解除されていても、**結果は同じ**
      //    （その相手には公開されていない）であり、失敗にする理由が無い。
      await db.projectVisibility.updateMany({
        where: { projectId, partnerCompanyId: { in: [...revoked] }, revokedAt: null },
        // 🔴 T-12-10: 原因を必ず書く（`revoked_at` 単独は CHECK が拒む）。
        //    `revoked_review_gate_id` は書かない —— 人の解除に「指摘」は無い。
        data: { revokedAt: meta.now, revokedReason: MANUAL_REVOKE_REASON },
      });
    }

    for (const partnerCompanyId of added) {
      await db.projectVisibility.upsert({
        where: { tenantId_projectId_partnerCompanyId: { tenantId: ctx.tenantId, projectId, partnerCompanyId } },
        create: { tenantId: ctx.tenantId, projectId, partnerCompanyId, publishedAt: meta.now, publishedBy: ctx.userId, reviewGateId: null },
        update: { publishedAt: meta.now, publishedBy: ctx.userId, reviewGateId: null, revokedAt: null, revokedReason: null, revokedReviewGateId: null },
      });
    }
    const verdict: ProjectVisibilityVerdict = added.length > 0 ? 'PUBLISHED' : 'NO_PUBLISH_REQUESTED';

    // 🔴 実施者は `ctx.userId`（＝ 認証コンテキスト）である。リクエスト入力から受け取らない。
    //    `summary` の中身は `projectVisibilityAuditSummary`（純粋関数）が唯一決める。
    await writeAuditLog(db, {
      action: PROJECT_VISIBILITY_AUDIT_ACTION,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'Project',
      targetId: projectId,
      summary: projectVisibilityAuditSummary({ before, kept, requested, added, revoked, verdict }),
      ipAddress: meta.ipAddress,
      // 🔴 `CLAUDE.md` §13.3「モバイルだけ記録が漏れる実装にしない」。
      deviceKind: ctx.deviceKind,
    });

    return { view: { reviewGateId: null, verdict } };
  }, { isolationLevel: 'Serializable' });
  return view;
}
