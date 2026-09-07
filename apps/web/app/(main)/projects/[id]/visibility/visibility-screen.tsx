'use client';

// apps/web/app/(main)/projects/[id]/visibility/visibility-screen.tsx
// `S-013` 案件の公開範囲設定 — 本体（docs/04 §S-013 / `F-014` / `F-020` / docs/05 §6.4 #28）。T-06-06。
//
// 🔴 **越境経路 1 の入口の画面である。** 守るのは 4 つ:
//    ①**既定で広げない**（`F-014 AC-2`）—— 「すべて選択」を置かない。初期値は
//      **現在公開中の相手だけ**であり、「全部にチェックが入った状態」を作らない。
//    ②**ゲート FAIL を無視して公開する導線を作らない**（`BR-18` / `F-014 AC-3`）——
//      「了解のうえ公開」に相当するボタンが 1 つも無い。
//    ③🔴 **保留を成功と書かない**（`CLAUDE.md` §11.1）。ゲート本体は SP-07 であり、
//      **公開先の追加は現時点で成立しない**。その事実を「品質ゲート」節に常時出す。
//    ④**公開解除は確認ステップを挟み、「作成済みの提案は残ります」を明記する**
//      （`docs/04` §5-4 / `F-014` 処理④）。
//
// 🔴 **ホスト専用の画面である**（`docs/04` §S-013 権限差分）。取引先の社名一覧が出るため、
//    パートナー文脈からは到達させない（`page.tsx` のリダイレクトと、`#28` の `requireRole` /
//    `requireHost` / RLS の C2。UI で隠すだけにしない）。
//
// 🔴 T3（デスクトップ主体）だが**モバイルで遮断しない**（`CLAUDE.md` §13.3）。1 カラムで積み、
//    プレビューは縦に劣化させる。**一括公開（複数案件をまとめて公開）は作らない**（`BR-50`）。
//
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@ses/ui';
// 🔴 **型だけ**を import する（`lib/projects/visibility.ts` は `@ses/db` に依存する
//    サーバ専用モジュールである。`tests/static/client-db-boundary.test.ts`）。
import type { ProjectVisibilityChoice } from '../../../../../lib/projects/visibility';

/** プレビューの定義リスト 1 行（値は**サーバ側で文言化済み**）。 */
export type PublishPreviewRow = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
};

/** プレビューの要件ブロック（必須 / 尚可）。 */
export type PublishPreviewRequirements = {
  readonly kind: string;
  readonly heading: string;
  readonly empty: string;
  readonly rows: readonly { readonly key: string; readonly requirement: string; readonly years: string }[];
};

/** 🔴 商流情報の混入の**警告**（合否ではない。`lib/projects/publish-preview.ts`）。 */
export type PublishPreviewWarning = {
  readonly key: string;
  /** 「案件名」など、混ざっている欄の名前（文言化済み）。 */
  readonly field: string;
  /** 「エンド企業名」など、混ざっている情報の種別（文言化済み）。 */
  readonly kind: string;
};

/** 取引先の画面での見え方（`PartnerProjectDetailView` に写る値だけで組み立てる）。 */
export type PublishPreview = {
  readonly name: string;
  readonly headline: readonly PublishPreviewRow[];
  readonly conditions: readonly PublishPreviewRow[];
  readonly requirements: readonly PublishPreviewRequirements[];
  readonly publicSummary: string;
  readonly requirementColumnRequirement: string;
  readonly requirementColumnYears: string;
  readonly warnings: readonly PublishPreviewWarning[];
};

