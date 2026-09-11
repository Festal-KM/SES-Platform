'use client';

// apps/web/app/(main)/engineer-shares/engineer-share-screen.tsx
// `S-015` 匿名共有の設定（取引先）— 本体（docs/04 §S-015 / `F-016` / docs/05 §6.4 #29）。T-08-02。
//
// ============================================================================
// 🔴 この画面が守る 5 つ（`docs/04` §S-015 / `F-016` / `CLAUDE.md` §3.1 経路 4）
// ============================================================================
//   ① 🔴 **「一括で共有可にする」に相当する操作を 1 つも置かない**（`F-016 AC-1` / `BR-53`）。
//      全選択のチェックボックスも、複数選択も、「すべて共有」ボタンも無い。操作は常に 1 行 1 件で、
//      `PUT /api/engineers/{id}/share` を 1 回だけ呼ぶ。
//   ② 🔴 **煽らない**（`docs/04` §S-015 空状態）。「共有すると案件が見つかりやすくなります」に
//      相当する文言を持たない。空状態は事実（「共有している人材はいません」）だけを述べる。
//      主導権は最後まで取引先にあり、共有しないことは正常な選択である。
//   ③ 🔴 **共有可にする操作には確認ステップを置き、そこで開示プレビューを見せる**
//      （`docs/04` §S-015「操作と結果」）。何が出るかを見ないまま共有可にできる導線を作らない。
//   ④ 🔴 **解除は 1 段の確認で即時に反映される**（`F-016 AC-2`）。**「反映まで数分かかります」に
//      相当する表示を作らない**（`docs/04` §S-015 非同期処理の表現。キャッシュを持たない設計）。
//   ⑤ 🔴 **丸める前の値を並置しない**（`docs/04` §5-2）。一覧の「稼働可能時期」も
//      プレビューと同じ**丸めた区分**である（組み立ては `share-props.ts`）。
//
// 🔴 **T2（モバイル閲覧可）。1 件ずつの共有解除はモバイルで完結する**
//    （`docs/04` §S-015 デバイス別）。「自社エンジニアの稼働が決まった」ことは外出先で判明し、
//    その瞬間に解除できないとホストに無効な候補が出続ける。したがって
//    **解除ボタンと氏名と稼働可能時期はモバイルでも必ず出す**（`CLAUDE.md` §13.3）。
//    間引くのは補助列（共有開始日 / 受け取った提案依頼）だけであり、ブレークポイントは
//    Tailwind の既定（`sm`）のみを使う（独自定義しない）。
//
// 🔴 変更後はページを再読込する（`skill-sheet-screen.tsx` と同じ）。共有状態は
//    **サーバの状態だけが正**であり、手元で書き換えると「解除したつもり」の表示が残る。
//    再読込はサーバコンポーネント（`dynamic = 'force-dynamic'`）を通るので、
//    キャッシュを挟まずに現在の状態を読み直す。
//
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
import { useState } from 'react';
import Link from 'next/link';
import {
  Button,
  SECONDARY_LINK_CLASSES,
  SECONDARY_LINK_STACKED_CLASSES,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ses/ui';
import type { AnonymizedAttributeRows } from '../../../lib/anonymize/labels';

/** 1 行分の表示値（すべて文言化済み。画面は組み立てをせず、そのまま描く）。 */
export type EngineerShareRowView = {
  readonly engineerId: string;
  readonly displayName: string;
  readonly shared: boolean;
  /** 共有開始日（`YYYY-MM-DD`）。共有していなければ `—`。 */
  readonly sharedOn: string;
  /** 受け取った提案依頼（`0 件`）。🔴 **自社宛だけ**である（`F-018 AC-6`）。 */
  readonly proposalRequestCount: string;
  /** 🔴 **丸めた稼働可能時期**（生の日付ではない）。 */
  readonly availability: string;
  readonly preview: AnonymizedAttributeRows;
};

export type EngineerShareScreenMessages = {
  readonly lead: string;
  readonly sectionShared: string;
  readonly sectionNotShared: string;
  readonly sectionPreview: string;
  readonly columnName: string;
  readonly columnSharedOn: string;
  readonly columnProposalRequestCount: string;
  readonly columnAvailability: string;
  readonly columnAction: string;
  readonly sharedEmpty: string;
  readonly notSharedEmpty: string;
  readonly ledgerEmpty: string;
  readonly ledgerRegister: string;
  readonly previewSelect: string;
  readonly previewNote: string;
  readonly previewCareersNote: string;
  readonly fieldSkills: string;
  readonly fieldYears: string;
  readonly fieldPrice: string;
  readonly fieldAvailability: string;
  readonly fieldLocation: string;
  readonly fieldUpdatedOn: string;
  readonly valueNone: string;
  readonly share: string;
  readonly shareConfirmTitle: string;
  readonly shareConfirmSubmit: string;
  readonly shareConfirmCancel: string;
  readonly shareSubmitting: string;
  readonly revoke: string;
  readonly revokeConfirmTitle: string;
  readonly revokeConfirmLead: string;
  readonly revokeConfirmSubmit: string;
  readonly revokeConfirmCancel: string;
  readonly revokeSubmitting: string;
  readonly errorSave: string;
  readonly errorRetryNote: string;
  readonly deniedTitle: string;
};

export type EngineerShareScreenProps = {
  readonly rows: readonly EngineerShareRowView[];
  /** `S-007`（人材の登録）への導線（台帳が空のとき。`docs/04` §S-015 空状態）。 */
  readonly registerHref: string;
  /**
   * 🔴 実行系を止めている理由（`F-004 AC-7`）。`null` なら実行可。
   *    **拒否の本体は `#29` の `requireExecutable`** であり、これはその理由の表示である。
   */
  readonly denialMessage: string | null;
  readonly messages: EngineerShareScreenMessages;
};

/** 進行中の確認ステップ。🔴 **1 度に 1 件だけ**（一括操作が存在しないことの表れでもある）。 */
type Pending =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'SHARE'; readonly engineerId: string }
  | { readonly kind: 'REVOKE'; readonly engineerId: string };

