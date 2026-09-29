// tests/static/support/ui-ratchet-allowlist.ts
// 🔴 **UI 刷新の許可リスト（`docs/05` §17.7.2 ①）。** ファイル単位 + 理由 + どの段で外すか。
//
// ============================================================================
// このファイルの編集の仕方
// ============================================================================
// 🔴 **削るだけである。**
//   - 段② が `S-005` を刷新したら、`S-005` のファイルをここから削る（`SP-22` §4.1 の表）。
//     削り忘れれば ② の「未使用の許可が残っていない」で落ちる —— **掃除の完了は機械が確かめる**。
//   - 🔴 **足せない。** キーは `ui-ratchet-baseline.ts` の部分集合でなければならず（④）、
//     baseline は 2026-09-30 の実体で凍結されている。
//   - 段は `SECTION_4_1_STAGES`（`SP-22` §4.1 の写し）と一致しなければ落ちる（①）。
// 🔴 **対象は「ファイル」であって「クラス」ではない**（`docs/05` §17.7.2）。「この色だけは許す」を
//    作らないため。恒久例外は `AppShell` の `pb-24` の 1 件だけで、それは
//    `ui-spacing-scale.test.ts` の `PERMANENT_SPACING_EXCEPTION` に理由つきで置く。
import type { AllowEntry } from './ui-ratchet.js';