export type ProjectVisibilityScreenMessages = {
  readonly lead: string;
  readonly sectionCurrent: string;
  readonly sectionSelect: string;
  readonly sectionPreview: string;
  readonly sectionGate: string;
  readonly sectionExecute: string;
  readonly currentEmpty: string;
  readonly currentColumnPartner: string;
  readonly currentColumnPublishedOn: string;
  readonly selectLegend: string;
  readonly selectNote: string;
  readonly selectPublishedBadge: string;
  readonly selectSuspendedBadge: string;
  readonly selectSuspendedNote: string;
  readonly selectEmptyTitle: string;
  readonly selectEmptyLead: string;
  readonly selectEmptyLink: string;
  readonly previewNote: string;
  readonly previewWarningTitle: string;
  readonly previewWarningLead: string;
  readonly gatePendingTitle: string;
  readonly gatePendingLead: string;
  readonly submit: string;
  readonly submitting: string;
  readonly revokeConfirmTitle: string;
  readonly revokeConfirmLead: string;
  readonly revokeConfirmSubmit: string;
  readonly revokeConfirmCancel: string;
  readonly resultPendingGate: string;
  readonly resultNoPublish: string;
  readonly errorSave: string;
  readonly deniedTitle: string;
  readonly backToDetail: string;
  readonly editProject: string;
  /** 🔴 `docs/04` §10.1 `S-013`「選択変更の途中で離脱 → 確認」。 */
  readonly leaveConfirm: string;
};

export type ProjectVisibilityScreenProps = {
  readonly projectId: string;
  readonly projectName: string;
  readonly choices: readonly ProjectVisibilityChoice[];
  readonly preview: PublishPreview;
  readonly detailHref: string;
  readonly editHref: string;
  readonly partnerCompaniesHref: string;
  /**
   * 🔴 実行系を止めている理由（`F-004 AC-7` / `docs/04` §S-013 権限差分）。`null` なら実行可。
   *    **拒否の本体は `#28` の `requireExecutable`** であり、これはその理由の表示である。
   */
  readonly denialMessage: string | null;
  readonly messages: ProjectVisibilityScreenMessages;
};

type Phase = 'idle' | 'confirmRevoke' | 'submitting' | 'error';

/** `#28` の応答（docs/05 §6.4 #28）。 */
type VisibilityResponse = {
  readonly reviewGateId: string | null;
  readonly verdict: 'PENDING_GATE' | 'NO_PUBLISH_REQUESTED';
};

function sortedIds(values: Iterable<string>): readonly string[] {
  return [...values].sort();
}

/**
 * 2 つの選択が同じ集合か（🔴 離脱確認の判定そのもの。`*.render.test.tsx` が規則を固定する）。
 * 🔴 順序に依存させない（`sortedIds` で並びはそろえているが、**離脱確認の判定を並びの都合に
 *    依存させない** —— 並べ替えの実装を変えた瞬間に「変更していないのに確認が出る」になる）。
 */
