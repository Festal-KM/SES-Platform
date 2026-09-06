// apps/web/app/(main)/engineers/new/page.tsx
// `S-007` エンジニアの登録（新規）。docs/04 §S-007 / `F-008` / `F-010` / docs/05 §6.4 #16。T-05-01。
//
// 🔴 **`VIEWER` は到達できない**（docs/04 §S-007 権限差分）。画面で止めるのは補助であり、
//    拒否の本体は `#16` の `requireRole` / `requireNotViewer` である（`F-004 AC-9`）。
// 🔴 パートナー所属の利用者も到達してよい（自社エンジニアを登録する。`F-008` 関連ロール）。
//    所有パートナーは ctx から決まるので、画面に選択肢を出さない（`F-008 AC-2`）。
// 🔴 スキル辞書はサーバコンポーネントから直接読む（自己 fetch しない。`S-014` と同じ方針）。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import { listSkills } from '../../../../lib/skills/service';
import { EngineerForm } from '../_form/engineer-form';
import {
  availabilityOptions,
  EMPTY_ENGINEER_FORM_VALUES,
  ENGINEER_FORM_CANCEL_HREF,
  engineerFormMessages,
  ownershipLabel,
  prefectureOptions,
  remoteModeOptions,
  skillLevelOptions,
} from '../_form/form-props';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('engineers.new.title') };

const HOME_PATH = '/';

export default async function NewEngineerPage() {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  if (outcome.ctx.role === 'VIEWER') redirect(HOME_PATH);

  // 🔴 T-05-03: 辞書の読み取りは `#23`（`GET /api/skills`）と**同じ関数**を通す
  //    （`lib/skills/service.ts`）。画面用に別の読み取りを書くと、並び順と絞り込みが
  //    API と画面でずれる。
  const skillDictionary = (await listSkills(outcome.ctx, {})).items;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {/* 🔴 T-05-09: 「人材」を `S-005`（一覧）へのリンクにした（戻り経路を文字だけにしない）。 */}
      <p className="mb-1 text-sm text-slate-500">
        {t('engineers.breadcrumb.home')} /{' '}
        <Link className="underline" href="/engineers">
          {t('engineers.breadcrumb.list')}
        </Link>{' '}
        / {t('engineers.breadcrumb.new')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('engineers.new.title')}</h1>
      <EngineerForm
        mode="CREATE"
        engineerId={null}
        initial={EMPTY_ENGINEER_FORM_VALUES}
        skillDictionary={skillDictionary}
        availabilityOptions={availabilityOptions}
        remoteModeOptions={remoteModeOptions}
        prefectureOptions={prefectureOptions}
        levelOptions={skillLevelOptions}
        cancelHref={ENGINEER_FORM_CANCEL_HREF}
        messages={engineerFormMessages(ownershipLabel(outcome.ctx.partnerCompanyId))}
      />
    </main>
  );
}