/** モバイルで間引く補助列（判断材料ではない 2 列。`docs/04` §S-015 デバイス別）。 */
const TABLET_UP = 'hidden sm:table-cell';

export function EngineerShareScreen({
  rows,
  registerHref,
  denialMessage,
  messages,
}: EngineerShareScreenProps) {
  const [pending, setPending] = useState<Pending>({ kind: 'NONE' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const canExecute = denialMessage === null;
  const sharedRows = rows.filter((row) => row.shared);
  const notSharedRows = rows.filter((row) => !row.shared);
  // 🔴 プレビューの対象は「選択した 1 件」か「確認中の 1 件」。どちらも無ければ出さない
  //    （`docs/04` §S-015 ローディング「一覧を先に、プレビューは選択後」）。
  const focusedId = pending.kind === 'NONE' ? selectedId : pending.engineerId;
  const focused = rows.find((row) => row.engineerId === focusedId) ?? null;

  function select(engineerId: string): void {
    setFailed(false);
    setPending({ kind: 'NONE' });
    setSelectedId(engineerId);
  }

  function ask(kind: 'SHARE' | 'REVOKE', engineerId: string): void {
    setFailed(false);
    setSelectedId(engineerId);
    setPending({ kind, engineerId });
  }

  async function submit(engineerId: string, shared: boolean): Promise<void> {
    if (submittingId !== null || !canExecute) return;
    setSubmittingId(engineerId);
    setFailed(false);
    try {
      const response = await fetch(`/api/engineers/${engineerId}/share`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // 🔴 送るのは対象 1 件の真偽だけである（配列を送る形が存在しない。`F-016 AC-1`）。
        body: JSON.stringify({ shared }),
      });
      if (!response.ok) {
        setSubmittingId(null);
        setFailed(true);
        return;
      }
      // 🔴 サーバの状態を読み直す（手元で行を書き換えない）。解除はここで初めて画面に映り、
      //    その時点でホストの候補一覧からも消えている（`F-016 AC-2`。同じ 1 行が根拠）。
      window.location.reload();
    } catch {
      setSubmittingId(null);
      setFailed(true);
    }
  }

  function renderPreview(row: EngineerShareRowView) {
    const items: readonly { readonly key: string; readonly label: string; readonly value: string }[] = [
      {
        key: 'skills',
        label: messages.fieldSkills,
        value: row.preview.skills.length === 0 ? messages.valueNone : row.preview.skills.join('・'),
      },
      { key: 'years', label: messages.fieldYears, value: row.preview.yearsBand },
      { key: 'price', label: messages.fieldPrice, value: row.preview.priceBand },
      { key: 'availability', label: messages.fieldAvailability, value: row.preview.availabilityBand },
      { key: 'location', label: messages.fieldLocation, value: row.preview.location },
      { key: 'updatedOn', label: messages.fieldUpdatedOn, value: row.preview.updatedOn },
    ];
    return (
      <div
        className="border border-slate-200 bg-white p-4"
        data-testid={`engineer-share-preview-${row.engineerId}`}
      >
        <p className="mb-2 text-sm font-bold text-slate-900">{row.displayName}</p>
        <dl className="text-sm">
          {items.map((item) => (
            <div
              key={item.key}
              className="flex gap-3 border-b border-slate-100 py-1 last:border-b-0"
              data-testid={`engineer-share-preview-field-${item.key}`}
            >
              <dt className="w-40 shrink-0 text-slate-500">{item.label}</dt>
              <dd className="m-0 break-words text-slate-900">{item.value}</dd>
            </div>
          ))}
        </dl>
        {/* 🔴 「経歴は開示されません」を本文で明示する（`F-008 AC-7` / `docs/04` §5-2）。
            見えていないことを目で確かめられて初めて共有が続く。 */}
        <p className="mt-2 text-xs text-slate-500" data-testid="engineer-share-preview-careers-note">
          {messages.previewCareersNote}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="engineer-share-screen">
      {/* --- 1. 共有の意味の説明（常設） ------------------------------------- */}
      <p className="mb-4 text-sm text-slate-600" data-testid="engineer-share-lead">
        {messages.lead}
      </p>

      {denialMessage === null ? null : (
        <div
          role="alert"
          className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="engineer-share-denied"
        >
          <p className="font-bold">{messages.deniedTitle}</p>
          <p>{denialMessage}</p>
        </div>
      )}

      {failed ? (
        <p
          role="alert"
          className="mb-4 text-sm text-red-700"
          data-testid="engineer-share-error"
        >
          {messages.errorSave}
          <br />
          {/* 🔴 「反映まで数分かかります」ではなく「状態は変わっていない」と書く。 */}
          <span className="text-slate-600">{messages.errorRetryNote}</span>
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div data-testid="engineer-share-ledger-empty">
          <p className="mb-2 text-sm text-slate-600">{messages.ledgerEmpty}</p>
          <Link className={SECONDARY_LINK_STACKED_CLASSES} href={registerHref}>
            {messages.ledgerRegister}
          </Link>
        </div>
      ) : null}

      {/* --- 2. 共有中の候補一覧 --------------------------------------------- */}
      {rows.length === 0 ? null : (
        <section className="mb-6" data-testid="engineer-share-shared">
          <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionShared}</h2>
          {sharedRows.length === 0 ? (
            // 🔴 煽らない。事実だけを述べる（`docs/04` §S-015）。
            <p className="text-sm text-slate-600" data-testid="engineer-share-shared-empty">
              {messages.sharedEmpty}
            </p>
          ) : (
            <Table data-testid="engineer-share-shared-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{messages.columnName}</TableHead>
                  <TableHead className={TABLET_UP}>{messages.columnSharedOn}</TableHead>
                  <TableHead className={TABLET_UP}>
                    {messages.columnProposalRequestCount}
                  </TableHead>
                  <TableHead>{messages.columnAvailability}</TableHead>
                  <TableHead>{messages.columnAction}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sharedRows.map((row) => (
                  <TableRow key={row.engineerId} data-testid={`engineer-share-row-${row.engineerId}`}>
                    <TableCell whitespace="normal">
                      <button
                        type="button"
                        className={SECONDARY_LINK_CLASSES}
                        onClick={() => select(row.engineerId)}
                        data-testid={`engineer-share-select-${row.engineerId}`}
                      >
                        {row.displayName}
                      </button>
                    </TableCell>
                    <TableCell className={TABLET_UP}>{row.sharedOn}</TableCell>
                    <TableCell className={TABLET_UP}>{row.proposalRequestCount}</TableCell>
                    <TableCell>{row.availability}</TableCell>
                    <TableCell>
                      {canExecute ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => ask('REVOKE', row.engineerId)}
                          disabled={submittingId !== null}
                          data-testid={`engineer-share-revoke-${row.engineerId}`}
                        >
                          {messages.revoke}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {/* --- 3. 共有していない自社エンジニアの一覧 ---------------------------- */}
      {rows.length === 0 ? null : (
        <section className="mb-6" data-testid="engineer-share-not-shared">
          <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionNotShared}</h2>
          {notSharedRows.length === 0 ? (
            <p className="text-sm text-slate-600" data-testid="engineer-share-not-shared-empty">
              {messages.notSharedEmpty}
            </p>
          ) : (
            <Table data-testid="engineer-share-not-shared-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{messages.columnName}</TableHead>
                  <TableHead>{messages.columnAvailability}</TableHead>
                  <TableHead>{messages.columnAction}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notSharedRows.map((row) => (
                  <TableRow key={row.engineerId} data-testid={`engineer-share-row-${row.engineerId}`}>
                    <TableCell whitespace="normal">
                      <button
                        type="button"
                        className={SECONDARY_LINK_CLASSES}
                        onClick={() => select(row.engineerId)}
                        data-testid={`engineer-share-select-${row.engineerId}`}
                      >
                        {row.displayName}
                      </button>
                    </TableCell>
                    <TableCell>{row.availability}</TableCell>
                    <TableCell>
                      {canExecute ? (
                        <Button
                          type="button"
                          onClick={() => ask('SHARE', row.engineerId)}
                          disabled={submittingId !== null}
                          data-testid={`engineer-share-share-${row.engineerId}`}
                        >
                          {messages.share}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {/* --- 4. 選択した候補の開示プレビュー ---------------------------------- */}
      {rows.length === 0 ? null : (
        <section data-testid="engineer-share-preview">
          <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionPreview}</h2>
          <p className="mb-3 text-xs text-slate-500" data-testid="engineer-share-preview-note">
            {messages.previewNote}
          </p>

          {focused === null ? (
            <p className="text-sm text-slate-600" data-testid="engineer-share-preview-placeholder">
              {messages.previewSelect}
            </p>
          ) : (
            <>
              {/* 🔴 共有可にする確認ステップ。**プレビューを見せたうえで**確定させる
                  （`docs/04` §S-015「操作と結果」）。プレビューを飛ばす導線を作らない。 */}
              {pending.kind === 'SHARE' ? (
                <div
                  className="mb-3 border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800"
                  data-testid="engineer-share-share-confirm"
                >
                  <p className="font-bold">{messages.shareConfirmTitle}</p>
                </div>
              ) : null}
              {pending.kind === 'REVOKE' ? (
                <div
                  className="mb-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  data-testid="engineer-share-revoke-confirm"
                >
                  <p className="font-bold">{messages.revokeConfirmTitle}</p>
                  <p>{messages.revokeConfirmLead}</p>
                </div>
              ) : null}

              {renderPreview(focused)}

              {pending.kind === 'NONE' ? null : (
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <Button
                    type="button"
                    variant={pending.kind === 'REVOKE' ? 'secondary' : 'primary'}
                    disabled={submittingId !== null || !canExecute}
                    onClick={() => submit(pending.engineerId, pending.kind === 'SHARE')}
                    data-testid="engineer-share-confirm-submit"
                  >
                    {submittingId !== null
                      ? pending.kind === 'SHARE'
                        ? messages.shareSubmitting
                        : messages.revokeSubmitting
                      : pending.kind === 'SHARE'
                        ? messages.shareConfirmSubmit
                        : messages.revokeConfirmSubmit}
                  </Button>
                  <button
                    type="button"
                    className={SECONDARY_LINK_CLASSES}
                    onClick={() => setPending({ kind: 'NONE' })}
                    data-testid="engineer-share-confirm-cancel"
                  >
                    {pending.kind === 'SHARE'
                      ? messages.shareConfirmCancel
                      : messages.revokeConfirmCancel}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
