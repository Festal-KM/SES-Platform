'use client';

// apps/web/app/(main)/engineers/[id]/skill-sheets/skill-sheet-screen.tsx
// `S-008` スキルシートの取込と版管理 — 本体（docs/04 §S-008 / `F-011` / docs/05 §6.4 #18 #19）。
// T-05-06。
//
// ============================================================================
// 🔴 `F-011 AC-1`「導線が存在しない」をどう成立させているか
// ============================================================================
// 共有（ダウンロード / 提案添付 / チャット添付）の要素は **`isSkillSheetShareable(scanStatus)`
// が真の行にしか描かれない**。無効化した（`disabled` な）ボタンを置かない ——
// 「押せるが拒否される」ボタンは、利用者から見れば「いつか押せる」であり、
// `F-011 AC-1` が禁じているのはまさにその状態である。
// 🔴 判定は `lib/skill-sheets/policy.ts` の関数であり、**API（#20 / 版の切替 / 削除）が見るのと
//    同じ関数**である。画面とサーバで条件式を書き分けない。
//
// 🔴 検査中（`SCANNING`）の行には**操作を 1 つも描かない**（`F-011 AC-2` / docs/04 §S-008 の
//    「操作は選択できません」）。感染（`INFECTED`）の行は隔離であり、
//    **どのロールからもダウンロードできない**ことを文言で明示する（`AC-3`）。
//
// 🔴 Tier 3（デスクトップ主体）だが**モバイルで遮断しない**（`CLAUDE.md` §13.3）。
//    表は横スクロールで劣化させ、非表示にはしない。
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '@ses/ui';
import type { ScanStatus } from '@ses/domain';
import { formatDateTimeJst } from '../../../../../lib/format/datetime';
import {
  canBecomeLatestSkillSheet,
  isScanSettled,
  isSkillSheetShareable,
  supportsAutoExtraction,
} from '../../../../../lib/skill-sheets/policy';
import type {
  SkillSheetPreviewView,
  SkillSheetVersionView,
} from '../../../../../lib/skill-sheets/service';
import { uploadSkillSheet } from '../../../../../lib/skill-sheets/upload-client';

export type SkillSheetScreenMessages = {
  readonly uploadSection: string;
  readonly uploadFileLabel: string;
  readonly uploadNoteLabel: string;
  readonly uploadSubmit: string;
  readonly uploadSubmitting: string;
  readonly uploadDone: string;
  readonly uploadFormats: string;
  readonly uploadImageNotice: string;
  readonly uploadScanNotice: string;
  readonly uploadError: string;
  readonly uploadErrorTooLarge: string;
  readonly uploadErrorQuota: string;
  readonly uploadReadOnlyNote: string;

  readonly versionsSection: string;
  readonly versionsEmpty: string;
  readonly columnVersion: string;
  readonly columnUploadedAt: string;
  readonly columnUploadedBy: string;
  readonly columnScanStatus: string;
  readonly columnExtraction: string;
  readonly columnLatest: string;
  readonly columnActions: string;
  readonly versionPrefix: string;
  readonly latestBadge: string;
  readonly notLatest: string;
  readonly uploaderUnknown: string;
  readonly noteLabel: string;

  readonly scanStatusLabels: Readonly<Record<ScanStatus, string>>;
  /** 🔴 共有できない理由（`CLEAN` 以外の 4 状態。文言を 1 つに畳まない）。 */
  readonly blockedReasons: Readonly<Record<Exclude<ScanStatus, 'CLEAN'>, string>>;

  readonly setLatest: string;
  readonly setLatestSubmitting: string;
  readonly deleteAction: string;
  readonly deleteSubmitting: string;
  readonly deleteConfirm: string;
  readonly actionError: string;
  readonly shareComingSoon: string;

  /** T-05-07（`F-012`）。閲覧（#21）とダウンロード（#20）は**別の操作**である。 */
  readonly preview: string;
  readonly previewSubmitting: string;
  readonly previewClose: string;
  readonly download: string;
  readonly downloadSubmitting: string;
  readonly auditNotice: string;
  readonly downloadReadOnlyNote: string;
  readonly previewTitle: string;
  readonly previewContentType: string;
  readonly previewByteSize: string;
  readonly previewByteSizeUnit: string;
  readonly previewBodyNotice: string;
  readonly previewError: string;
  readonly downloadError: string;

  readonly extractionSection: string;
  readonly extractionNotRun: string;
  readonly extractionUnsupported: string;
  readonly extractionComingSoon: string;
};

type Phase = 'idle' | 'submitting' | 'error' | 'done';