export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function ProjectVisibilityScreen({
  projectId,
  projectName,
  choices,
  preview,
  detailHref,
  editHref,
  partnerCompaniesHref,
  denialMessage,
  messages,
}: ProjectVisibilityScreenProps) {
  /**
   * 🔴 いま実際に公開されている相手（＝ サーバの状態）。**選択とは別に持つ。**
   *    保存後、解除された分だけがここから消える（追加はゲート待ちなので**増えない**）——
   *    「選んだ ＝ 公開された」と読める状態を画面に作らないための分離である。
   */
  const [publishedIds, setPublishedIds] = useState<readonly string[]>(() =>
    sortedIds(
      choices.filter((choice) => choice.publishedOn !== null).map((choice) => choice.partnerCompanyId),
    ),
  );
  // 🔴 初期選択は「現在公開中の相手」だけ（`F-014 AC-2`。全選択の初期値を作らない）。
  const [selected, setSelected] = useState<readonly string[]>(publishedIds);
  /**
   * 🔴 **最後にサーバへ送って成功した選択**（離脱確認の基準）。
   *
   * 🔴 基準を `publishedIds` にしない。追加はゲート保留で `publishedIds` に入らないため
   *    （`publish-gate.ts`）、保存に成功した直後も「選択 ≠ 公開中」が真のままになり、
   *    **保存できているのに「未保存です」と言われ続ける**。それが続くと利用者は確認そのものを
   *    読まなくなり、本当に未保存のときの離脱を止められなくなる。
   */
  const [savedSelection, setSavedSelection] = useState<readonly string[]>(publishedIds);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<VisibilityResponse['verdict'] | null>(null);

  const canExecute = denialMessage === null;
  const publishedSet = new Set(publishedIds);
  const selectedSet = new Set(selected);
  const willRevoke = publishedIds.filter((id) => !selectedSet.has(id));
  const willPublish = selected.filter((id) => !publishedSet.has(id));
  /** 🔴 未保存の変更があるか（離脱確認の条件）。 */
  const dirty = !sameSelection(selected, savedSelection);

  // 🔴 `docs/04` §10.1 `S-013`「選択変更の途中で離脱 → 確認」（`S-012` と同じ実装で揃える。
  //    ブラウザの標準ダイアログを使う —— 自前のモーダルでは戻る・タブを閉じるを捕まえられない）。
  // ⚠️ 送信中（`submitting`）は対象外にする。要求はすでにブラウザの外へ出ており、ここで
  //    引き止めても利用者が取れる行動が無い（サーバ側の 1 トランザクションは通るか通らないかで、
  //    画面に留まっても結果は変わらない）。
  useEffect(() => {
    if (!dirty || phase === 'submitting') return undefined;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = messages.leaveConfirm;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, phase, messages.leaveConfirm]);

  function toggle(partnerCompanyId: string): void {
    setResult(null);
    setPhase('idle');
    setSelected((current) =>
      current.includes(partnerCompanyId)
        ? current.filter((id) => id !== partnerCompanyId)
        : sortedIds([...current, partnerCompanyId]),
    );
  }

  async function save(): Promise<void> {
    setPhase('submitting');
    try {
      const response = await fetch(`/api/projects/${projectId}/visibility`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // 🔴 送るのは公開先の集合だけである（`docs/05` §6.4 #28 の実装の決着。
        //    外部公開用の記載は `S-012` が書く）。
        body: JSON.stringify({ partnerCompanyIds: selected }),
      });
      if (!response.ok) {
        // 🔴 選択を捨てない（`docs/04` §10.1 の「条件保持の再試行」と同じ規律）。
        setPhase('error');
        return;
      }
      const body = (await response.json()) as VisibilityResponse;
      // 🔴 **公開されたのは「保ったもの」だけである。** 追加はゲート待ちで行にならないため、
      //    ここで `selected` を公開済みとして扱わない（`publish-gate.ts` の 🔴）。
      setPublishedIds(publishedIds.filter((id) => selectedSet.has(id)));
      // 🔴 送った選択が新しい基準になる ＝ 離脱確認が解除される（保存できているのに
      //    引き止めない）。**公開されたかどうかとは別の話**である（上の 🔴 を参照）。
      setSavedSelection(selected);
      setResult(body.verdict);
      setPhase('idle');
    } catch {
      setPhase('error');
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phase === 'submitting' || !canExecute) return;
    // 🔴 解除が含まれるときは確認を挟む（`docs/04` §5-4）。
    if (willRevoke.length > 0 && phase !== 'confirmRevoke') {
      setResult(null);
      setPhase('confirmRevoke');
      return;
    }
    await save();
  }

  const nameOf = new Map(choices.map((choice) => [choice.partnerCompanyId, choice.name]));
  const publishedOnOf = new Map(
    choices.map((choice) => [choice.partnerCompanyId, choice.publishedOn]),
  );

  return (
    <div data-testid="project-visibility-screen">
      <h1 className="mb-2 text-xl font-bold text-slate-900" data-testid="project-visibility-name">
        {projectName}
      </h1>
      <p className="mb-4 text-sm text-slate-600" data-testid="project-visibility-lead">
        {messages.lead}
      </p>

      {denialMessage === null ? null : (
        <div
          role="alert"
          className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="project-visibility-denied"
        >
          <p className="font-bold">{messages.deniedTitle}</p>
          <p>{denialMessage}</p>
        </div>
      )}

      {/* --- 1. 現在の公開状態 ------------------------------------------------ */}
      <section className="mb-6" data-testid="project-visibility-current">
        <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionCurrent}</h2>
        {publishedIds.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="project-visibility-current-empty">
            {messages.currentEmpty}
          </p>
        ) : (
          <table className="w-full border-collapse text-sm" data-testid="project-visibility-current-table">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="p-2">{messages.currentColumnPartner}</th>
                <th className="p-2">{messages.currentColumnPublishedOn}</th>
              </tr>
            </thead>
            <tbody>
              {publishedIds.map((id) => (
                <tr key={id} className="border-b border-slate-100">
                  <td className="p-2">{nameOf.get(id) ?? id}</td>
                  <td className="p-2">{publishedOnOf.get(id) ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <form onSubmit={onSubmit} noValidate data-testid="project-visibility-form">
        {/* --- 2. 公開先の選択 ------------------------------------------------ */}
        <section className="mb-6" data-testid="project-visibility-select">
          <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionSelect}</h2>
          {choices.length === 0 ? (
            // 🔴 `docs/04` §10.1 `S-013`: 取引先が 1 社も無いときは `S-014` へ導く。
            <div data-testid="project-visibility-select-empty">
              <p className="text-sm font-bold text-slate-900">{messages.selectEmptyTitle}</p>
              <p className="mb-2 text-sm text-slate-600">{messages.selectEmptyLead}</p>
              <Link className="ses-secondary-link" href={partnerCompaniesHref}>
                {messages.selectEmptyLink}
              </Link>
            </div>
          ) : (
            <fieldset disabled={!canExecute || phase === 'submitting'}>
              <legend className="text-sm text-slate-700">{messages.selectLegend}</legend>
              {/* 🔴 「すべて選択」を置かない（`docs/04` §S-013）。理由も画面に書く。 */}
              <p className="mb-2 text-xs text-slate-500" data-testid="project-visibility-select-note">
                {messages.selectNote}
              </p>
              <ul className="list-none p-0">
                {choices.map((choice) => (
                  <li key={choice.partnerCompanyId} className="border-b border-slate-100 py-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(choice.partnerCompanyId)}
                        onChange={() => toggle(choice.partnerCompanyId)}
                        data-testid={`project-visibility-choice-${choice.partnerCompanyId}`}
                      />
                      <span className="text-slate-900">{choice.name}</span>
                      {choice.publishedOn === null ? null : (
                        <span className="text-xs text-emerald-700">
                          {messages.selectPublishedBadge}
                        </span>
                      )}
                      {choice.suspended ? (
                        <span className="text-xs text-amber-700">
                          {messages.selectSuspendedBadge}
                        </span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
              {choices.some((choice) => choice.suspended) ? (
                <p className="mt-2 text-xs text-slate-500" data-testid="project-visibility-suspended-note">
                  {messages.selectSuspendedNote}
                </p>
              ) : null}
            </fieldset>
          )}
        </section>

        {/* --- 3. 公開されたときの見え方 --------------------------------------- */}
        <section className="mb-6" data-testid="project-visibility-preview">
          <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionPreview}</h2>
          <p className="mb-3 text-xs text-slate-500" data-testid="project-visibility-preview-note">
            {messages.previewNote}
          </p>

          {preview.warnings.length === 0 ? null : (
            <div
              className="mb-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              data-testid="project-visibility-preview-warning"
            >
              <p className="font-bold">{messages.previewWarningTitle}</p>
              <ul className="list-disc pl-5">
                {preview.warnings.map((warning) => (
                  <li key={warning.key} data-testid={`project-visibility-preview-warning-${warning.key}`}>
                    {warning.field} / {warning.kind}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs">{messages.previewWarningLead}</p>
            </div>
          )}

          <div className="border border-slate-200 bg-white p-4">
            <p className="mb-2 text-base font-bold text-slate-900">{preview.name}</p>
            <dl className="mb-3 text-sm">
              {[...preview.headline, ...preview.conditions].map((row) => (
                <div key={row.key} className="flex gap-3 border-b border-slate-100 py-1 last:border-b-0">
                  <dt className="w-40 shrink-0 text-slate-500">{row.label}</dt>
                  <dd className="m-0 text-slate-900">{row.value}</dd>
                </div>
              ))}
            </dl>
            {preview.requirements.map((block) => (
              <div key={block.kind} className="mb-3">
                <h3 className="text-sm font-bold text-slate-900">{block.heading}</h3>
                {block.rows.length === 0 ? (
                  <p className="text-sm text-slate-600">{block.empty}</p>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left">
                        <th className="p-2">{preview.requirementColumnRequirement}</th>
                        <th className="p-2">{preview.requirementColumnYears}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row) => (
                        <tr key={row.key} className="border-b border-slate-100">
                          <td className="p-2">{row.requirement}</td>
                          <td className="p-2">{row.years}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
            <p className="whitespace-pre-wrap text-sm text-slate-900" data-testid="project-visibility-preview-summary">
              {preview.publicSummary}
            </p>
          </div>
        </section>

        {/* --- 4. 品質ゲート --------------------------------------------------- */}
        {/* 🔴 保留を「公開しました」と書かない（`CLAUDE.md` §11.1）。 */}
        <section className="mb-6" data-testid="project-visibility-gate">
          <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionGate}</h2>
          <div className="border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <p className="font-bold" data-testid="project-visibility-gate-title">
              {messages.gatePendingTitle}
            </p>
            <p data-testid="project-visibility-gate-lead">{messages.gatePendingLead}</p>
          </div>
        </section>

        {/* --- 5. 公開の実行 --------------------------------------------------- */}
        <section data-testid="project-visibility-execute">
          <h2 className="mb-2 text-base font-bold text-slate-900">{messages.sectionExecute}</h2>

          {phase === 'error' ? (
            <p role="alert" className="mb-2 text-sm text-red-700" data-testid="project-visibility-error">
              {messages.errorSave}
            </p>
          ) : null}
          {result === null ? null : (
            <p role="status" className="mb-2 text-sm text-emerald-700" data-testid="project-visibility-result">
              {result === 'PENDING_GATE' ? messages.resultPendingGate : messages.resultNoPublish}
            </p>
          )}

          {phase === 'confirmRevoke' ? (
            // 🔴 `docs/04` §5-4:「作成済みの提案は残ります」を確認画面に明記する。
            <div
              className="mb-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              data-testid="project-visibility-revoke-confirm"
            >
              <p className="font-bold">{messages.revokeConfirmTitle}</p>
              <p className="mb-2">{messages.revokeConfirmLead}</p>
              <ul className="mb-2 list-disc pl-5">
                {willRevoke.map((id) => (
                  <li key={id}>{nameOf.get(id) ?? id}</li>
                ))}
              </ul>
              <div className="flex items-center gap-3">
                <Button type="submit" data-testid="project-visibility-revoke-submit">
                  {messages.revokeConfirmSubmit}
                </Button>
                <button
                  type="button"
                  className="ses-secondary-link"
                  onClick={() => setPhase('idle')}
                  data-testid="project-visibility-revoke-cancel"
                >
                  {messages.revokeConfirmCancel}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              {canExecute ? (
                <Button
                  type="submit"
                  disabled={phase === 'submitting' || (willPublish.length === 0 && willRevoke.length === 0)}
                  data-testid="project-visibility-submit"
                >
                  {phase === 'submitting' ? messages.submitting : messages.submit}
                </Button>
              ) : null}
              <Link className="ses-secondary-link" href={editHref} data-testid="project-visibility-edit-link">
                {messages.editProject}
              </Link>
              <Link className="ses-secondary-link" href={detailHref} data-testid="project-visibility-detail-link">
                {messages.backToDetail}
              </Link>
            </div>
          )}
        </section>
      </form>
    </div>
  );
}
