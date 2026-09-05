// apps/web/lib/partner-companies/service.ts
// 取引先企業の一覧（docs/05 §6.4 #11）・登録（#12）・停止 / 再開（#13）。`F-007` / `S-014`。T-04-07。
//
// 🔴 **母集団はアプリが決めない。**#11 の絞り込み（`?q=` / `?status=`）は業務上の絞り込みであり、
//    **境界の絞り込みではない**。テナント境界は Prisma 拡張（第 2 防御）が、パートナー境界は
//    RLS の C5（`partner_companies`: `app_is_host() OR id = app_partner_id()`）が決める。
//    したがってパートナー文脈では**自社 1 行**しか母集団に無く、`total` も 1 になる
//    （`F-007 AC-1`「自社 1 社以外が一覧にも件数にも現れない」/ `F-004 AC-1`。
//    API を直接呼んでも同じ）。ここに `tenantId` / `partnerCompanyId` の `where` を書かない。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` のみ）。結合テストが
//    サーバを立てずに同じ経路を実行できるようにするため（`settings/organization.ts` と同じ方針）。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { NotFoundError } from '../api/errors';
import type { PartnerCompanyListQuery, PartnerCompanyStatus } from './schemas';

/** docs/05 §16.1 の `*.create` / `*.update`。`F-007 AC-3` の記録対象。 */
export const PARTNER_COMPANY_AUDIT_ACTIONS = {
  create: 'partner_company.create',
  /**
   * 🔴 停止・再開も `*.update` である（docs/05 §16.1 の表に `partner_company.suspend` という
   *    action は無い）。独自の action 名を作ると `S-041` の「操作種別」フィルタ
   *    （`CREATE_UPDATE_DELETE` = `.create` / `.update` / `.delete` の接尾辞一致。
   *    `lib/audit-logs/categories.ts`）から漏れ、**記録されているのに検索で出てこない**状態になる。
   *    停止と再開の区別は `summary.operation` が持つ（`F-007 AC-3`）。
   */
  update: 'partner_company.update',
} as const;

/** 停止 / 再開のどちらを行ったか（監査ログの `summary.operation`）。 */
export const PARTNER_COMPANY_SUSPENSION_OPERATIONS = ['SUSPEND', 'RESUME'] as const;

export type PartnerCompanySuspensionOperation =
  (typeof PARTNER_COMPANY_SUSPENSION_OPERATIONS)[number];

/**
 * `#11` の 1 件分（`S-014` の一覧列と詳細のうち、Phase 1 で実在する項目）。
 *
 * 🔴 パートナー自身がこの型を受け取ることもある（自社 1 行）。載せてよいのは
 *    **自社に関する事実**だけであり、他社の件数・存在を示唆する値を足してはならない
 *    （`CLAUDE.md` §3.1 の 🔴「パートナー同士が相互に参照できる経路を 1 つも作らない」）。
 */
export type PartnerCompanyView = {
  readonly id: string;
  readonly name: string;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly status: PartnerCompanyStatus;
  readonly invitedAt: string;
  readonly suspendedAt: string | null;
  /** 配下アカウント数（有効な `Membership`）。 */
  readonly accountCount: number;
  /** 未受諾・未取消の招待の件数（`S-014`「招待の状態」の要約）。 */
  readonly pendingInvitationCount: number;
  /** 公開中の案件数（`ProjectVisibility` のうち取り消されていないもの）。 */
  readonly openProjectCount: number;
  /** その取引先が当事者の提案数（`Proposal.ownerPartnerCompanyId`）。 */
  readonly proposalCount: number;
  /**
   * 最終アクティビティ（配下アカウントの最終ログイン時刻の最大値）。
   * 🔴 ログイン履歴を持たない取引先では `null`（0 や現在時刻で埋めない）。
   */
  readonly lastActivityAt: string | null;
};

export type PartnerCompanyListView = {
  readonly items: readonly PartnerCompanyView[];
  /** 🔴 一覧と**同じ `where`** の件数（docs/05 §4.8）。別クエリで数え直さない。 */
  readonly total: number;
};

type PartnerCompanyRow = {
  readonly id: string;
  readonly name: string;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly suspendedAt: Date | null;
  readonly invitedAt: Date;
};

