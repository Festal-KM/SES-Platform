// apps/web/app/(main)/engineers/[id]/skill-sheets/page.tsx
// `S-008` スキルシートの取込と版管理（docs/04 §S-008 / `F-011` / docs/05 §6.4 #18 #19）。T-05-06。
//
// 🔴 **氏名を出すので閲覧が `AuditLog` に残る**（`BR-27` / `F-008 AC-4`）。記録は
//    `readSkillSheetVersions` の業務トランザクションの内側で書かれ、**書けなければ表示されない**
//    （`readEngineerDetail` と同じ形。docs/05 §6.4「#17 の実装の決着」）。
// 🔴 **境界外の ID は 404**（docs/05 §4.8）。母集団を絞るのは `engineers` / `skill_sheets` の
//    RLS（C3）であり、この画面に `where` を足さない。ホスト所属の利用者が他パートナー所有の
//    エンジニア ID を URL 直打ちしても、版の存在すら分からない（`F-008 AC-3` / `F-012 AC-4`）。
// 🔴 `VIEWER` は**到達できる**（版一覧とスキャン状態は閲覧可。docs/04 §S-008 権限差分）。
//    アップロード・切替・削除の導線だけを出さない（`canManage`）。
//
// 🔴 Tier 3（デスクトップ主体）だが**モバイルで遮断しない**（`CLAUDE.md` §13.3）。
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { t } from '@ses/i18n';
import { NotFoundError } from '../../../../../lib/api/errors';
import { readRequestMeta, resolveTenantCtxOutcome } from '../../../../../lib/auth/session';
import {
  canDownloadSkillSheet,
  canManageSkillSheets,
} from '../../../../../lib/skill-sheets/policy';
import { readSkillSheetVersions } from '../../../../../lib/skill-sheets/service';
import { SkillSheetScreen } from './skill-sheet-screen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 🔴 タイトルに氏名を入れない（履歴・タブ・共有プレビューに PII を残さない。`S-006` と同じ）。 */
export const metadata: Metadata = { title: t('skillSheets.title') };

