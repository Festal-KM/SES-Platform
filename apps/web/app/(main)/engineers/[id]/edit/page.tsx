// apps/web/app/(main)/engineers/[id]/edit/page.tsx
// `S-007` エンジニアの編集。docs/04 §S-007 / `F-008` / docs/05 §6.4 #16。T-05-01。
//
// 🔴 **境界外の ID は 404**（docs/05 §4.8「見えない ＝ 存在しない」/ `F-008 AC-3`）。
//    母集団を絞るのは RLS の C3 であり、この画面に `where` を足さない。ホスト所属の利用者が
//    他パートナーのエンジニア ID を URL 直打ちしても、`readEngineerForEdit` が 404 になる。
// 🔴 **閲覧を `AuditLog` に記録する**（`BR-27` / `F-008 AC-4`）。氏名・連絡先という PII を
//    画面に出す以上、記録できないなら**内容を返さない**（記録は業務トランザクションの内側）。
// 🔴 `VIEWER` は到達できない（docs/04 §S-007 権限差分）。
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { NotFoundError } from '../../../../../lib/api/errors';
import { readRequestMeta, resolveTenantCtxOutcome } from '../../../../../lib/auth/session';
import { readEngineerForEdit } from '../../../../../lib/engineers/service';
import { listSkills } from '../../../../../lib/skills/service';
import { EngineerForm } from '../../_form/engineer-form';
import {
  availabilityOptions,
  engineerFormMessages,
  ownershipLabel,
  prefectureOptions,
  remoteModeOptions,
  skillLevelOptions,
  toEngineerFormValues,
} from '../../_form/form-props';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: t('engineers.edit.title') };

const HOME_PATH = '/';

export default async function EditEngineerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');
  if (outcome.ctx.role === 'VIEWER') redirect(HOME_PATH);

  const { id } = await params;
  const meta = await readRequestMeta();

  const view = await readEngineerForEdit(outcome.ctx, id, { ipAddress: meta.ipAddress }).catch(
    (error: unknown) => {
      // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  // 🔴 T-05-03: 辞書の読み取りは `#23` と同じ関数を通す（`new/page.tsx` と同じ理由）。
  const skillDictionary = (await listSkills(outcome.ctx, {})).items;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('engineers.breadcrumb.home')} / {t('engineers.breadcrumb.list')} /{' '}
        {t('engineers.breadcrumb.edit')}
      </p>
      <h1 className="mb-6 text-xl font-bold text-slate-900">{t('engineers.edit.title')}</h1>
      <EngineerForm
        mode="EDIT"
        engineerId={view.id}
        initial={toEngineerFormValues(view)}
        skillDictionary={skillDictionary}
        availabilityOptions={availabilityOptions}
        remoteModeOptions={remoteModeOptions}
        prefectureOptions={prefectureOptions}
        levelOptions={skillLevelOptions}
        // 🔴 T-05-02: 編集のキャンセルは `S-006`（詳細）へ戻す（docs/04 §S-007 関連画面）。
        //    新規登録（`/engineers/new`）は戻り先の詳細がまだ無いため
        //    `ENGINEER_FORM_CANCEL_HREF` のままである。
        cancelHref={`/engineers/${view.id}`}
        // 🔴 所属区分は**行の値**（`view.ownership`）ではなく、行が自社のものであることが
        //    RLS で確定している前提で ctx から表示する。どちらでも同じ値になるが、
        //    「入力でも行でもなく ctx が所属を決める」という規律に画面を合わせる。
        messages={engineerFormMessages(ownershipLabel(outcome.ctx.partnerCompanyId))}
      />
    </main>
  );
}