/** 業務上の絞り込み（境界の絞り込みではない。本ファイル冒頭の 🔴 を参照）。 */
type BusinessFilter = {
  readonly name?: { readonly contains: string; readonly mode: 'insensitive' };
  readonly suspendedAt?: null | { readonly not: null };
};

function businessFilterOf(query: PartnerCompanyListQuery): BusinessFilter {
  return {
    ...(query.q === undefined || query.q === ''
      ? {}
      : { name: { contains: query.q, mode: 'insensitive' as const } }),
    ...(query.status === undefined
      ? {}
      : query.status === 'ACTIVE'
        ? { suspendedAt: null }
        : { suspendedAt: { not: null } }),
  };
}

function statusOf(row: PartnerCompanyRow): PartnerCompanyStatus {
  return row.suspendedAt === null ? 'ACTIVE' : 'SUSPENDED';
}

/** `groupBy` の結果を「取引先企業 ID → 件数」に畳む（キーが null の行は捨てる）。 */
function toCountMap(
  groups: readonly { readonly key: string | null; readonly count: number }[],
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const group of groups) {
    if (group.key !== null) map.set(group.key, group.count);
  }
  return map;
}

/**
 * `GET /api/partner-companies`（#11）。
 *
 * 🔴 集計（配下アカウント数・公開中の案件数・提案数・最終アクティビティ）も**同じ ctx の
 *    `withTenant` の内側**で引く。したがって集計そのものにも RLS が効き、パートナー文脈では
 *    自社の値しか集まらない（他社の件数を経由して他社の存在を知る経路を作らない）。
 * 🔴 `groupBy` で 1 往復にまとめる（取引先ごとに `count` を回すと N+1 になり、
 *    §7 の応答目標を満たせない）。
 */
export async function listPartnerCompanies(
  ctx: AuthenticatedTenantCtx,
  query: PartnerCompanyListQuery,
): Promise<PartnerCompanyListView> {
  const where = businessFilterOf(query);

  return withTenant(ctx, async (db) => {
    const rows: readonly PartnerCompanyRow[] = await db.partnerCompany.findMany({
      where,
      select: {
        id: true,
        name: true,
        contactName: true,
        contactEmail: true,
        suspendedAt: true,
        invitedAt: true,
      },
      // 🔴 並び順に「順位」「全体件数」を持ち込まない（docs/05 §4.8）。名前の昇順で決定的にする。
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    if (rows.length === 0) return { items: [], total: 0 };

    const ids = rows.map((row) => row.id);

    const [accounts, invitations, visibilities, proposals, activities] = await Promise.all([
      db.membership.groupBy({
        by: ['partnerCompanyId'],
        where: { partnerCompanyId: { in: ids }, revokedAt: null },
        _count: { _all: true },
      }),
      db.invitation.groupBy({
        by: ['partnerCompanyId'],
        where: { partnerCompanyId: { in: ids }, acceptedAt: null, revokedAt: null },
        _count: { _all: true },
      }),
      db.projectVisibility.groupBy({
        by: ['partnerCompanyId'],
        where: { partnerCompanyId: { in: ids }, revokedAt: null },
        _count: { _all: true },
      }),
      db.proposal.groupBy({
        by: ['ownerPartnerCompanyId'],
        where: { ownerPartnerCompanyId: { in: ids } },
        _count: { _all: true },
      }),
      db.user.groupBy({
        by: ['ownerPartnerCompanyId'],
        where: { ownerPartnerCompanyId: { in: ids } },
        _max: { lastLoginAt: true },
      }),
    ]);

    const accountCounts = toCountMap(
      accounts.map((group) => ({ key: group.partnerCompanyId, count: group._count._all })),
    );
    const invitationCounts = toCountMap(
      invitations.map((group) => ({ key: group.partnerCompanyId, count: group._count._all })),
    );
    const visibilityCounts = toCountMap(
      visibilities.map((group) => ({ key: group.partnerCompanyId, count: group._count._all })),
    );
    const proposalCounts = toCountMap(
      proposals.map((group) => ({ key: group.ownerPartnerCompanyId, count: group._count._all })),
    );

    const lastActivities = new Map<string, Date>();
    for (const group of activities) {
      const key = group.ownerPartnerCompanyId;
      const value = group._max.lastLoginAt;
      if (key !== null && value !== null) lastActivities.set(key, value);
    }

    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      status: statusOf(row),
      invitedAt: row.invitedAt.toISOString(),
      suspendedAt: row.suspendedAt?.toISOString() ?? null,
      accountCount: accountCounts.get(row.id) ?? 0,
      pendingInvitationCount: invitationCounts.get(row.id) ?? 0,
      openProjectCount: visibilityCounts.get(row.id) ?? 0,
      proposalCount: proposalCounts.get(row.id) ?? 0,
      lastActivityAt: lastActivities.get(row.id)?.toISOString() ?? null,
    }));

    // 🔴 `total` は一覧と同じ `where` の件数である（別条件で数え直さない。docs/05 §4.8）。
    //    ページングが無いので `items.length` と必ず一致する。
    return { items, total: items.length };
  });
}