/** 🔴 上限系のエラーは「壊れた」ではないので文言を分ける（docs/05 §15.2 の `code`）。 */
function uploadErrorMessage(code: string | null, messages: SkillSheetScreenMessages): string {
  if (code === 'UPLOAD_TOO_LARGE') return messages.uploadErrorTooLarge;
  if (code === 'STORAGE_LIMIT_EXCEEDED') return messages.uploadErrorQuota;
  return messages.uploadError;
}

export function SkillSheetScreen({
  engineerId,
  versions,
  canManage,
  canDownload,
  messages,
}: {
  readonly engineerId: string;
  readonly versions: readonly SkillSheetVersionView[];
  /**
   * 🔴 アップロード・版の切替・削除の導線を出すか（docs/04 §S-008 権限差分）。
   *    値の出所は `page.tsx`（`ctx.role`）であり、**API の `requireRole` と同じロール集合**を見る。
   *    ⚠️ これは UI の配慮であって拒否の本体ではない（本体は各ルートのガードと RLS）。
   */
  readonly canManage: boolean;
  /**
   * 🔴 T-05-07: ダウンロードの導線を出すか（`F-012 AC-3` / `BR-31`。
   *    「`VIEWER` はダウンロード操作を実行できず、**導線も表示されない**。閲覧は可能」）。
   *    値の出所は `page.tsx` の `canDownloadSkillSheet`（＝ `#20` の `requireRole` と同じ定数）。
   * 🔴 `canManage` と**別の props** にしてある —— 同じ集合であることは `policy.ts` の
   *    1 行（`SKILL_SHEET_DOWNLOADER_ROLES = SKILL_SHEET_MANAGER_ROLES`）が保証しており、
   *    画面側で「管理できる ＝ ダウンロードできる」と読み替えると、集合が分かれた日に
   *    静かに間違った導線を描く。
   */
  readonly canDownload: boolean;
  readonly messages: SkillSheetScreenMessages;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [uploadPhase, setUploadPhase] = useState<Phase>('idle');
  const [uploadErrorCode, setUploadErrorCode] = useState<string | null>(null);
  const [actionPhase, setActionPhase] = useState<Phase>('idle');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [previewPhase, setPreviewPhase] = useState<Phase>('idle');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<SkillSheetPreviewView | null>(null);
  const [downloadPhase, setDownloadPhase] = useState<Phase>('idle');
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * 🔴 一覧はサーバから読み直す（画面で行を組み立て直さない）。版・スキャン状態・最新版フラグは
   *    **サーバの状態だけが正**であり、手元で書き換えると「切り替えたつもり」の表示が残る。
   *    ⚠️ 版一覧の読み取り API は無い（画面はサーバコンポーネントが直接読む）ため、再読込で揃える。
   */
  function reload(): void {
    window.location.reload();
  }

  function onSelectFile(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null);
    setUploadPhase('idle');
  }

  async function onUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (uploadPhase === 'submitting' || file === null) return;
    setUploadPhase('submitting');
    setUploadErrorCode(null);
    try {
      const outcome = await uploadSkillSheet(
        {
          engineerId,
          fileName: file.name,
          contentType: file.type,
          byteSize: file.size,
          note: note.trim() === '' ? null : note.trim(),
          body: file,
        },
        { fetch: globalThis.fetch.bind(globalThis) },
      );
      if (!outcome.ok) {
        setUploadErrorCode(outcome.code);
        setUploadPhase('error');
        return;
      }
      setUploadPhase('done');
      setFile(null);
      setNote('');
      if (fileInputRef.current !== null) fileInputRef.current.value = '';
      reload();
    } catch {
      setUploadErrorCode(null);
      setUploadPhase('error');
    }
  }

  async function onSetLatest(id: string): Promise<void> {
    if (actionPhase === 'submitting') return;
    setActionPhase('submitting');
    setPendingId(id);
    try {
      const response = await fetch(`/api/skill-sheets/${id}/latest`, { method: 'POST' });
      if (!response.ok) {
        setActionPhase('error');
        return;
      }
      setActionPhase('idle');
      reload();
    } catch {
      setActionPhase('error');
    }
  }

  async function onDelete(id: string): Promise<void> {
    if (actionPhase === 'submitting') return;
    // 🔴 実体ごと消える不可逆な操作なので、確認を挟む（`CLAUDE.md` §13.3 の誤タップ対策）。
    if (!window.confirm(messages.deleteConfirm)) return;
    setActionPhase('submitting');
    setPendingId(id);
    try {
      const response = await fetch(`/api/skill-sheets/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        setActionPhase('error');
        return;
      }
      setActionPhase('idle');
      reload();
    } catch {
      setActionPhase('error');
    }
  }

  /**
   * 🔴 版の**中身を開く**（#21）。応答は `{ meta }` だけであり本文は来ない
   *    （docs/05 §6.4 #21）。それでもサーバ側で `skill_sheet.view` が記録される ——
   *    「誰の経歴を、誰が、いつ見たか」を残すのが目的であって、本文を運ぶことではない。
   */
  async function onPreview(id: string): Promise<void> {
    if (previewPhase === 'submitting') return;
    // すでに開いている版をもう一度押したら閉じる（記録を無駄に増やさない）。
    if (previewId === id && preview !== null) {
      setPreviewId(null);
      setPreview(null);
      setPreviewPhase('idle');
      return;
    }
    setPreviewPhase('submitting');
    setPreviewId(id);
    setPreview(null);
    try {
      const response = await fetch(`/api/skill-sheets/${id}/preview`);
      if (!response.ok) {
        setPreviewPhase('error');
        return;
      }
      const body = (await response.json()) as { readonly meta: SkillSheetPreviewView };
      setPreview(body.meta);
      setPreviewPhase('idle');
    } catch {
      setPreviewPhase('error');
    }
  }

  /**
   * 🔴 ダウンロード（#20）。**サーバは URL を返すだけ**であり、記録はその URL を出す前に
   *    済んでいる（`issueDownloadUrl`）。ここで `window.location` に入れる URL は
   *    S3 の短命な署名付き URL である。
   * 🔴 発行に失敗したら**何も起こらない**（別タブを開いて空振りさせない）。
   */
  async function onDownload(id: string): Promise<void> {
    if (downloadPhase === 'submitting') return;
    setDownloadPhase('submitting');
    setDownloadId(id);
    try {
      const response = await fetch(`/api/skill-sheets/${id}/download-url`);
      if (!response.ok) {
        setDownloadPhase('error');
        return;
      }
      const body = (await response.json()) as { readonly url: string };
      setDownloadPhase('idle');
      window.location.assign(body.url);
    } catch {
      setDownloadPhase('error');
    }
  }

  return (
    <div data-testid="skill-sheet-screen">
      <section className="mb-8" data-testid="skill-sheet-upload-section">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.uploadSection}</h2>
        {/* 🔴 対応形式と「画像は自動読み取りに対応しない」は**ロールを問わず**出す
            （`docs/03` 申し送り 8。`VIEWER` にも「なぜ手入力なのか」が伝わる必要がある）。 */}
        <p className="mb-1 text-sm text-slate-600" data-testid="skill-sheet-upload-formats">
          {messages.uploadFormats}
        </p>
        <p className="mb-1 text-sm text-slate-600" data-testid="skill-sheet-upload-image-notice">
          {messages.uploadImageNotice}
        </p>
        <p className="mb-3 text-sm text-slate-600" data-testid="skill-sheet-upload-scan-notice">
          {messages.uploadScanNotice}
        </p>

        {canManage ? (
          <form onSubmit={onUpload} noValidate data-testid="skill-sheet-upload-form">
            <label className="mb-2 block text-sm">
              <span className="mb-1 block text-slate-700">{messages.uploadFileLabel}</span>
              <input
                ref={fileInputRef}
                type="file"
                name="file"
                onChange={onSelectFile}
                disabled={uploadPhase === 'submitting'}
                className="block w-full max-w-md text-sm"
                data-testid="skill-sheet-upload-file"
              />
            </label>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-slate-700">{messages.uploadNoteLabel}</span>
              <input
                type="text"
                name="note"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                disabled={uploadPhase === 'submitting'}
                className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm"
                data-testid="skill-sheet-upload-note"
              />
            </label>
            <Button
              type="submit"
              size="sm"
              disabled={uploadPhase === 'submitting' || file === null}
              data-testid="skill-sheet-upload-submit"
            >
              {uploadPhase === 'submitting' ? messages.uploadSubmitting : messages.uploadSubmit}
            </Button>
            {uploadPhase === 'done' ? (
              <p role="status" className="mt-2 text-sm text-slate-700" data-testid="skill-sheet-upload-done">
                {messages.uploadDone}
              </p>
            ) : null}
            {uploadPhase === 'error' ? (
              <p role="alert" className="mt-2 text-sm text-red-700" data-testid="skill-sheet-upload-error">
                {uploadErrorMessage(uploadErrorCode, messages)}
              </p>
            ) : null}
          </form>
        ) : (
          // 🔴 導線を消すだけにせず、**誰に頼めばよいか**を書く（行き止まりにしない）。
          <p className="text-sm text-slate-500" data-testid="skill-sheet-upload-read-only">
            {messages.uploadReadOnlyNote}
          </p>
        )}
      </section>

      <section className="mb-8" data-testid="skill-sheet-versions-section">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.versionsSection}</h2>
        {/* 🔴 T-05-07: 閲覧・DL が記録されることを**隠さない**（`CLAUDE.md` §3.5 の説明責任は、
            見る側にも伝わっていなければ抑止として働かない）。ロールを問わず出す。 */}
        <p className="mb-2 text-xs text-slate-500" data-testid="skill-sheet-audit-notice">
          {messages.auditNotice}
        </p>
        {versions.length === 0 ? (
          <p
            className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
            data-testid="skill-sheet-versions-empty"
          >
            {messages.versionsEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="skill-sheet-versions-table">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-3 py-2 font-medium">{messages.columnVersion}</th>
                  <th className="px-3 py-2 font-medium">{messages.columnUploadedAt}</th>
                  <th className="px-3 py-2 font-medium">{messages.columnUploadedBy}</th>
                  <th className="px-3 py-2 font-medium">{messages.columnScanStatus}</th>
                  <th className="px-3 py-2 font-medium">{messages.columnExtraction}</th>
                  <th className="px-3 py-2 font-medium">{messages.columnLatest}</th>
                  <th className="px-3 py-2 font-medium">{messages.columnActions}</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => {
                  // 🔴 3 つの判定はすべて `policy.ts`（= API と同じ関数）から来る。
                  const shareable = isSkillSheetShareable(version.scanStatus);
                  const settled = isScanSettled(version.scanStatus);
                  const canSetLatest =
                    canManage && !version.isLatest && canBecomeLatestSkillSheet(version.scanStatus);
                  const busy = actionPhase === 'submitting' && pendingId === version.id;
                  return (
                    <tr
                      key={version.id}
                      className="border-b border-slate-100 align-top"
                      data-testid={`skill-sheet-row-${version.id}`}
                      data-scan-status={version.scanStatus}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        {messages.versionPrefix}
                        {version.version}
                        {version.note === null ? null : (
                          <span
                            className="mt-1 block text-xs text-slate-500"
                            data-testid={`skill-sheet-note-${version.id}`}
                          >
                            {messages.noteLabel}: {version.note}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatDateTimeJst(version.uploadedAt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {version.uploadedByName ?? messages.uploaderUnknown}
                      </td>
                      <td
                        className="px-3 py-2 whitespace-nowrap"
                        data-testid={`skill-sheet-scan-status-${version.id}`}
                      >
                        {messages.scanStatusLabels[version.scanStatus]}
                      </td>
                      {/* 抽出（`F-032`。SP-14）は未実装。形式で読み取れないことだけ先に示す。 */}
                      <td
                        className="px-3 py-2 whitespace-nowrap"
                        data-testid={`skill-sheet-extraction-${version.id}`}
                      >
                        {supportsAutoExtraction(version.contentType)
                          ? messages.extractionNotRun
                          : messages.extractionUnsupported}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {version.isLatest ? (
                          <span data-testid={`skill-sheet-latest-${version.id}`}>
                            {messages.latestBadge}
                          </span>
                        ) : (
                          messages.notLatest
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {/* 🔴 T-05-07: 閲覧（#21）の導線は**ロールも状態も問わず**出す。
                            `VIEWER` も閲覧はできる（`F-012 AC-3`）し、隔離された版でも
                            「いつ・どの版が・なぜ渡せないのか」を確かめられなければ、
                            利用者は次の行動（上げ直す / 削除する）を選べない。
                            🔴 応答は `{ meta }` だけであり本文は来ない（原本に触れるのは #20 のみ）。 */}
                        <div className="mb-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={previewPhase === 'submitting'}
                            onClick={() => void onPreview(version.id)}
                            data-testid={`skill-sheet-preview-${version.id}`}
                          >
                            {previewPhase === 'submitting' && previewId === version.id
                              ? messages.previewSubmitting
                              : previewId === version.id && preview !== null
                                ? messages.previewClose
                                : messages.preview}
                          </Button>
                        </div>
                        {/* 🔴 共有の導線は `CLEAN` の行にしか存在しない（`F-011 AC-1`）。
                            `CLEAN` でない行には**理由だけ**を出し、要素そのものを描かない。 */}
                        {shareable ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-2">
                              {/* 🔴 ダウンロードは `CLEAN` かつ `VIEWER` でないときだけ描く
                                  （`F-011 AC-1` / `F-012 AC-3`）。無効化したボタンを置かない。 */}
                              {canDownload ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={downloadPhase === 'submitting'}
                                  onClick={() => void onDownload(version.id)}
                                  data-testid={`skill-sheet-download-${version.id}`}
                                >
                                  {downloadPhase === 'submitting' && downloadId === version.id
                                    ? messages.downloadSubmitting
                                    : messages.download}
                                </Button>
                              ) : null}
                              {canSetLatest ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={actionPhase === 'submitting'}
                                  onClick={() => void onSetLatest(version.id)}
                                  data-testid={`skill-sheet-set-latest-${version.id}`}
                                >
                                  {busy ? messages.setLatestSubmitting : messages.setLatest}
                                </Button>
                              ) : null}
                              {canManage ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={actionPhase === 'submitting'}
                                  onClick={() => void onDelete(version.id)}
                                  data-testid={`skill-sheet-delete-${version.id}`}
                                >
                                  {busy ? messages.deleteSubmitting : messages.deleteAction}
                                </Button>
                              ) : null}
                            </div>
                            {/* 🔴 `VIEWER` にはダウンロードの導線が無い（`F-012 AC-3`）。
                                消すだけにせず、**誰に頼めばよいか**を書く（行き止まりにしない）。 */}
                            {canDownload ? null : (
                              <p
                                className="text-xs text-slate-500"
                                data-testid={`skill-sheet-download-read-only-${version.id}`}
                              >
                                {messages.downloadReadOnlyNote}
                              </p>
                            )}
                            {/* 提案添付（SP-09）・チャット添付（SP-13）の置き場所。
                                🔴 **`CLEAN` の行にだけ**出す。 */}
                            <p
                              className="text-xs text-slate-500"
                              data-testid={`skill-sheet-share-${version.id}`}
                            >
                              {messages.shareComingSoon}
                            </p>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <p
                              className="text-xs text-slate-500"
                              data-testid={`skill-sheet-blocked-${version.id}`}
                            >
                              {messages.blockedReasons[version.scanStatus]}
                            </p>
                            {/* 🔴 検査中の版は削除もできない（後から届く結果が
                                `SCAN_TARGET_NOT_FOUND` になり `A-005` の雑音になる）。 */}
                            {canManage && settled ? (
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={actionPhase === 'submitting'}
                                  onClick={() => void onDelete(version.id)}
                                  data-testid={`skill-sheet-delete-${version.id}`}
                                >
                                  {busy ? messages.deleteSubmitting : messages.deleteAction}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        )}

                        {/* 🔴 開いた版の情報（#21 の `{ meta }`）。**本文は無い**ことを明示する。 */}
                        {previewId === version.id && preview !== null ? (
                          <dl
                            className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
                            data-testid={`skill-sheet-preview-panel-${version.id}`}
                          >
                            <dt className="font-semibold">{messages.previewTitle}</dt>
                            <dd className="mb-1">
                              {messages.versionPrefix}
                              {preview.version} / {messages.scanStatusLabels[preview.scanStatus]}
                            </dd>
                            <dt>{messages.previewContentType}</dt>
                            <dd className="mb-1">{preview.contentType}</dd>
                            <dt>{messages.previewByteSize}</dt>
                            <dd className="mb-1">
                              {preview.byteSize} {messages.previewByteSizeUnit}
                            </dd>
                            <dd data-testid={`skill-sheet-preview-body-notice-${version.id}`}>
                              {messages.previewBodyNotice}
                            </dd>
                          </dl>
                        ) : null}
                        {previewId === version.id && previewPhase === 'error' ? (
                          <p
                            role="alert"
                            className="mt-2 text-xs text-red-700"
                            data-testid={`skill-sheet-preview-error-${version.id}`}
                          >
                            {messages.previewError}
                          </p>
                        ) : null}
                        {downloadId === version.id && downloadPhase === 'error' ? (
                          <p
                            role="alert"
                            className="mt-2 text-xs text-red-700"
                            data-testid={`skill-sheet-download-error-${version.id}`}
                          >
                            {messages.downloadError}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {actionPhase === 'error' ? (
          <p role="alert" className="mt-2 text-sm text-red-700" data-testid="skill-sheet-action-error">
            {messages.actionError}
          </p>
        ) : null}
      </section>

      {/* 🔴 未実装のセクションを黙って消さない（`engineers.careers.comingSoon` と同じ規律）。
          抽出結果の採否とスキル正規化は `F-032` / `F-033`（SP-14）。 */}
      <section data-testid="skill-sheet-extraction-section">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{messages.extractionSection}</h2>
        <p className="text-sm text-slate-600" data-testid="skill-sheet-extraction-coming-soon">
          {messages.extractionComingSoon}
        </p>
      </section>
    </div>
  );
}
