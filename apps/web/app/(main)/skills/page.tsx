// apps/web/app/(main)/skills/page.tsx
// `S-009` スキル辞書・別名・新語候補（docs/04 §S-009 / `F-010` / docs/05 §6.4 #23 #24）。T-05-03。
//
// 🔴 **ロールで到達を止めない**（docs/04 §S-009 の必要ロールは `OW/AD/SA/PA/PS/VI` = 全ロール）。
//    取引先も `VIEWER` もこの画面に到達してよい —— 辞書と別名は分類のためのマスタであり、
//    他パートナーが持ち込んだ業務情報を 1 つも含まない（`docs/02` 章 4.2 の `F-010` = `◐`）。
//    見えるものが変わるのはロール判定ではなく `skill_aliases` の RLS（C1）である。
// 🔴 採否の導線だけを `canDecide` で分ける（docs/04 §S-009 権限差分）。判定は
//    `isSkillAliasDeciderRole` の 1 か所で、**API の `requireRole` と同じ定数**を見る。
// 🔴 一覧はサーバコンポーネントから直接読む（自己 fetch しない。`S-014` / `S-007` と同じ方針）。
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../lib/auth/session';
import { isSkillAliasDeciderRole } from '../../../lib/skills/policy';
import { listSkillAliases, listSkills } from '../../../lib/skills/service';
import { SkillDictionaryScreen } from './skill-dictionary-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('skillDictionary.title') };

export default async function SkillDictionaryPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const ctx = outcome.ctx;
  const [aliases, skills] = await Promise.all([listSkillAliases(ctx, {}), listSkills(ctx, {})]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('skillDictionary.breadcrumb.home')} / {t('skillDictionary.breadcrumb.current')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('skillDictionary.title')}</h1>
      <SkillDictionaryScreen
        initialAliases={aliases}
        initialSkills={skills}
        // 🔴 パートナー所属は `ADMIN` / `SALES` になりえない（`memberships` の CHECK 制約）ため、
        //    このロール判定だけで「取引先は起票のみ」（`F-010 AC-1`）が成立する。
        canDecide={isSkillAliasDeciderRole(ctx.role)}
        messages={{
          sectionCandidates: t('skillDictionary.section.candidates'),
          candidatesNote: t('skillDictionary.candidates.note'),
          candidatesEmpty: t('skillDictionary.candidates.empty'),
          candidatesColumnAlias: t('skillDictionary.candidates.column.alias'),
          candidatesColumnOrigin: t('skillDictionary.candidates.column.origin'),
          candidatesColumnProposedAt: t('skillDictionary.candidates.column.proposedAt'),
          candidatesColumnTarget: t('skillDictionary.candidates.column.target'),
          candidatesColumnActions: t('skillDictionary.candidates.column.actions'),
          candidatesTargetPlaceholder: t('skillDictionary.candidates.target.placeholder'),
          candidatesAccept: t('skillDictionary.candidates.accept'),
          candidatesReject: t('skillDictionary.candidates.reject'),
          candidatesSubmitting: t('skillDictionary.candidates.submitting'),
          candidatesAcceptHint: t('skillDictionary.candidates.acceptHint'),
          candidatesRejectNote: t('skillDictionary.candidates.rejectNote'),
          candidatesError: t('skillDictionary.candidates.error'),
          candidatesReadOnlyNote: t('skillDictionary.candidates.readOnlyNote'),
          candidatesOccurrenceComingSoon: t('skillDictionary.candidates.occurrenceComingSoon'),

          sectionAliases: t('skillDictionary.section.aliases'),
          aliasesNote: t('skillDictionary.aliases.note'),
          aliasesEmpty: t('skillDictionary.aliases.empty'),
          aliasesColumnAlias: t('skillDictionary.aliases.column.alias'),
          aliasesColumnTarget: t('skillDictionary.aliases.column.target'),
          aliasesColumnScope: t('skillDictionary.aliases.column.scope'),
          aliasesColumnDecidedAt: t('skillDictionary.aliases.column.decidedAt'),
          scopeLabels: {
            TENANT: t('skillDictionary.scope.TENANT'),
            GLOBAL: t('skillDictionary.scope.GLOBAL'),
          },
          originLabels: {
            HUMAN: t('skillDictionary.origin.HUMAN'),
            AI: t('skillDictionary.origin.AI'),
          },

          sectionDictionary: t('skillDictionary.section.dictionary'),
          dictionaryReadOnlyNote: t('skillDictionary.dictionary.readOnlyNote'),
          dictionarySearchLabel: t('skillDictionary.dictionary.search.label'),
          dictionarySearchSubmit: t('skillDictionary.dictionary.search.submit'),
          dictionarySearchSubmitting: t('skillDictionary.dictionary.search.submitting'),
          dictionaryColumnName: t('skillDictionary.dictionary.column.name'),
          dictionaryColumnCategory: t('skillDictionary.dictionary.column.category'),
          dictionaryEmpty: t('skillDictionary.dictionary.empty'),
          dictionaryError: t('skillDictionary.dictionary.error'),

          valueNone: t('skillDictionary.value.none'),
        }}
      />
    </main>
  );
}