export type CreatePartnerCompanyInput = {
  readonly name: string;
  readonly contactName?: string;
  readonly contactEmail?: string;
  readonly invitedAt: Date;
};

/**
 * `POST /api/partner-companies`（#12）。
 *
 * 🔴 `tenantId` は**認証コンテキスト**から入る（リクエスト入力ではない。`CLAUDE.md` §3.1）。
 *    Prisma 拡張が `data` にテナントキーを注入するが、Prisma の型は必須列として要求するため
 *    明示する。ctx と異なる値を書こうとすれば拡張が `CrossTenantWriteError` で落とす。
 * 🔴 RLS の C2（`partner_companies` の INSERT は `app_is_host()`）により、パートナー文脈では
 *    そもそも 1 行も書けない（アプリの `requireRole` と二重防御）。
 * 🔴 監査は `withApiRoute` の `audit` オプションが**ハンドラの前に**書く（docs/05 §6.1 / §16.1）。
 *    記録に失敗したらこの関数は呼ばれない（`F-007 AC-3`）。
 */
export async function createPartnerCompany(
  ctx: AuthenticatedTenantCtx,
  input: CreatePartnerCompanyInput,
): Promise<{ readonly id: string }> {
  return withTenant(ctx, (db) =>
    db.partnerCompany.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        contactName: input.contactName ?? null,
        contactEmail: input.contactEmail ?? null,
        invitedAt: input.invitedAt,
      },
      select: { id: true },
    }),
  );
}

/**
 * `POST /api/partner-companies/{id}/suspend` / `/resume`（#13）。
 *
 * 🔴 **データを 1 行も消さない**（`F-007 AC-2`「既存データは削除されない」）。
 *    停止は `suspended_at` の設定であり、配下アカウントの実行系を止めるのは
 *    `requireExecutable`（`lib/api/guards.ts`）である。ここでは行を書くだけである。
 * 🔴 `update` ではなく `updateMany` を使う（`settings/organization.ts` と同じ理由）。
 *    スコープは第 2 防御が注入した `where` が決め、アプリは `id` 以外の条件を書かない。
 * 🔴 更新が 0 件なら 404（境界外・存在しないの区別をしない。docs/05 §4.8）。
 * 🔴 **冪等である。** すでに停止中の取引先を停止しても `suspended_at` を上書きしない
 *    （上書きすると「いつから止まっているか」が操作のたびに動く）。すでにその状態なら
 *    `changed: false` を返し、呼び出し側は 204 を返す（二重操作を失敗にしない）。
 */
export async function setPartnerCompanySuspension(
  ctx: AuthenticatedTenantCtx,
  input: {
    readonly id: string;
    readonly operation: PartnerCompanySuspensionOperation;
    readonly now: Date;
  },
): Promise<{ readonly changed: boolean }> {
  return withTenant(ctx, async (db) => {
    const current = await db.partnerCompany.findFirst({
      where: { id: input.id },
      select: { suspendedAt: true },
    });
    if (current === null) throw new NotFoundError();

    const suspended = current.suspendedAt !== null;
    if (suspended === (input.operation === 'SUSPEND')) return { changed: false };

    const updated = await db.partnerCompany.updateMany({
      where: { id: input.id },
      data: { suspendedAt: input.operation === 'SUSPEND' ? input.now : null },
    });
    // 🔴 直前の `findFirst` で見えていた行が消えている（並行削除）。0 件を成功にしない。
    if (updated.count !== 1) throw new NotFoundError();
    return { changed: true };
  });
}