/**
 * (a) 色の直書き — 着手時 93 ファイル / 1007 行。
 * 🔴 段が進むごとに削る。空になった時点で (a) 色の直書き は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_A: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 段①
  ['apps/web/app/(main)/_shell/app-shell.tsx', { stage: 1, reason: '外枠（AppShell / PageHeading） の刷新（段①）で semantic トークンへ置き換える。移行中 19 行' }],
  ['apps/web/app/(main)/_shell/page-heading.tsx', { stage: 1, reason: '外枠（AppShell / PageHeading） の刷新（段①）で semantic トークンへ置き換える。移行中 4 行' }],
  ['apps/web/app/global-error.tsx', { stage: 1, reason: '外枠（root error boundary） の刷新（段①）で semantic トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/layout.tsx', { stage: 1, reason: '外枠（root layout） の刷新（段①）で semantic トークンへ置き換える。移行中 1 行' }],
  // ── 段②
  ['apps/web/app/(main)/audit-logs/audit-log-detail.tsx', { stage: 2, reason: 'S-041 の刷新（段②）で semantic トークンへ置き換える。移行中 11 行' }],
  ['apps/web/app/(main)/audit-logs/audit-logs-view.tsx', { stage: 2, reason: 'S-041 の刷新（段②）で semantic トークンへ置き換える。移行中 8 行' }],
  ['apps/web/app/(main)/engineer-shares/engineer-share-screen.tsx', { stage: 2, reason: 'S-015 の刷新（段②）で semantic トークンへ置き換える。移行中 21 行' }],
  ['apps/web/app/(main)/engineers/(list)/error.tsx', { stage: 2, reason: 'S-005 の刷新（段②）で semantic トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/engineers/(list)/loading.tsx', { stage: 2, reason: 'S-005 の刷新（段②）で semantic トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/engineers/engineer-ledger-screen.tsx', { stage: 2, reason: 'S-005 の刷新（段②）で semantic トークンへ置き換える。移行中 10 行' }],
  ['apps/web/app/(main)/projects/(list)/error.tsx', { stage: 2, reason: 'S-010 の刷新（段②）で semantic トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/projects/(list)/loading.tsx', { stage: 2, reason: 'S-010 の刷新（段②）で semantic トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/projects/[id]/candidates/candidate-screen.tsx', { stage: 2, reason: 'S-016 の刷新（段②）で semantic トークンへ置き換える。移行中 33 行' }],
  ['apps/web/app/(main)/projects/[id]/candidates/page.tsx', { stage: 2, reason: 'S-016 の刷新（段②）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/projects/project-list-screen.tsx', { stage: 2, reason: 'S-010 の刷新（段②）で semantic トークンへ置き換える。移行中 7 行' }],
  ['apps/web/app/(main)/proposals/(list)/error.tsx', { stage: 2, reason: 'S-019 の刷新（段②）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/(list)/loading.tsx', { stage: 2, reason: 'S-019 の刷新（段②）で semantic トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/proposals/(list)/proposal-list-screen.tsx', { stage: 2, reason: 'S-019 の刷新（段②）で semantic トークンへ置き換える。移行中 16 行' }],
  ['apps/web/app/admin/audit-logs/admin-audit-logs-results.tsx', { stage: 2, reason: 'A-006 の刷新（段②）で semantic トークンへ置き換える。移行中 6 行' }],
  ['apps/web/app/admin/audit-logs/admin-audit-logs-view.tsx', { stage: 2, reason: 'A-006 の刷新（段②）で semantic トークンへ置き換える。移行中 5 行' }],
  ['apps/web/app/admin/audit-logs/page.tsx', { stage: 2, reason: 'A-006 の刷新（段②）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/admin/monitoring/admin-monitoring-items.tsx', { stage: 2, reason: 'A-005 の刷新（段②）で semantic トークンへ置き換える。移行中 9 行' }],
  ['apps/web/app/admin/monitoring/admin-monitoring-view.tsx', { stage: 2, reason: 'A-005 の刷新（段②）で semantic トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/admin/monitoring/page.tsx', { stage: 2, reason: 'A-005 の刷新（段②）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/admin/tenants/admin-tenants-list.tsx', { stage: 2, reason: 'A-002 の刷新（段②）で semantic トークンへ置き換える。移行中 16 行' }],
  ['apps/web/app/admin/tenants/page.tsx', { stage: 2, reason: 'A-002 の刷新（段②）で semantic トークンへ置き換える。移行中 2 行' }],
  // ── 段③
  ['apps/web/app/(main)/_home/action-queue-section.tsx', { stage: 3, reason: 'S-003 / S-004 の刷新（段③）で semantic トークンへ置き換える。移行中 11 行' }],
  ['apps/web/app/(main)/_home/home-sections.tsx', { stage: 3, reason: 'S-003 / S-004 の刷新（段③）で semantic トークンへ置き換える。移行中 6 行' }],
  // ── 段④
  ['apps/web/app/(main)/(auth)/invite/[token]/invite-form.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で semantic トークンへ置き換える。移行中 8 行' }],
  ['apps/web/app/(main)/(auth)/invite/[token]/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で semantic トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/password-reset/confirm/confirm-form.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で semantic トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/(auth)/password-reset/confirm/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で semantic トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/password-reset/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で semantic トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/password-reset/request-form.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で semantic トークンへ置き換える。移行中 4 行' }],
  ['apps/web/app/(main)/(auth)/signin/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で semantic トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/signin/signin-form.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で semantic トークンへ置き換える。移行中 6 行' }],
  ['apps/web/app/(main)/_shared/sending-domain-guard-banner.tsx', { stage: 4, reason: 'S-035 系（送信ドメインの帯） の刷新（段④）で semantic トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/_shared/sending-domain-status.tsx', { stage: 4, reason: 'S-035 系（送信ドメインの帯） の刷新（段④）で semantic トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/engineers/[id]/detail-section.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で semantic トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/engineers/[id]/edit/not-found.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/engineers/[id]/engineer-proposal-sections.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で semantic トークンへ置き換える。移行中 13 行' }],
  ['apps/web/app/(main)/engineers/[id]/not-found.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/engineers/[id]/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で semantic トークンへ置き換える。移行中 13 行' }],
  ['apps/web/app/(main)/engineers/[id]/skill-sheets/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で semantic トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/[id]/skill-sheets/skill-sheet-screen.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で semantic トークンへ置き換える。移行中 20 行' }],
  ['apps/web/app/(main)/engineers/_form/engineer-form.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で semantic トークンへ置き換える。移行中 24 行' }],
  ['apps/web/app/(main)/projects/[id]/edit/not-found.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/projects/[id]/not-found.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/projects/[id]/page.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/projects/[id]/project-detail-screen.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で semantic トークンへ置き換える。移行中 24 行' }],
  ['apps/web/app/(main)/projects/[id]/visibility/visibility-screen.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で semantic トークンへ置き換える。移行中 37 行' }],
  ['apps/web/app/(main)/projects/_form/project-form.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で semantic トークンへ置き換える。移行中 21 行' }],
  ['apps/web/app/(main)/proposal-requests/[id]/not-found.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposal-requests/[id]/proposal-request-respond-screen.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で semantic トークンへ置き換える。移行中 29 行' }],
  ['apps/web/app/(main)/proposal-requests/proposal-request-screen.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で semantic トークンへ置き換える。移行中 14 行' }],
  ['apps/web/app/(main)/proposals/[id]/approve/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/[id]/approve/proposal-approval-screen.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 52 行' }],
  ['apps/web/app/(main)/proposals/[id]/edit/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/[id]/interview/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/[id]/interview/proposal-interview-screen.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 33 行' }],
  ['apps/web/app/(main)/proposals/[id]/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/[id]/proposal-detail-screen.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 64 行' }],
  ['apps/web/app/(main)/proposals/_editor/proposal-editor.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 38 行' }],
  ['apps/web/app/(main)/proposals/new/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/send-failures/error.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/send-failures/loading.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/proposals/send-failures/send-failure-screen.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で semantic トークンへ置き換える。移行中 26 行' }],
  ['apps/web/app/(main)/settings/organization/organization-form.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で semantic トークンへ置き換える。移行中 7 行' }],
  ['apps/web/app/(main)/settings/organization/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で semantic トークンへ置き換える。移行中 5 行' }],
  ['apps/web/app/(main)/settings/partner-companies/invite-link-panel.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で semantic トークンへ置き換える。移行中 5 行' }],
  ['apps/web/app/(main)/settings/partner-companies/members-panel.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で semantic トークンへ置き換える。移行中 18 行' }],
  ['apps/web/app/(main)/settings/partner-companies/partner-companies-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で semantic トークンへ置き換える。移行中 28 行' }],
  ['apps/web/app/(main)/settings/retention/retention-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で semantic トークンへ置き換える。移行中 16 行' }],
  ['apps/web/app/(main)/settings/sending-domains/sending-domain-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で semantic トークンへ置き換える。移行中 29 行' }],
  ['apps/web/app/(main)/settings/usage/usage-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で semantic トークンへ置き換える。移行中 39 行' }],
  ['apps/web/app/(main)/skills/skill-dictionary-screen.tsx', { stage: 4, reason: 'S-014 系（スキル辞書） の刷新（段④）で semantic トークンへ置き換える。移行中 17 行' }],
  ['apps/web/app/_components/otpauth-qr.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046（認証の外殻） の刷新（段④）で semantic トークンへ置き換える。移行中 1 行' }],
  // ── 段⑤
  ['apps/web/app/admin/_components/console-nav.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 5 行' }],
  ['apps/web/app/admin/_components/console-subject.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/admin/demo/admin-demo-screen.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 23 行' }],
  ['apps/web/app/admin/demo/admin-demo-view.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 28 行' }],
  ['apps/web/app/admin/layout.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/admin/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 9 行' }],
  ['apps/web/app/admin/signin/admin-signin-form.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 7 行' }],
  ['apps/web/app/admin/signin/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/admin/tenants/[id]/contract/deletion-status-screen.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 13 行' }],
  ['apps/web/app/admin/tenants/[id]/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 17 行' }],
  ['apps/web/app/admin/tenants/new/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 4 行' }],
  ['apps/web/app/admin/tenants/new/provisioning-form.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 22 行' }],
  ['apps/web/app/admin/usage/admin-usage-table.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 18 行' }],
  ['apps/web/app/admin/usage/admin-usage-view.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 4 行' }],
  ['apps/web/app/admin/usage/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/admin/usage/quota-override-form.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で semantic トークンへ置き換える。移行中 6 行' }],
]);

/**
 * (b) プリミティブの二重実装（③）— 着手時 1 ファイル / 1 行。
 * 🔴 段① の `T-22-05` が `AppShell` を `packages/ui/src/components/app-shell.tsx` へ移したら
 *    **この 1 行を消す**（消さなければ ② で落ちる）。理由は `ui-ratchet-baseline.ts` の同名の定数。
 */