export default async function SkillSheetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const { id } = await params;
  const meta = await readRequestMeta();

  const view = await readSkillSheetVersions(outcome.ctx, id, { ipAddress: meta.ipAddress }).catch(
    (error: unknown) => {
      // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <p className="mb-1 text-sm text-slate-500">
        {t('skillSheets.breadcrumb.home')} / {t('skillSheets.breadcrumb.engineers')} /{' '}
        {t('skillSheets.breadcrumb.current')}
      </p>
      <h1 className="mb-2 text-xl font-bold text-slate-900">{t('skillSheets.title')}</h1>
      {/* 🔴 誰のスキルシートかを取り違えないために氏名を出す（だからこの画面の閲覧は記録される）。 */}
      <p className="mb-4 text-sm text-slate-700" data-testid="skill-sheet-engineer-name">
        {view.engineer.displayName}
      </p>
      <p className="mb-6">
        <Link className="ses-secondary-link" href={`/engineers/${view.engineer.id}`}>
          {t('skillSheets.backToEngineer')}
        </Link>
      </p>

      <SkillSheetScreen
        engineerId={view.engineer.id}
        versions={view.versions}
        // 🔴 判定は `lib/skill-sheets/policy.ts` の 1 か所（**API の `requireRole` と同じ定数**）。
        canManage={canManageSkillSheets(outcome.ctx.role)}
        // 🔴 T-05-07: `VIEWER` はダウンロードの導線を持たない（`F-012 AC-3` / `BR-31`）。
        //    版の状態（`CLEAN` か）は画面側が `isSkillSheetShareable` で行ごとに見る。
        canDownload={canDownloadSkillSheet(outcome.ctx.role)}
        messages={{
          uploadSection: t('skillSheets.upload.section'),
          uploadFileLabel: t('skillSheets.upload.fileLabel'),
          uploadNoteLabel: t('skillSheets.upload.noteLabel'),
          uploadSubmit: t('skillSheets.upload.submit'),
          uploadSubmitting: t('skillSheets.upload.submitting'),
          uploadDone: t('skillSheets.upload.done'),
          uploadFormats: t('skillSheets.upload.formats'),
          uploadImageNotice: t('skillSheets.upload.imageNotice'),
          uploadScanNotice: t('skillSheets.upload.scanNotice'),
          uploadError: t('skillSheets.upload.error'),
          uploadErrorTooLarge: t('skillSheets.upload.errorTooLarge'),
          uploadErrorQuota: t('skillSheets.upload.errorQuota'),
          uploadErrorTransfer: t('skillSheets.upload.errorTransfer'),
          uploadReadOnlyNote: t('skillSheets.upload.readOnlyNote'),

          versionsSection: t('skillSheets.versions.section'),
          versionsEmpty: t('skillSheets.versions.empty'),
          columnVersion: t('skillSheets.versions.column.version'),
          columnUploadedAt: t('skillSheets.versions.column.uploadedAt'),
          columnUploadedBy: t('skillSheets.versions.column.uploadedBy'),
          columnScanStatus: t('skillSheets.versions.column.scanStatus'),
          columnExtraction: t('skillSheets.versions.column.extraction'),
          columnLatest: t('skillSheets.versions.column.latest'),
          columnActions: t('skillSheets.versions.column.actions'),
          versionPrefix: t('skillSheets.versions.versionPrefix'),
          latestBadge: t('skillSheets.versions.latestBadge'),
          notLatest: t('skillSheets.versions.notLatest'),
          uploaderUnknown: t('skillSheets.versions.uploaderUnknown'),
          noteLabel: t('skillSheets.versions.noteLabel'),

          scanStatusLabels: {
            SCANNING: t('skillSheets.scanStatus.SCANNING'),
            CLEAN: t('skillSheets.scanStatus.CLEAN'),
            INFECTED: t('skillSheets.scanStatus.INFECTED'),
            UNSCANNABLE: t('skillSheets.scanStatus.UNSCANNABLE'),
            FAILED: t('skillSheets.scanStatus.FAILED'),
          },
          blockedReasons: {
            SCANNING: t('skillSheets.actions.blocked.SCANNING'),
            INFECTED: t('skillSheets.actions.blocked.INFECTED'),
            UNSCANNABLE: t('skillSheets.actions.blocked.UNSCANNABLE'),
            FAILED: t('skillSheets.actions.blocked.FAILED'),
          },

          setLatest: t('skillSheets.actions.setLatest'),
          setLatestSubmitting: t('skillSheets.actions.setLatestSubmitting'),
          deleteAction: t('skillSheets.actions.delete'),
          deleteSubmitting: t('skillSheets.actions.deleteSubmitting'),
          deleteConfirm: t('skillSheets.actions.deleteConfirm'),
          actionError: t('skillSheets.actions.error'),
          shareComingSoon: t('skillSheets.actions.shareComingSoon'),

          preview: t('skillSheets.actions.preview'),
          previewSubmitting: t('skillSheets.actions.previewSubmitting'),
          previewClose: t('skillSheets.actions.previewClose'),
          download: t('skillSheets.actions.download'),
          downloadSubmitting: t('skillSheets.actions.downloadSubmitting'),
          auditNotice: t('skillSheets.actions.auditNotice'),
          downloadReadOnlyNote: t('skillSheets.actions.downloadReadOnlyNote'),
          previewTitle: t('skillSheets.preview.title'),
          previewContentType: t('skillSheets.preview.contentType'),
          previewByteSize: t('skillSheets.preview.byteSize'),
          previewByteSizeUnit: t('skillSheets.preview.byteSizeUnit'),
          previewBodyNotice: t('skillSheets.preview.bodyNotice'),
          previewError: t('skillSheets.preview.error'),
          downloadError: t('skillSheets.download.error'),

          extractionSection: t('skillSheets.extraction.section'),
          extractionNotRun: t('skillSheets.extraction.notRun'),
          extractionUnsupported: t('skillSheets.extraction.unsupported'),
          extractionComingSoon: t('skillSheets.extraction.comingSoon'),
        }}
      />
    </main>
  );
}
