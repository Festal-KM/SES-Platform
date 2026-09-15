// apps/web/app/(main)/proposals/sending-domain.ts
// `S-020` セクション 6「送信元ドメインの状態」の判定材料（`U-04` / `docs/04` §S-020）。T-09-01。
//
// 🔴 判定は `S-003` / `S-035` と同じ 1 本（`readSendingDomainSettings` → `resolveSendingDomainFact`）を通す。
//    画面ごとに別の読み取りを書くと「ホームでは検証済み、提案の画面では未設定」のずれが入る。
// 🔴 取引先には判定材料すら取りに行かない（`tenant_sending_domains` は C2 = ホストのみ。設定するのもホスト）。
import type { AuthenticatedTenantCtx } from '@ses/db';
import { sendingDomainRuntime } from '../../../lib/db/bootstrap';
import { resolveSendingDomainFact } from '../../../lib/settings/sending-domain-fact';
import { readSendingDomainSettings } from '../../../lib/settings/sending-domains';

export type ProposalSendingDomainFact =
  | { readonly kind: 'PARTNER' }
  | { readonly kind: 'NOT_REQUIRED' }
  | { readonly kind: 'UNVERIFIED' }
  | { readonly kind: 'VERIFIED'; readonly domain: string };

export async function proposalSendingDomainFact(ctx: AuthenticatedTenantCtx): Promise<ProposalSendingDomainFact> {
  if (ctx.partnerCompanyId !== null) return { kind: 'PARTNER' };
  const fact = resolveSendingDomainFact(await readSendingDomainSettings(ctx, sendingDomainRuntime()));
  // 🔴 `NOT_REQUIRED`（sandbox / demo / development）は共通ドメインで送れる状態であり、「未設定」と描かない
  //    （`S-003` の帯を出さない判定と同じ向き）。
  if (fact.kind === 'NOT_REQUIRED') return { kind: 'NOT_REQUIRED' };
  if (fact.kind === 'SET' && fact.state === 'VERIFIED') return { kind: 'VERIFIED', domain: fact.domain };
  return { kind: 'UNVERIFIED' };
}