export const UI_RATCHET_ALLOWLIST_B: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 段①
  [
    'apps/web/app/(main)/_shell/app-shell.tsx',
    {
      stage: 1,
      reason:
        '外枠（AppShell）の刷新（段① / T-22-05）で `packages/ui/src/components/app-shell.tsx` へ移すまでの移行中。' +
        'T-12-20 が `apps/web` 側に置いた `export function AppShell` が 1 件残っている',
    },
  ],
]);

/**
 * (c) 画面の幅指定 — 着手時 67 ファイル / 78 行。
 * 🔴 段が進むごとに削る。空になった時点で (c) 画面の幅指定 は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_C: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 段①
  ['apps/web/app/global-error.tsx', { stage: 1, reason: '外枠（root error boundary） の刷新（段①）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  // ── 段②
  ['apps/web/app/(main)/audit-logs/page.tsx', { stage: 2, reason: 'S-041 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/engineer-shares/page.tsx', { stage: 2, reason: 'S-015 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/(list)/error.tsx', { stage: 2, reason: 'S-005 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/(list)/loading.tsx', { stage: 2, reason: 'S-005 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/(list)/page.tsx', { stage: 2, reason: 'S-005 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/(list)/error.tsx', { stage: 2, reason: 'S-010 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/(list)/loading.tsx', { stage: 2, reason: 'S-010 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/(list)/page.tsx', { stage: 2, reason: 'S-010 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/[id]/candidates/page.tsx', { stage: 2, reason: 'S-016 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/(list)/error.tsx', { stage: 2, reason: 'S-019 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/(list)/loading.tsx', { stage: 2, reason: 'S-019 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/(list)/page.tsx', { stage: 2, reason: 'S-019 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/admin/audit-logs/admin-audit-logs-results.tsx', { stage: 2, reason: 'A-006 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/admin/audit-logs/page.tsx', { stage: 2, reason: 'A-006 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/admin/monitoring/page.tsx', { stage: 2, reason: 'A-005 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/admin/tenants/page.tsx', { stage: 2, reason: 'A-002 の刷新（段②）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  // ── 段③
  ['apps/web/app/(main)/page.tsx', { stage: 3, reason: 'S-003 / S-004 の刷新（段③）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  // ── 段④
  ['apps/web/app/(main)/engineers/[id]/edit/not-found.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/[id]/edit/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/[id]/not-found.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/[id]/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/[id]/skill-sheets/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/[id]/skill-sheets/skill-sheet-screen.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 2 行' }],
  ['apps/web/app/(main)/engineers/new/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/[id]/edit/not-found.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/[id]/edit/page.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/[id]/not-found.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/[id]/page.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 2 行' }],
  ['apps/web/app/(main)/projects/[id]/visibility/page.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/new/page.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposal-requests/[id]/not-found.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposal-requests/[id]/page.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposal-requests/page.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/approve/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/approve/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/edit/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/edit/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/interview/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/interview/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/new/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/send-failures/error.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/send-failures/loading.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/send-failures/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/organization/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/partner-companies/members-panel.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 2 行' }],
  ['apps/web/app/(main)/settings/partner-companies/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/partner-companies/partner-companies-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 5 行' }],
  ['apps/web/app/(main)/settings/retention/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/sending-domains/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/sending-domains/sending-domain-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/usage/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/usage/usage-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/skills/page.tsx', { stage: 4, reason: 'S-014 系（スキル辞書） の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/(main)/skills/skill-dictionary-screen.tsx', { stage: 4, reason: 'S-014 系（スキル辞書） の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/_components/auth-shell.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046（認証の外殻） の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/_components/otpauth-qr.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046（認証の外殻） の刷新（段④）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  // ── 段⑤
  ['apps/web/app/admin/demo/admin-demo-screen.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` の幅 3 クラスへ移す。移行中 2 行' }],
  ['apps/web/app/admin/demo/admin-demo-view.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/admin/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/admin/tenants/[id]/contract/deletion-status-screen.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/admin/tenants/[id]/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` の幅 3 クラスへ移す。移行中 2 行' }],
  ['apps/web/app/admin/tenants/new/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/admin/usage/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
  ['apps/web/app/admin/usage/quota-override-form.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` の幅 3 クラスへ移す。移行中 1 行' }],
]);

/**
 * (f) spacing 7 段 — 着手時 19 ファイル / 26 行。
 * 🔴 段が進むごとに削る。空になった時点で (f) spacing 7 段 は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_F: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 段①
  ['apps/web/app/(main)/_shell/app-shell.tsx', { stage: 1, reason: '外枠（AppShell / PageHeading） の刷新（段①）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  ['apps/web/app/global-error.tsx', { stage: 1, reason: '外枠（root error boundary） の刷新（段①）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  // ── 段②
  ['apps/web/app/(main)/audit-logs/audit-log-detail.tsx', { stage: 2, reason: 'S-041 の刷新（段②）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  ['apps/web/app/(main)/audit-logs/audit-logs-view.tsx', { stage: 2, reason: 'S-041 の刷新（段②）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/engineer-ledger-screen.tsx', { stage: 2, reason: 'S-005 の刷新（段②）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  ['apps/web/app/(main)/projects/[id]/candidates/candidate-screen.tsx', { stage: 2, reason: 'S-016 の刷新（段②）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  // ── 段④
  ['apps/web/app/(main)/(auth)/invite/[token]/invite-form.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/signin/signin-form.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  ['apps/web/app/(main)/projects/[id]/visibility/visibility-screen.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で §7.9 の 7 段へ寄せる。移行中 2 行' }],
  ['apps/web/app/(main)/proposal-requests/[id]/proposal-request-respond-screen.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で §7.9 の 7 段へ寄せる。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/[id]/approve/proposal-approval-screen.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 7 段へ寄せる。移行中 3 行' }],
  ['apps/web/app/(main)/proposals/[id]/proposal-detail-screen.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 7 段へ寄せる。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/_editor/proposal-editor.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/send-failures/send-failure-screen.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 7 段へ寄せる。移行中 2 行' }],
  ['apps/web/app/(main)/settings/usage/usage-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  // ── 段⑤
  ['apps/web/app/admin/signin/admin-signin-form.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  ['apps/web/app/admin/tenants/new/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  ['apps/web/app/admin/tenants/new/provisioning-form.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 7 段へ寄せる。移行中 1 行' }],
  ['apps/web/app/admin/usage/admin-usage-table.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 7 段へ寄せる。移行中 2 行' }],
]);

/**
 * (g) 文字サイズ 6 トークン — 着手時 90 ファイル / 667 行。
 * 🔴 段が進むごとに削る。空になった時点で (g) 文字サイズ 6 トークン は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_G: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 段①
  ['apps/web/app/(main)/_shell/app-shell.tsx', { stage: 1, reason: '外枠（AppShell / PageHeading） の刷新（段①）で §7.9 の 6 トークンへ置き換える。移行中 4 行' }],
  ['apps/web/app/(main)/_shell/page-heading.tsx', { stage: 1, reason: '外枠（AppShell / PageHeading） の刷新（段①）で §7.9 の 6 トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/global-error.tsx', { stage: 1, reason: '外枠（root error boundary） の刷新（段①）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  // ── 段②
  ['apps/web/app/(main)/audit-logs/audit-log-detail.tsx', { stage: 2, reason: 'S-041 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/audit-logs/audit-logs-view.tsx', { stage: 2, reason: 'S-041 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/engineer-shares/engineer-share-screen.tsx', { stage: 2, reason: 'S-015 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 15 行' }],
  ['apps/web/app/(main)/engineers/(list)/error.tsx', { stage: 2, reason: 'S-005 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/engineers/(list)/loading.tsx', { stage: 2, reason: 'S-005 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/engineers/engineer-ledger-screen.tsx', { stage: 2, reason: 'S-005 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 9 行' }],
  ['apps/web/app/(main)/projects/(list)/error.tsx', { stage: 2, reason: 'S-010 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/projects/(list)/loading.tsx', { stage: 2, reason: 'S-010 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/projects/[id]/candidates/candidate-screen.tsx', { stage: 2, reason: 'S-016 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 22 行' }],
  ['apps/web/app/(main)/projects/[id]/candidates/page.tsx', { stage: 2, reason: 'S-016 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/projects/project-list-screen.tsx', { stage: 2, reason: 'S-010 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 6 行' }],
  ['apps/web/app/(main)/proposals/(list)/error.tsx', { stage: 2, reason: 'S-019 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/(list)/loading.tsx', { stage: 2, reason: 'S-019 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/(list)/proposal-list-screen.tsx', { stage: 2, reason: 'S-019 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 8 行' }],
  ['apps/web/app/admin/audit-logs/admin-audit-logs-results.tsx', { stage: 2, reason: 'A-006 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/admin/audit-logs/admin-audit-logs-view.tsx', { stage: 2, reason: 'A-006 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 5 行' }],
  ['apps/web/app/admin/audit-logs/page.tsx', { stage: 2, reason: 'A-006 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/admin/monitoring/admin-monitoring-items.tsx', { stage: 2, reason: 'A-005 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 5 行' }],
  ['apps/web/app/admin/monitoring/admin-monitoring-view.tsx', { stage: 2, reason: 'A-005 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/admin/monitoring/page.tsx', { stage: 2, reason: 'A-005 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/admin/tenants/admin-tenants-list.tsx', { stage: 2, reason: 'A-002 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 7 行' }],
  ['apps/web/app/admin/tenants/page.tsx', { stage: 2, reason: 'A-002 の刷新（段②）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  // ── 段③
  ['apps/web/app/(main)/_home/action-queue-section.tsx', { stage: 3, reason: 'S-003 / S-004 の刷新（段③）で §7.9 の 6 トークンへ置き換える。移行中 4 行' }],
  ['apps/web/app/(main)/_home/home-sections.tsx', { stage: 3, reason: 'S-003 / S-004 の刷新（段③）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  // ── 段④
  ['apps/web/app/(main)/(auth)/invite/[token]/invite-form.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 5 行' }],
  ['apps/web/app/(main)/(auth)/invite/[token]/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/password-reset/confirm/confirm-form.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/(auth)/password-reset/confirm/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/password-reset/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/password-reset/request-form.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 4 行' }],
  ['apps/web/app/(main)/(auth)/signin/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/signin/signin-form.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 6 行' }],
  ['apps/web/app/(main)/_shared/sending-domain-guard-banner.tsx', { stage: 4, reason: 'S-035 系（送信ドメインの帯） の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/_shared/sending-domain-status.tsx', { stage: 4, reason: 'S-035 系（送信ドメインの帯） の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/(main)/engineers/[id]/detail-section.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/[id]/edit/not-found.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/engineers/[id]/engineer-proposal-sections.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 9 行' }],
  ['apps/web/app/(main)/engineers/[id]/not-found.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/engineers/[id]/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 8 行' }],
  ['apps/web/app/(main)/engineers/[id]/skill-sheets/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/[id]/skill-sheets/skill-sheet-screen.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 12 行' }],
  ['apps/web/app/(main)/engineers/_form/engineer-form.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 25 行' }],
  ['apps/web/app/(main)/projects/[id]/edit/not-found.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/projects/[id]/not-found.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/projects/[id]/page.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/projects/[id]/project-detail-screen.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 13 行' }],
  ['apps/web/app/(main)/projects/[id]/visibility/visibility-screen.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 26 行' }],
  ['apps/web/app/(main)/projects/_form/project-form.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 16 行' }],
  ['apps/web/app/(main)/proposal-requests/[id]/not-found.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposal-requests/[id]/proposal-request-respond-screen.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 26 行' }],
  ['apps/web/app/(main)/proposal-requests/proposal-request-screen.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 11 行' }],
  ['apps/web/app/(main)/proposals/[id]/approve/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/[id]/approve/proposal-approval-screen.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 31 行' }],
  ['apps/web/app/(main)/proposals/[id]/edit/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/[id]/interview/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/[id]/interview/proposal-interview-screen.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 22 行' }],
  ['apps/web/app/(main)/proposals/[id]/not-found.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/[id]/proposal-detail-screen.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 38 行' }],
  ['apps/web/app/(main)/proposals/_editor/proposal-editor.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 27 行' }],
  ['apps/web/app/(main)/proposals/new/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/send-failures/error.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/send-failures/loading.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/(main)/proposals/send-failures/send-failure-screen.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 17 行' }],
  ['apps/web/app/(main)/settings/organization/organization-form.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 9 行' }],
  ['apps/web/app/(main)/settings/organization/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 5 行' }],
  ['apps/web/app/(main)/settings/partner-companies/invite-link-panel.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/(main)/settings/partner-companies/members-panel.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 8 行' }],
  ['apps/web/app/(main)/settings/partner-companies/partner-companies-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 17 行' }],
  ['apps/web/app/(main)/settings/retention/retention-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 15 行' }],
  ['apps/web/app/(main)/settings/sending-domains/sending-domain-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 16 行' }],
  ['apps/web/app/(main)/settings/usage/usage-screen.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 18 行' }],
  ['apps/web/app/(main)/skills/skill-dictionary-screen.tsx', { stage: 4, reason: 'S-014 系（スキル辞書） の刷新（段④）で §7.9 の 6 トークンへ置き換える。移行中 16 行' }],
  // ── 段⑤
  ['apps/web/app/admin/_components/console-nav.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/admin/demo/admin-demo-screen.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 16 行' }],
  ['apps/web/app/admin/demo/admin-demo-view.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 19 行' }],
  ['apps/web/app/admin/layout.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/admin/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 9 行' }],
  ['apps/web/app/admin/signin/admin-signin-form.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 7 行' }],
  ['apps/web/app/admin/signin/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/admin/tenants/[id]/contract/deletion-status-screen.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 11 行' }],
  ['apps/web/app/admin/tenants/[id]/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 15 行' }],
  ['apps/web/app/admin/tenants/new/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/admin/tenants/new/provisioning-form.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 14 行' }],
  ['apps/web/app/admin/usage/admin-usage-table.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 2 行' }],
  ['apps/web/app/admin/usage/admin-usage-view.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 3 行' }],
  ['apps/web/app/admin/usage/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 1 行' }],
  ['apps/web/app/admin/usage/quota-override-form.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で §7.9 の 6 トークンへ置き換える。移行中 5 行' }],
]);

/**
 * (j) 8 状態のバリアント — 着手時 18 ファイル / 30 行。
 * 🔴 段が進むごとに削る。空になった時点で (j) 8 状態のバリアント は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_J: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 段①
  ['apps/web/app/(main)/_shell/app-shell.tsx', { stage: 1, reason: '外枠（AppShell / PageHeading） の刷新（段①）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
  ['apps/web/app/(main)/_shell/page-heading.tsx', { stage: 1, reason: '外枠（AppShell / PageHeading） の刷新（段①）で プリミティブ側の 8 状態に委ねる。移行中 2 行' }],
  // ── 段②
  ['apps/web/app/(main)/audit-logs/audit-logs-view.tsx', { stage: 2, reason: 'S-041 の刷新（段②）で プリミティブ側の 8 状態に委ねる。移行中 3 行' }],
  ['apps/web/app/(main)/projects/[id]/candidates/candidate-screen.tsx', { stage: 2, reason: 'S-016 の刷新（段②）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/(list)/proposal-list-screen.tsx', { stage: 2, reason: 'S-019 の刷新（段②）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
  ['apps/web/app/admin/audit-logs/admin-audit-logs-results.tsx', { stage: 2, reason: 'A-006 の刷新（段②）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
  ['apps/web/app/admin/monitoring/admin-monitoring-items.tsx', { stage: 2, reason: 'A-005 の刷新（段②）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
  ['apps/web/app/admin/tenants/admin-tenants-list.tsx', { stage: 2, reason: 'A-002 の刷新（段②）で プリミティブ側の 8 状態に委ねる。移行中 3 行' }],
  ['apps/web/app/admin/tenants/page.tsx', { stage: 2, reason: 'A-002 の刷新（段②）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
  // ── 段③
  ['apps/web/app/(main)/_home/action-queue-section.tsx', { stage: 3, reason: 'S-003 / S-004 の刷新（段③）で プリミティブ側の 8 状態に委ねる。移行中 2 行' }],
  // ── 段⑤
  ['apps/web/app/admin/_components/console-nav.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
  ['apps/web/app/admin/demo/admin-demo-screen.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
  ['apps/web/app/admin/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で プリミティブ側の 8 状態に委ねる。移行中 5 行' }],
  ['apps/web/app/admin/tenants/[id]/contract/deletion-status-screen.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
  ['apps/web/app/admin/tenants/[id]/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で プリミティブ側の 8 状態に委ねる。移行中 3 行' }],
  ['apps/web/app/admin/tenants/new/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
  ['apps/web/app/admin/tenants/new/provisioning-form.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
  ['apps/web/app/admin/usage/admin-usage-table.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で プリミティブ側の 8 状態に委ねる。移行中 1 行' }],
]);

/**
 * (k) 幅クラスの網羅 — 着手時 43 ファイル / 43 行。
 * 🔴 段が進むごとに削る。空になった時点で (k) 幅クラスの網羅 は無条件 green になる（`SP-22` §4.1 段⑤）。
 */
