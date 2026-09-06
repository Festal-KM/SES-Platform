// apps/web/app/(main)/engineers/[id]/page.tsx
// `S-006` エンジニア詳細。docs/04 §S-006 / `F-008` / docs/05 §6.4 #17。T-05-02。
//
// 🔴 **閲覧を `AuditLog` に記録する**（`BR-27` / `F-008 AC-4`）。記録は `readEngineerDetail` の
//    業務トランザクションの内側で書かれ、**書けなければ内容が返らない**（`F-012 AC-2` と同じ規律）。
//    画面と `GET /api/engineers/{id}`（#17）が同じ関数を通るので、**経路によって記録が漏れない**
//    （`CLAUDE.md` §13.3「モバイルだけ記録が漏れる実装にしない」/ `BR-28` と同じ形）。
// 🔴 **境界外の ID は 404**（docs/05 §4.8 / `F-008 AC-3`）。母集団を絞るのは `engineers` の
//    RLS（C3）であり、この画面に `where` を足さない。ホスト所属の利用者が他パートナー所有の
//    エンジニア ID を URL 直打ちしても、実名・所属会社名に到達できない。
// 🔴 `VIEWER` は**到達できる**（閲覧のみ。`F-012 AC-3` / `BR-31`）。編集への導線だけを出さない。
//
// 🔴 T2（モバイル閲覧可）。稼働状況・稼働可能時期・単価レンジは**折りたたみの外**に置く
//    （`CLAUDE.md` §13.3 / docs/04 §S-006「移動中に見る値」）。セクションは `<details open>` で
//    既定は開いた状態にする —— 折りたためるだけで、既定で隠す項目は 1 つも無い。
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { NotFoundError } from '../../../../lib/api/errors';
import { readRequestMeta, resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import {
  engineerBasicRows,
  engineerDetailSkillRows,
  engineerHeadlineRows,
} from '../../../../lib/engineers/detail';
import { engineerOwnershipLabel } from '../../../../lib/engineers/labels';
import { readEngineerDetail } from '../../../../lib/engineers/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 タイトルに氏名を入れない（ブラウザの履歴・タブ・共有時のプレビューに PII が残るため）。
 *    氏名は本文の見出しにだけ出す。
 */
export const metadata: Metadata = { title: t('engineers.detail.title') };

function DetailSection({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="border border-slate-200 bg-white" data-testid={`engineer-detail-${id}`}>
      <details open>
        <summary className="cursor-pointer px-4 py-3 text-base font-bold text-slate-900">
          {title}
        </summary>
        <div className="border-t border-slate-200 px-4 py-4">{children}</div>
      </details>
    </section>
  );
}

export default async function EngineerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const { id } = await params;
  const meta = await readRequestMeta();

  const view = await readEngineerDetail(outcome.ctx, id, { ipAddress: meta.ipAddress }).catch(
    (error: unknown) => {
      // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  // 🔴 所属区分は**行の値ではなく ctx** から作る（`F-008 AC-2`。`detail.ts` の注記）。
  const ownership = engineerOwnershipLabel(outcome.ctx.partnerCompanyId);
  const headline = engineerHeadlineRows(view);
  const basicRows = engineerBasicRows(view, ownership);
  const skillRows = engineerDetailSkillRows(view.skills);
  // 🔴 `VIEWER` は `S-007` に到達できない（docs/04 §S-007 権限差分）。押しても戻されるだけの
  //    導線を描かない。⚠️ これは UI の配慮であって拒否の本体ではない（本体は #16 のガードと
  //    `S-007` のリダイレクト）。
  const canEdit = outcome.ctx.role !== 'VIEWER';

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {/* 🔴 T-05-09: 「人材」を `S-005`（一覧）へのリンクにした（docs/04 §S-006 関連画面
          「← `S-005`」の戻り経路。パンくずが文字だけだと一覧へ戻れない）。 */}
      <p className="mb-1 text-sm text-slate-500">
        {t('engineers.breadcrumb.home')} /{' '}
        <Link className="underline" href="/engineers" data-testid="engineer-detail-list-link">
          {t('engineers.breadcrumb.list')}
        </Link>
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900" data-testid="engineer-detail-name">
          {view.displayName}
        </h1>
        <span
          className="border border-slate-300 px-2 py-0.5 text-xs text-slate-700"
          data-testid="engineer-detail-ownership"
        >
          {ownership}
        </span>
      </div>

      {/* 🔴 折りたたみの外（`CLAUDE.md` §13.3）。移動中の判断に要る 3 値。 */}
      <dl
        className="mb-4 grid grid-cols-1 gap-3 border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-3"
        data-testid="engineer-detail-headline"
      >
        {headline.map((row) => (
          <div key={row.key}>
            <dt className="text-slate-500">{row.label}</dt>
            <dd className="m-0 font-bold text-slate-900" data-testid={`engineer-detail-headline-${row.key}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        {canEdit ? (
          <Link
            className="ses-secondary-link"
            href={`/engineers/${view.id}/edit`}
            data-testid="engineer-detail-edit-link"
          >
            {t('engineers.detail.edit')}
          </Link>
        ) : null}
        <p className="text-sm text-slate-500" data-testid="engineer-detail-view-recorded">
          {t('engineers.detail.viewRecorded')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <DetailSection id="basic" title={t('engineers.detail.section.basic')}>
            <dl className="text-sm">
              {basicRows.map((row) => (
                <div key={row.key} className="flex gap-3 border-b border-slate-100 py-2 last:border-b-0">
                  <dt className="w-32 shrink-0 text-slate-500">{row.label}</dt>
                  <dd className="m-0 text-slate-900" data-testid={`engineer-detail-basic-${row.key}`}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            {/* 🔴 `BR-52` / `F-008 AC-1`: 集めていない情報を明示する。 */}
            <p className="mt-3 text-xs text-slate-500" data-testid="engineer-detail-collection-scope">
              {t('engineers.detail.collectionScope')}
            </p>
          </DetailSection>

          <DetailSection id="skills" title={t('engineers.detail.section.skills')}>
            {skillRows.length === 0 ? (
              <p className="text-sm text-slate-600" data-testid="engineer-detail-skill-empty">
                {t('engineers.skills.empty')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm" data-testid="engineer-detail-skill-table">
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      <th className="p-2">{t('engineers.skills.column.skill')}</th>
                      <th className="p-2">{t('engineers.skills.column.years')}</th>
                      <th className="p-2">{t('engineers.skills.column.level')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skillRows.map((row) => (
                      <tr key={row.skillId} className="border-b border-slate-100">
                        <td className="p-2">{row.name}</td>
                        <td className="p-2">{row.years}</td>
                        <td className="p-2">{row.level}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DetailSection>
        </div>

        <div className="flex flex-col gap-4">
          {/* 🔴 未実装のセクションを黙って消さない（docs/04 §S-006 セクション 3 / 4）。
              提案履歴と凍結差分は SP-09。 */}
          {/* 🔴 T-05-06: 版の管理は `S-008`（docs/04 §S-006 関連画面「→ `S-008`」）。
              ⚠️ 版の一覧をこの画面に**再掲しない** —— 出すと「どちらが正か」が分かれ、
              スキャン状態の見え方が 2 実装になる（`F-011 AC-2` の担保が割れる）。 */}
          <DetailSection id="skill-sheets" title={t('engineers.detail.section.skillSheets')}>
            <p className="mb-3 text-sm text-slate-600" data-testid="engineer-detail-skill-sheets-lead">
              {t('engineers.detail.skillSheets.lead')}
            </p>
            <Link
              className="ses-secondary-link"
              href={`/engineers/${view.id}/skill-sheets`}
              data-testid="engineer-detail-skill-sheets-link"
            >
              {t('engineers.detail.skillSheets.link')}
            </Link>
          </DetailSection>

          <DetailSection id="proposals" title={t('engineers.detail.section.proposals')}>
            <p className="text-sm text-slate-600" data-testid="engineer-detail-proposals-coming-soon">
              {t('engineers.detail.proposals.comingSoon')}
            </p>
          </DetailSection>
        </div>
      </div>
    </main>
  );
}
