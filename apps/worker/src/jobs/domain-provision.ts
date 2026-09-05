// apps/worker/src/jobs/domain-provision.ts
// `domain.provision`（docs/05 §8.3「SES Tenants と identity」/ §9.9）。T-04-04。
//
// 🔴 このジョブは**メールを 1 通も送らない**（identity の作成と DNS レコードの取得だけ）。
//    だから `attempts: 3` を許せる（docs/05 §9.10「読み取り・作成系。送信ではない」）。
//    型でもそれを担保している —— deps が受け取るのは `SesIdentityApi` であり、
//    `sendEmail` を持たない（`packages/connectors/src/email/ses/api.ts` の分割の理由）。
//
// 🔴 **冪等でなければならない**（SP-04 T-04-04 の完了判定「`domain.provision` の冪等性
//    （既存なら取得）」）。担保は 3 枚:
//    ① `CreateTenant` / `CreateTenantResourceAssociation` は「既にある」を成功として扱う（アダプタ）
//    ② `CreateEmailIdentity` が「既にある」なら **`GetEmailIdentity` で既存の DKIM トークンを読む**。
//       🔴 新しいトークンを発行し直さない —— 利用者が既に DNS へ入れた CNAME が無効になり、
//       検証がやり直しになる（`F-001 AC-4` の完了が遠のく）
//    ③ DB 側の更新は `WHERE state <> 'VERIFIED'`。検証済みを検証待ちへ**降格させない**
import { mailFromDomainFor, sesTenantName, type DomainJob, type SesIdentityApi } from '@ses/connectors';
import { applySendingDomainProvision, readSendingDomain, systemTenantCtx } from '@ses/db';
import { InvalidJobPayloadError, requireUuid } from './payload.js';

export const DOMAIN_PROVISION_JOB = 'domain.provision';

/**
 * 🔴 payload の形は `@ses/connectors` の `DomainJob` が正である（enqueue 側と共有する契約）。
 *    ここで再定義しない（片方だけ古くなる余地を作らない）。
 */
export type DomainProvisionPayload = DomainJob;

export function parseDomainProvisionPayload(raw: unknown): DomainProvisionPayload {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidJobPayloadError(DOMAIN_PROVISION_JOB, 'オブジェクトではありません');
  }
  const record = raw as Record<string, unknown>;
  return {
    tenantId: requireUuid(DOMAIN_PROVISION_JOB, 'tenantId', record.tenantId),
    sendingDomainId: requireUuid(DOMAIN_PROVISION_JOB, 'sendingDomainId', record.sendingDomainId),
  };
}

export type DomainProvisionDeps = {
  /** 🔴 identity 操作のポート。**送信の API を持たない**（このジョブは 1 通も送らない）。 */
  readonly identityApi: SesIdentityApi;
  /** `SES_CONFIGURATION_SET`（`packages/config`）。バウンス・苦情の event destination の紐付け先。 */
  readonly configurationSet: string;
  /**
   * 共通ドメインの identity（`SES_DEFAULT_FROM_ADDRESS` のドメイン部）。
   * 🔴 独自ドメインと**両方**を SES Tenant に関連付ける（docs/05 §8.3）。分類 1 / 分類外の送信も
   *    `TenantName` 付きでテナント別レピュテーション・サプレッションに乗せるためである。
   */
  readonly commonSendingDomain: string;
  readonly now: () => Date;
};

export type DomainProvisionOutcome =
  | { readonly kind: 'PROVISIONED'; readonly dkimTokens: readonly string[]; readonly mailFromDomain: string }
  /** 既に検証済み。SES も DB も触らない（降格させない）。 */
  | { readonly kind: 'ALREADY_VERIFIED' };

export type DomainProvisionHandler = (payload: unknown, jobId: string) => Promise<DomainProvisionOutcome>;

export function createDomainProvisionHandler(deps: DomainProvisionDeps): DomainProvisionHandler {
  return async (payload, jobId) => {
    const job = parseDomainProvisionPayload(payload);
    const ctx = systemTenantCtx(job.tenantId, { queue: DOMAIN_PROVISION_JOB, jobId });

    const row = await readSendingDomain(ctx, job.sendingDomainId);
    if (row === null) {
      // 🔴 行が無い ＝ payload とデータが食い違っている。黙って成功させない。
      throw new InvalidJobPayloadError(DOMAIN_PROVISION_JOB, 'sendingDomainId に対応する行がありません');
    }
    if (row.state === 'VERIFIED') return { kind: 'ALREADY_VERIFIED' };

    const tenantName = sesTenantName(job.tenantId);
    await deps.identityApi.createTenant(tenantName);

    const identity = await deps.identityApi.createEmailIdentity({
      domain: row.domain,
      configurationSetName: deps.configurationSet,
    });

    const mailFromDomain = mailFromDomainFor(row.domain);
    await deps.identityApi.putEmailIdentityMailFromAttributes({
      domain: row.domain,
      mailFromDomain,
    });

    // 🔴 独自ドメインと共通ドメインの**両方**（docs/05 §8.3）。
    for (const associated of [row.domain, deps.commonSendingDomain]) {
      await deps.identityApi.createTenantResourceAssociation({ tenantName, identity: associated });
    }

    await applySendingDomainProvision(ctx, {
      id: row.id,
      sesIdentityArn: deps.identityApi.identityArn(row.domain),
      sesTenantName: tenantName,
      dkimTokens: identity.DkimAttributes.Tokens,
      mailFromDomain,
      observedAt: deps.now(),
    });

    return {
      kind: 'PROVISIONED',
      dkimTokens: identity.DkimAttributes.Tokens,
      mailFromDomain,
    };
  };
}