export const UI_RATCHET_ALLOWLIST_K: ReadonlyMap<string, AllowEntry> = new Map<string, AllowEntry>([
  // ── 段②
  ['apps/web/app/(main)/audit-logs/page.tsx', { stage: 2, reason: 'S-041 の刷新（段②）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/engineer-shares/page.tsx', { stage: 2, reason: 'S-015 の刷新（段②）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/(list)/page.tsx', { stage: 2, reason: 'S-005 の刷新（段②）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/(list)/page.tsx', { stage: 2, reason: 'S-010 の刷新（段②）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/[id]/candidates/page.tsx', { stage: 2, reason: 'S-016 の刷新（段②）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/(list)/page.tsx', { stage: 2, reason: 'S-019 の刷新（段②）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/admin/audit-logs/page.tsx', { stage: 2, reason: 'A-006 の刷新（段②）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/admin/monitoring/page.tsx', { stage: 2, reason: 'A-005 の刷新（段②）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/admin/tenants/page.tsx', { stage: 2, reason: 'A-002 の刷新（段②）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  // ── 段③
  ['apps/web/app/(main)/page.tsx', { stage: 3, reason: 'S-003 / S-004 の刷新（段③）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  // ── 段④
  ['apps/web/app/(main)/(auth)/invite/[token]/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/password-reset/confirm/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/password-reset/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/(auth)/signin/page.tsx', { stage: 4, reason: 'S-001 / S-002 / S-046 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/[id]/edit/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/[id]/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/[id]/skill-sheets/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/engineers/new/page.tsx', { stage: 4, reason: 'S-006〜S-009 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/[id]/edit/page.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/[id]/page.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/[id]/visibility/page.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/projects/new/page.tsx', { stage: 4, reason: 'S-011〜S-014 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/proposal-requests/[id]/page.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/proposal-requests/page.tsx', { stage: 4, reason: 'S-017 / S-022 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/approve/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/edit/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/interview/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/[id]/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/new/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/proposals/send-failures/page.tsx', { stage: 4, reason: 'S-018 / S-020 / S-021 / S-023 / S-024 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/organization/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/partner-companies/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/retention/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/sending-domains/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/settings/usage/page.tsx', { stage: 4, reason: 'S-035 / S-036 / S-038 / S-042 の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/(main)/skills/page.tsx', { stage: 4, reason: 'S-014 系（スキル辞書） の刷新（段④）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  // ── 段⑤
  ['apps/web/app/admin/demo/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/admin/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/admin/signin/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/admin/tenants/[id]/contract/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/admin/tenants/[id]/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/admin/tenants/new/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
  ['apps/web/app/admin/usage/page.tsx', { stage: 5, reason: 'A-001 / A-003 / A-004 / A-010 / A-012 / A-014 / /admin の刷新（段⑤）で `PageBody` に `widthClass` を渡す。移行中 1 行' }],
]);

