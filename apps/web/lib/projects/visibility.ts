// apps/web/lib/projects/visibility.ts
// 🔴 **越境経路 1（案件の公開）の唯一の書き込み経路**（docs/05 §6.4 #28 `PUT /api/projects/{id}/visibility`。
//    `F-014` / `S-013`）。T-06-06。
//
// ============================================================================
// 🔴 この経路が守るもの
// ============================================================================
// ① **既定は誰にも公開されない**（`F-014 AC-2`）。`createProject`（`service.ts`）は
//    `ProjectVisibility` を 1 行も作らず、行を作れるのは本モジュールだけである。
//    🔴 **「全公開」という値・既定・ショートカットを 1 つも持たない** —— 入力は
//    「公開先の集合」であって「全体 / 個別」の切替ではない（スキーマにもその概念が無い）。
// ② **越境の根拠は `ProjectVisibility` の行の有無だけ**（docs/05 §4.4 C4）。本モジュールは
//    行を足す / 取り消すだけで、**「見える / 見えない」をアプリの `if` で判断しない**。
//    公開範囲外のパートナーに案件が現れないこと（`F-014 AC-1`）は、この行を根拠にした
//    RLS（C4 VISIBILITY。`revoked_at IS NULL`）が画面・検索・件数・通知のすべてで担保する。
// ③ **公開はゲートを通ってからでなければ成立しない**（`F-014 AC-3` / `F-020`）。
//    本タスクでは接続点まで（`publish-gate.ts`）。**追加は 1 件も行にならない。**
// ④ **公開範囲の変更を監査ログに残す**（`F-014 AC-5` / `BR-27` / docs/05 §16.1
//    `project.visibility_change`）。🔴 実施者・変更前後を残すため、記録は
//    **業務トランザクションの内側**（`writeAuditLog`）で書く（`membership.role_change` と同じ形。
//    `withApiRoute` の `audit` オプションは①ハンドラの前に別トランザクションで書くので
//    **起きなかった変更**〔404 / 400〕まで残り、②変更前の公開先は行を読むまで分からない）。
//
// 🔴 **ホスト専用である**（`requireHost`）。担保は 4 枚:
//    ①ルートの `requireRole(PROJECT_EDITOR_ROLES)`（403）②本モジュールの `requireHost`
//    （`HostOnlyContextError` → **404**）③`project_visibilities` の RLS（C2。書込は
//    `app_is_host()`）④画面（`S-013`）がパートナーロールをホームへ戻す。
//    🔴 **公開先の一覧（他社の社名）が出てよいのはホストだけである**（`CLAUDE.md` §3.1 の 🔴
//    「パートナー同士が相互に参照できる経路を 1 つも作らない」）。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` のみ）。結合テストがサーバを
//    立てずに同じ経路を実行できるようにするため（`projects/service.ts` と同じ方針）。
import {
  requireHost,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import { NotFoundError, ValidationError } from '../api/errors';
import { toJstIsoDay } from '../format/datetime';
import {
  heldProjectPublishGate,
  type ProjectPublishGate,
} from './publish-gate';

/**
 * docs/05 §16.1 の `project.visibility_change`（`#28`）。
 * 🔴 **`project.update` に畳まない。** §16.1 が固有の action として列挙しており、`S-041` の
 *    操作種別フィルタでも `VISIBILITY_CHANGE`（`lib/audit-logs/categories.ts`）に割り当て済みで
 *    ある。畳むと `BR-27` の「公開範囲の変更」で検索したときに 0 件になる
 *    （`membership.role_change` を `*.update` にしないのと同じ理由）。
 */
export const PROJECT_VISIBILITY_AUDIT_ACTION = 'project.visibility_change';

/**
 * `#28` の応答の `verdict`（docs/05 §6.4 #28）。
 *
 * 🔴 **`PASS` / `FAIL` を持たない。** ゲートは非同期であり（docs/05 §12.1 / §11.1）、
 *    `PUT` の応答時点で合否は存在しない。ここが表すのは「**この要求で公開が成立したか**」
 *    ではなく「**公開の要求をどう扱ったか**」である。
 *   - `PENDING_GATE` … 新しい公開先があり、ゲートに預けた。🔴 **まだ公開されていない。**
 *   - `NO_PUBLISH_REQUESTED` … 新しい公開先が無い（解除のみ / 変更なし）。ゲートは起動しない。
 */
export const PROJECT_VISIBILITY_VERDICTS = ['PENDING_GATE', 'NO_PUBLISH_REQUESTED'] as const;

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

/**
 * `PUT /api/projects/{id}/visibility`（#28。`F-014`）。T-06-06。
 *
 * 手順（🔴 順序に意味がある）:
 *   1. 案件が見えること（見えなければ 404。境界外と不存在を区別しない）
 *   2. 指定された取引先が実在すること（400）
 *   3. 現在の公開先を読み、差分を取る（`diffProjectVisibility`）
 *   4. 🔴 **解除は即時に適用する**（境界を狭める操作にゲートは要らない。`F-014` 処理④）。
 *      🔴 **行を消さない**（`revoked_at` を入れるだけ）。**作成済みの提案は残る**ため、
 *      「誰にいつ公開していたか」は後から遡れなければならない。
 *   5. 🔴 **追加はゲートに預けるだけ**（`publish-gate.ts`）。**ここで行を作らない。**
 *   6. 監査ログを 1 行（変更前 / 要求 / 変更後 / 保留中）
 *
 * 🔴 **解除と追加が同じ要求に混ざったとき、解除だけが成立する。** 中途半端に見えるが、
 *    「広げる操作だけがゲートを待つ」という規則の当然の帰結であり、安全側である
 *    （狭めるほうを一緒に保留すると、公開をやめたい相手に案件が見え続ける）。
 *    応答の `verdict` と `S-013` の文言が、何が起きて何が保留されたかを明示する。
 *
 * 🔴 冪等である。同じ集合を 2 回送っても、行は変わらず監査ログの内容も同じ形になる。
 *    ⚠️ **記録そのものは 2 行残る**（`membership.role_change` のように「変更が無ければ書かない」に
 *    しない）—— 公開範囲の設定は `S-013` の明示的な操作であり、「誰がいつ確認・確定したか」も
 *    `F-014 AC-5` の説明責任の一部だからである。
 */
export async function updateProjectVisibility(
  ctx: AuthenticatedTenantCtx,
  projectId: string,
  input: ProjectVisibilityInput,
  meta: ProjectVisibilityMeta,
  deps: { readonly gate: ProjectPublishGate } = { gate: heldProjectPublishGate },
): Promise<ProjectVisibilityUpdateView> {
  requireHost(ctx);
  // 🔴 重複を畳んでから扱う（同じ相手を 2 回選んでも 1 回の公開である）。
  const requested = [...new Set(input.partnerCompanyIds)].sort();

  return withTenant(ctx, async (db) => {
    await requireVisibleProject(db, projectId);
    await assertPartnerCompaniesExist(db, requested);

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
        data: { revokedAt: meta.now },
      });
    }

    // 🔴 追加は 1 件も行にならない（ゲート通過後にワーカーが作る。`publish-gate.ts`）。
    const gate =
      added.length === 0
        ? null
        : await deps.gate(ctx, { projectId, partnerCompanyIds: added });
    // 🔴 `verdict` はゲートを呼んだかどうかから導く（`added.length` を 2 度読まない ——
    //    2 度読むと、ゲートを呼ぶ条件と応答の意味が別々に動きうる）。
    const verdict: ProjectVisibilityVerdict =
      gate === null ? 'NO_PUBLISH_REQUESTED' : 'PENDING_GATE';

    // 🔴 `summary` に載せてよいのは ID・件数・列挙値だけである（docs/05 §16.2）。
    //    取引先の**社名**を載せない（運営者の横断検索〔`F-058`〕に出るため）。
    await writeAuditLog(db, {
      action: PROJECT_VISIBILITY_AUDIT_ACTION,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'Project',
      targetId: projectId,
      summary: {
        // 🔴 `F-014 AC-5`「変更前後の公開先」。ID の昇順で結合する（順序で揺れない）。
        before: before.join(','),
        after: kept.join(','),
        /** 要求された集合（`after` との差が「ゲート待ち」である）。 */
        requested: requested.join(','),
        pending: added.join(','),
        revoked: revoked.join(','),
        verdict,
      },
      ipAddress: meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });

    return { reviewGateId: gate === null ? null : gate.reviewGateId, verdict };
  });
}
