// packages/db/src/platform/queries/sending-domains.ts
// 🔴 `A-005` 運用監視の項目 11「送信ドメインが未検証・失効のテナント」の材料
//    （docs/02 `F-059 AC-5` / `F-001 AC-4` / `BR-71` / docs/05 §8.3 / §16.5）。T-11-06。
//
// 画面（`A-005`）の実装は SP-11（T-11-04）であり、本ファイルは**読み取り関数だけ**を置く。
// 🔴 返すのはテナントの識別（ID・名前・契約状態）と検証の状態・日時・件数だけである（`BR-40`）。
//    DNS レコードの値（`dkim_tokens` / `mail_from_domain` / `ses_identity_arn`）も、失敗理由のコードも、
//    テナントの業務データも**フィールドとして存在しない**。`admin.monitoring.view` として `AuditLog` に残る。
//
// 🔴 なぜ「テナント」を単位にするか: このテナントは**取引先へ 1 通も送れない**（`BR-71`。共通ドメインへの
//    フォールバックは無い）。運営者が対処する相手はテナントであり、ドメインの行ではない。同じテナントに
//    複数の未検証ドメインがあっても 1 行に畳む。
import type { TenantLifecycleState } from '../../context.js';
import type { AuthenticatedPlatformCtx } from '../../platform-context.js';
import { withPlatformRead } from '../../platform.js';
import type { TenantSendingDomainState } from '../../schema-value-sets.js';

/**
 * 一覧に載る検証状態。
 *
 * - `NOT_REGISTERED` … 送信ドメインの行が 1 本も無い（API-A4 で `sendingDomain` を空のまま開設した。docs/05 §6.9）
 * - `REGISTERED` / `PENDING` / `FAILED` … `TenantSendingDomain.state` そのまま（一度も検証されていない）
 * - `REVOKED` … `state='FAILED'` かつ `revoked_at IS NOT NULL`（`domain.recheck` で**失効**した。docs/05 §8.3）
 *
 * 🔴 `VERIFIED` は現れない（検証済みの行を 1 本でも持つテナントは母集団に入らない）。
 */
export const UNVERIFIED_SENDING_DOMAIN_STATUSES = [
  'NOT_REGISTERED',
  'REGISTERED',
  'PENDING',
  'FAILED',
  'REVOKED',
] as const;

export type UnverifiedSendingDomainStatus = (typeof UNVERIFIED_SENDING_DOMAIN_STATUSES)[number];

/** 一覧に載るテナントの契約状態（`CLOSING` / `PURGED` / `SUSPENDED` は載らない。下記 `LISTED_LIFECYCLE_STATES`）。 */
export type UnverifiedSendingDomainLifecycleState = Extract<TenantLifecycleState, 'SANDBOX' | 'ACTIVE'>;

export type UnverifiedSendingDomainItem = {
  readonly tenantId: string;
  readonly tenantName: string;
  /** 🔴 `SANDBOX` = 試用中（`sandbox` では取引先宛がモックなので業務は止まらないが、本契約移行の条件。docs/05 §5.4）。 */
  readonly lifecycleState: UnverifiedSendingDomainLifecycleState;
  /** 最新の登録行のドメイン。行が無ければ `null`（`status='NOT_REGISTERED'`）。 */
  readonly domain: string | null;
  readonly status: UnverifiedSendingDomainStatus;
  /**
   * 検証を始めた日時 = **最初に登録した行**の `created_at`。行が無ければテナントの開設日時。
   * 🔴 再登録で起点が動かない（オンボーディングの停滞期間を短く見せない）。
   */
  readonly startedAt: Date;
  /** 最新の登録行の `last_checked_at`（provision / verify / recheck のいずれかが最後に触れた時刻）。 */
  readonly lastCheckedAt: Date | null;
  /** `now - startedAt` を 24 時間単位で切り捨てた日数（0 以上）。 */
  readonly daysSinceStarted: number;
  /**
   * 失効した日時（このテナントの全行のうち最も新しい `revoked_at`）。一度も検証されていなければ `null`。
   * 🔴 最新の登録行に限らない —— 失効後に別ドメインを登録し直した場合でも「以前は送れていた」事実を落とさない
   *    （その場合 `status` は新しい行の状態、`revokedAt` は失効の時刻になる = 「失効後、再設定中」と読める）。
   */
  readonly revokedAt: Date | null;
  /** `now - revokedAt` の日数。`revokedAt` が `null` なら `null`。 */
  readonly daysSinceRevoked: number | null;
  /**
   * 利用者に提示している DNS レコードの**本数**（DKIM CNAME = `dkim_tokens` の本数 + MAIL FROM の MX / TXT = 2）。
   * 🔴 値は返さない。行が無ければ 0。
   */
  readonly expectedRecords: number;
};

export type UnverifiedSendingDomains = {
  /** 未検証・失効のテナント（`daysSinceStarted` の降順 = 最も長く止まっているものが先頭。同値は `tenantId` 昇順）。 */
  readonly items: readonly UnverifiedSendingDomainItem[];
  /** 状態ごとのテナント数（`items` の上限に切られる前の全件）。 */
  readonly countsByStatus: Readonly<Record<UnverifiedSendingDomainStatus, number>>;
  /** 母集団の全件数（`items.length` は `ITEMS_LIMIT` で切られうる）。 */
  readonly total: number;
};

export type UnverifiedSendingDomainsMeta = {
  readonly ipAddress?: string | null;
  /** 🔴 現在時刻は引数で受ける（経過日数を決定的に検証できるようにするため。関数内で `new Date()` を呼ばない）。 */
  readonly now: Date;
};

