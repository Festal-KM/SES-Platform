// packages/db/src/tenant-sending-domain.ts
// 🔴 `TenantSendingDomain`（docs/05 §3.9 / §8.3 / docs/03 §3.2.7）を読み書きする**唯一の経路**。T-04-04。
//
// ============================================================================
// 🔴 この表が守っているもの
// ============================================================================
// `verifiedAt` が NULL の間、**取引先へ届く送信は実行されない**（`BR-51` / `BR-71` /
// `F-001 AC-4`）。共通ドメインへのフォールバックは無い（docs/05 §8.3）。
// したがって「検証済みかどうか」を決める書き込みは、次の 3 つに限る:
//   ① `markSendingDomainVerified`   … `domain.verify` が SES の応答で確定させる
//   ② `expireSendingDomain`         … `domain.recheck` が失効させる（DNS レコードが消えた）
//   ③ `applySendingDomainProvision` … `domain.provision` が PENDING に置く（検証済みは触らない）
// 🔴 いずれも**アプリの入力を判定材料にしない**。利用者が「検証済みにする」ことはできない。
//
// 🔴 `state` は 4 値の**状態であってエラーではない**（`docs/04` 申し送り 8 / `S-036`）。
//    `FAILED` を「障害」として扱わない（DNS の反映待ちが最も多い）。
//
// 🔴 DB 側の CHECK が `(state = 'VERIFIED') = (verified_at IS NOT NULL)` を強制しており、
//    さらに部分 UNIQUE `(tenant_id) WHERE state = 'VERIFIED'` が「1 テナント 1 検証済みドメイン」を
//    強制する（migration 20260903000000）。本ファイルの関数はその制約と矛盾しない更新しか行わない。

import { Prisma } from '@prisma/client';
import type { AuthenticatedTenantCtx, HostTenantCtx } from './context.js';
import type { TenantSendingDomainState } from './schema-value-sets.js';
import { uuidV7 } from './uuid.js';
import { runInTenantTransaction } from './with-tenant.js';

/** 1 行の読み取り結果（画面 `S-036` / ジョブが読む形）。 */
export type SendingDomainRow = {
  readonly id: string;
  readonly domain: string;
  readonly state: TenantSendingDomainState;
  readonly sesIdentityArn: string | null;
  readonly sesTenantName: string | null;
  /** 🔴 Easy DKIM の CNAME を組み立てる元。**秘匿ではない**（DNS に公開する値）。 */
  readonly dkimTokens: readonly string[];
  readonly mailFromDomain: string | null;
  readonly verifiedAt: Date | null;
  readonly lastCheckedAt: Date | null;
  /** 🔴 文言ではなく**コード**（`SendingDomainFailureReason`）。画面が i18n キーへ写像する。 */
  readonly lastFailureReason: string | null;
  /** `A-005` 項目 11「検証開始からの経過日数」の起点。 */
  readonly createdAt: Date;
};

type DomainDbRow = {
  readonly id: string;
  readonly domain: string;
  readonly state: string;
  readonly ses_identity_arn: string | null;
  readonly ses_tenant_name: string | null;
  readonly dkim_tokens: unknown;
  readonly mail_from_domain: string | null;
  readonly verified_at: Date | null;
  readonly last_checked_at: Date | null;
  readonly last_failure_reason: string | null;
  readonly created_at: Date;
};

/**
 * 🔴 `dkim_tokens` は `Json?` である。**欠け・型違いを既定値で埋めない**方針だが、
 *    ここでは「トークンが 1 本も無い」= 未 provision と同義であり空配列が正しい表現である
 *    （画面は「まだレコードを提示できない」と読む）。文字列以外の要素は捨てる（壊れた行を
 *    そのまま画面へ流さない）。
 */
function toTokens(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toRow(row: DomainDbRow): SendingDomainRow {
  return {
    id: row.id,
    domain: row.domain,
    state: row.state as TenantSendingDomainState,
    sesIdentityArn: row.ses_identity_arn,
    sesTenantName: row.ses_tenant_name,
    dkimTokens: toTokens(row.dkim_tokens),
    mailFromDomain: row.mail_from_domain,
    verifiedAt: row.verified_at,
    lastCheckedAt: row.last_checked_at,
    lastFailureReason: row.last_failure_reason,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = Prisma.sql`
  id::text AS id, domain, state, ses_identity_arn, ses_tenant_name, dkim_tokens,
  mail_from_domain, verified_at, last_checked_at, last_failure_reason, created_at`;

function scopeOf(ctx: AuthenticatedTenantCtx) {
  return { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId };
}

/**
 * `GET /api/settings/sending-domains`（#71）。
 * 🔴 絞り込みを書かない —— 母集団は RLS（C2 HOST_ONLY）が自テナントに閉じる。
 */
export async function listSendingDomains(ctx: AuthenticatedTenantCtx): Promise<readonly SendingDomainRow[]> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const rows = await tx.$queryRaw<DomainDbRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS} FROM tenant_sending_domains ORDER BY created_at ASC`);
    return rows.map(toRow);
  });
}

/** 1 行を読む（#72 / `domain.*` ジョブが `id` から復元するための唯一の経路）。 */
export async function readSendingDomain(
  ctx: AuthenticatedTenantCtx,
  id: string,
): Promise<SendingDomainRow | null> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const rows = await tx.$queryRaw<DomainDbRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS} FROM tenant_sending_domains WHERE id = ${id}::uuid`);
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  });
}

