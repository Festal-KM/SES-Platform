// apps/web/app/admin/demo/_lib/messages.ts
// `A-012` デモ環境の合成データ管理の文言（`packages/i18n` → 純粋な描画部品の props）。T-10-06。
// 🔴 文言は `packages/i18n` にのみ置く（`CLAUDE.md` §3.5）。ここは `t()` の呼び出しの束であり、文言そのものを書かない。
import { t } from '@ses/i18n';
import type { AdminDemoScreenMessages } from '../admin-demo-screen';

export function adminDemoMessages(): AdminDemoScreenMessages {
  return {
    title: t('admin.demo.title'),
    unavailable: t('admin.demo.unavailable'),
    environment: {
      section: t('admin.demo.section.environment'),
      label: t('admin.demo.environment.label'),
      note: t('admin.demo.environment.note'),
    },
    status: {
      section: t('admin.demo.section.status'),
      notSeeded: t('admin.demo.status.notSeeded'),
      seededAt: t('admin.demo.status.seededAt'),
      tenants: t('admin.demo.status.tenants'),
      columns: {
        tenant: t('admin.demo.status.column.tenant'),
        partners: t('admin.demo.status.column.partners'),
        engineers: t('admin.demo.status.column.engineers'),
        projects: t('admin.demo.status.column.projects'),
        proposalsInProgress: t('admin.demo.status.column.proposalsInProgress'),
        assignmentsExpiring: t('admin.demo.status.column.assignmentsExpiring'),
        gateFailed: t('admin.demo.status.column.gateFailed'),
        shared: t('admin.demo.status.column.shared'),
      },
      syntheticNote: t('admin.demo.status.syntheticNote'),
    },
    seed: {
      section: t('admin.demo.section.seed'),
      dataset: t('admin.demo.seed.dataset'),
      datasetName: t('admin.demo.seed.datasetName'),
      lead: t('admin.demo.seed.lead'),
      submit: t('admin.demo.seed.submit'),
      confirmTitle: t('admin.demo.seed.confirm.title'),
      confirmLead: t('admin.demo.seed.confirm.lead'),
      confirmEnvironment: t('admin.demo.seed.confirm.environment'),
      confirmSubmit: t('admin.demo.seed.confirm.submit'),
      confirmBack: t('admin.demo.seed.confirm.back'),
      submitting: t('admin.demo.seed.submitting'),
      done: t('admin.demo.seed.done'),
      alreadySeeded: t('admin.demo.seed.alreadySeeded'),
      failed: t('admin.demo.seed.failed'),
      retry: t('admin.demo.seed.retry'),
      notConfigured: t('admin.demo.seed.notConfigured'),
      resetComingSoon: t('admin.demo.reset.comingSoon'),
    },
    scenarios: {
      section: t('admin.demo.section.scenarios'),
      lead: t('admin.demo.scenarios.lead'),
      start: t('admin.demo.scenario.start'),
      a: {
        title: t('admin.demo.scenario.a.title'),
        steps: [
          t('admin.demo.scenario.a.step1'),
          t('admin.demo.scenario.a.step2'),
          t('admin.demo.scenario.a.step3'),
          t('admin.demo.scenario.a.step4'),
          t('admin.demo.scenario.a.step5'),
        ],
      },
      b: {
        title: t('admin.demo.scenario.b.title'),
        steps: [t('admin.demo.scenario.b.step1'), t('admin.demo.scenario.b.step2')],
      },
      accounts: {
        title: t('admin.demo.accounts.title'),
        lead: t('admin.demo.accounts.lead'),
        hostSales: t('admin.demo.accounts.hostSales'),
        partnerSales: t('admin.demo.accounts.partnerSales'),
        password: t('admin.demo.accounts.password'),
      },
    },
  };
}