/**
 * 🔴 一覧に載る契約状態。`CLOSING` / `PURGED` は新規作成も送信もできない状態であり「送れない」のが正常。
 *    `SUSPENDED` は実行系が止まっている（`CLAUDE.md` §4.2）ため対象外とし、解除で `ACTIVE` に戻れば再び載る。
 */
const LISTED_LIFECYCLE_STATES: readonly UnverifiedSendingDomainLifecycleState[] = ['SANDBOX', 'ACTIVE'];

/** MAIL FROM の MX / TXT（`buildMailFromRecords`。`packages/connectors` に依存しないため本数だけをここに写す）。 */
const MAIL_FROM_RECORD_COUNT = 2;

const MILLISECONDS_PER_DAY = 86_400_000;

/** 1 回の読み取りで返す上限（`A-005` は「上位を出す」画面であり、全件の表は `A-002` の役目）。 */
const ITEMS_LIMIT = 500;

function wholeDaysBetween(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / MILLISECONDS_PER_DAY));
}

function dkimTokenCount(value: unknown): number {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').length : 0;
}

type DomainRow = {
  readonly domain: string;
  readonly state: string;
  readonly lastCheckedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly dkimTokens: unknown;
  readonly createdAt: Date;
};

function latestRevokedAt(rows: readonly DomainRow[]): Date | null {
  let latest: Date | null = null;
  for (const row of rows) {
    if (row.revokedAt !== null && (latest === null || row.revokedAt.getTime() > latest.getTime())) {
      latest = row.revokedAt;
    }
  }
  return latest;
}

function statusOf(row: DomainRow | undefined): UnverifiedSendingDomainStatus {
  if (row === undefined) return 'NOT_REGISTERED';
  const state = row.state as TenantSendingDomainState;
  if (state === 'FAILED' && row.revokedAt !== null) return 'REVOKED';
  // 🔴 `VERIFIED` はここに来ない（母集団が `none: { state: 'VERIFIED' }` で除いている）。
  //    来たら母集団の条件が壊れているので、黙って `FAILED` などに畳まず落とす。
  if (state === 'VERIFIED') {
    throw new Error('検証済みの行を持つテナントが未検証の母集団に現れました（listUnverifiedSendingDomains の不変条件違反）');
  }
  return state;
}

/**
 * 🔴 送信ドメインが未検証・失効のテナントを横断で読む（`targetTenantId: null`）。`F-059 AC-5`。
 *
 * 母集団 = `lifecycle_state ∈ {SANDBOX, ACTIVE}` かつ `state='VERIFIED'` の行を 1 本も持たないテナント
 * （docs/05 §8.3「運営者」/ §16.5 項目 11）。行が無いテナント（開設時に未入力）も含む。
 */
export async function listUnverifiedSendingDomains(
  ctx: AuthenticatedPlatformCtx,
  meta: UnverifiedSendingDomainsMeta,
): Promise<UnverifiedSendingDomains> {
  return withPlatformRead(
    { ctx, action: 'admin.monitoring.view', targetTenantId: null, ipAddress: meta.ipAddress ?? null },
    async (db) => {
      const tenants = await db.tenant.findMany({
        where: {
          lifecycleState: { in: [...LISTED_LIFECYCLE_STATES] },
          sendingDomains: { none: { state: 'VERIFIED' } },
        },
        select: {
          id: true,
          name: true,
          lifecycleState: true,
          createdAt: true,
          // 🔴 開示してよい列だけを select する。`ses_identity_arn` / `mail_from_domain` / `last_failure_reason` は
          //    読まない。`dkim_tokens` は本数を数えるためだけに読み、値は応答に出さない。
          sendingDomains: {
            orderBy: [{ createdAt: 'asc' }],
            select: {
              domain: true,
              state: true,
              lastCheckedAt: true,
              revokedAt: true,
              dkimTokens: true,
              createdAt: true,
            },
          },
        },
      });

      const countsByStatus: Record<UnverifiedSendingDomainStatus, number> = {
        NOT_REGISTERED: 0,
        REGISTERED: 0,
        PENDING: 0,
        FAILED: 0,
        REVOKED: 0,
      };
      const items: UnverifiedSendingDomainItem[] = [];
      for (const tenant of tenants) {
        const domains: readonly DomainRow[] = tenant.sendingDomains;
        const first = domains[0];
        const latest = domains[domains.length - 1];
        const status = statusOf(latest);
        countsByStatus[status] += 1;
        const startedAt = first?.createdAt ?? tenant.createdAt;
        const revokedAt = latestRevokedAt(domains);
        items.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          lifecycleState: tenant.lifecycleState as UnverifiedSendingDomainLifecycleState,
          domain: latest?.domain ?? null,
          status,
          startedAt,
          lastCheckedAt: latest?.lastCheckedAt ?? null,
          daysSinceStarted: wholeDaysBetween(startedAt, meta.now),
          revokedAt,
          daysSinceRevoked: revokedAt === null ? null : wholeDaysBetween(revokedAt, meta.now),
          expectedRecords: latest === undefined ? 0 : dkimTokenCount(latest.dkimTokens) + MAIL_FROM_RECORD_COUNT,
        });
      }
      items.sort((a, b) => {
        if (a.daysSinceStarted !== b.daysSinceStarted) return b.daysSinceStarted - a.daysSinceStarted;
        if (a.startedAt.getTime() !== b.startedAt.getTime()) return a.startedAt.getTime() - b.startedAt.getTime();
        return a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0;
      });
      return { items: items.slice(0, ITEMS_LIMIT), countsByStatus, total: items.length };
    },
  );
}