export type SendingDomainRegistration = {
  readonly row: SendingDomainRow;
  /**
   * 🔴 `false` は「同じドメインが既に登録済みだった」ことを意味する（異常ではない）。
   *    `domain.provision` の冪等性（SP-04 T-04-04 の完了判定）はここから始まる ——
   *    再登録で DKIM トークンを作り直すと、利用者が既に DNS へ入れた CNAME が無効になる。
   */
  readonly created: boolean;
};

/**
 * `POST /api/settings/sending-domains`（#71）。
 *
 * 🔴 `ON CONFLICT (tenant_id, domain) DO NOTHING` + 既存行の再取得。
 *    「読んでから書く」にしない（並行実行が両方とも「無い」と判断して 2 行作ろうとし、
 *    片方が `UNIQUE` 違反で 500 になる）。
 * 🔴 `state` は `'REGISTERED'` から始まる。`PENDING` へ進めるのは `domain.provision` だけである
 *    （SES に identity を作る前に「検証待ち」と表示すると、利用者は出ていない CNAME を探すことになる）。
 */
export async function registerSendingDomain(
  ctx: AuthenticatedTenantCtx,
  input: { readonly domain: string; readonly observedAt: Date },
): Promise<SendingDomainRegistration> {
  const id = uuidV7(input.observedAt);
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const inserted = await tx.$queryRaw<DomainDbRow[]>(Prisma.sql`
      INSERT INTO tenant_sending_domains (id, tenant_id, domain, state, created_at)
      VALUES (${id}::uuid, ${ctx.tenantId}::uuid, ${input.domain}, 'REGISTERED', ${input.observedAt}::timestamptz)
      ON CONFLICT (tenant_id, domain) DO NOTHING
      RETURNING ${SELECT_COLUMNS}`);

    const created = inserted[0];
    if (created !== undefined) return { row: toRow(created), created: true };

    const existing = await tx.$queryRaw<DomainDbRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS} FROM tenant_sending_domains WHERE domain = ${input.domain}`);
    const row = existing[0];
    if (row === undefined) {
      // `DO NOTHING` で 0 行かつ SELECT でも 0 行 = RLS の外の行と衝突した（あり得ない組み合わせ。
      // `UNIQUE` は `(tenant_id, domain)` であり、自テナント以外と衝突しない）。黙って進めない。
      throw new Error(
        'tenant_sending_domains の登録が INSERT も SELECT も 0 行でした（RLS / スコープの不変条件違反）。',
      );
    }
    return { row: toRow(row), created: false };
  });
}

/**
 * 🔴 `domain.provision` の結果を反映する（docs/05 §8.3）。`REGISTERED` / `FAILED` / `PENDING` → `PENDING`。
 *
 * 🔴 **`VERIFIED` の行は触らない**（`WHERE state <> 'VERIFIED'`）。検証済みのドメインに
 *    provision を再実行したときに「検証済み → 検証待ち」へ**降格させない**ためである
 *    （降格した瞬間に、取引先へ届く送信がすべて保留になる）。
 * 🔴 `dkimTokens` は SES が返した値をそのまま保存する（画面に提示する CNAME の元）。
 */
export async function applySendingDomainProvision(
  ctx: HostTenantCtx,
  input: {
    readonly id: string;
    readonly sesIdentityArn: string;
    readonly sesTenantName: string;
    readonly dkimTokens: readonly string[];
    readonly mailFromDomain: string;
    readonly observedAt: Date;
  },
): Promise<boolean> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const updated = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE tenant_sending_domains
         SET state = 'PENDING',
             ses_identity_arn = ${input.sesIdentityArn},
             ses_tenant_name = ${input.sesTenantName},
             dkim_tokens = ${JSON.stringify([...input.dkimTokens])}::jsonb,
             mail_from_domain = ${input.mailFromDomain},
             last_checked_at = ${input.observedAt}::timestamptz,
             last_failure_reason = NULL
       WHERE id = ${input.id}::uuid AND state <> 'VERIFIED'
      RETURNING id::text AS id`);
    return updated.length === 1;
  });
}

/**
 * 🔴 検証済みにする（`domain.verify` が `GetEmailIdentity` の応答で確定させる）。
 *
 * 🔴 部分 UNIQUE `(tenant_id) WHERE state='VERIFIED'` があるため、**同一テナントで 2 本目を
 *    検証済みにしようとすると DB が拒否する**（送信元は 1 テナント 1 ドメイン。docs/05 §3.9）。
 *    握り潰さずそのまま例外にする —— 2 本目が黙って落ちると「検証したのに送れない」になる。
 */
export async function markSendingDomainVerified(
  ctx: HostTenantCtx,
  input: {
    readonly id: string;
    readonly verifiedAt: Date;
    readonly dkimTokens: readonly string[];
    readonly mailFromDomain: string;
  },
): Promise<boolean> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const updated = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE tenant_sending_domains
         SET state = 'VERIFIED',
             verified_at = ${input.verifiedAt}::timestamptz,
             dkim_tokens = ${JSON.stringify([...input.dkimTokens])}::jsonb,
             mail_from_domain = ${input.mailFromDomain},
             last_checked_at = ${input.verifiedAt}::timestamptz,
             last_failure_reason = NULL
       WHERE id = ${input.id}::uuid
      RETURNING id::text AS id`);
    return updated.length === 1;
  });
}

/**
 * 🔴 未検証にする（`domain.verify` の不成立 / `domain.recheck` の失効。docs/05 §8.3）。
 *
 * 🔴 `verified_at = NULL` と `state = 'FAILED'` は**同時にしか動かせない**（CHECK 制約）。
 *    片方だけ落として「検証済みなのに送信元が無い」状態を作れない。
 * 🔴 失効は**障害ではない**（DNS レコードが消された = 設定の問題）。`A-005` 項目 11 と
 *    テナント管理者への通知に出す（通知は分類 1 なので共通ドメインで送れる）。
 */
export async function expireSendingDomain(
  ctx: HostTenantCtx,
  input: { readonly id: string; readonly failureReason: string; readonly checkedAt: Date },
): Promise<boolean> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const updated = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE tenant_sending_domains
         SET state = 'FAILED',
             verified_at = NULL,
             last_checked_at = ${input.checkedAt}::timestamptz,
             last_failure_reason = ${input.failureReason}
       WHERE id = ${input.id}::uuid
      RETURNING id::text AS id`);
    return updated.length === 1;
  });
}

/**
 * 🔴 検証済みの送信元ドメイン（`packages/connectors` の `VerifiedSendingDomain` と構造的に一致）。
 *
 * 🔴 **未検証を表現できない型にする**（`verifiedAt` が必須）。「未検証」は `null` 側でのみ表す。
 *    これにより「未検証なのに送信元として渡す」経路が型で消える（docs/05 §8.3）。
 */
export type VerifiedSendingDomainRow = {
  readonly domain: string;
  readonly mailFromDomain: string;
  readonly verifiedAt: Date;
};

/**
 * 🔴 送信ジョブが「送信元ドメイン」を引くための唯一の関数（docs/05 §8.3 / `email-send.ts` の②）。
 *
 * 🔴 **未検証なら `null` を返す。共通ドメインを代わりに返してはならない**（`BR-51`。
 *    返した瞬間に「成功したように見えて違反している」状態になる）。
 * 🔴 `mail_from_domain` が NULL の行は返さない —— MAIL FROM が無い identity は
 *    SPF を満たせず、検証済みのはずがない（CHECK では表せない不変条件なのでここで担保する）。
 */
export async function resolveVerifiedSendingDomain(
  ctx: AuthenticatedTenantCtx,
): Promise<VerifiedSendingDomainRow | null> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const rows = await tx.$queryRaw<Array<{ domain: string; mail_from_domain: string; verified_at: Date }>>(
      Prisma.sql`
        SELECT domain, mail_from_domain, verified_at
          FROM tenant_sending_domains
         WHERE state = 'VERIFIED' AND verified_at IS NOT NULL AND mail_from_domain IS NOT NULL
         LIMIT 1`,
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      domain: row.domain,
      mailFromDomain: row.mail_from_domain,
      verifiedAt: row.verified_at,
    };
  });
}

/** `domain.recheck`（毎日 05:30 JST）が再確認する対象（`state='VERIFIED'` の全ドメイン）。 */
export async function listVerifiedSendingDomains(
  ctx: HostTenantCtx,
): Promise<readonly SendingDomainRow[]> {
  return runInTenantTransaction(scopeOf(ctx), async (tx) => {
    const rows = await tx.$queryRaw<DomainDbRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS} FROM tenant_sending_domains
       WHERE state = 'VERIFIED' ORDER BY created_at ASC`);
    return rows.map(toRow);
  });
}
