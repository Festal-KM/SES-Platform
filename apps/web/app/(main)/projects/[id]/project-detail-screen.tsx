// apps/web/app/(main)/projects/[id]/project-detail-screen.tsx
// `S-011` 案件詳細 — 本体（docs/04 §S-011 / `F-013` / `F-014` / docs/05 §6.4 #27）。T-06-02。
//
// 🔴 **ホストと取引先で表示項目が構造的に違う**（docs/04 §S-011 の 🔴）。分岐は `view.audience`
//    だけで行い、**取引先の枝からは商流情報・公開範囲の値に型として到達できない**
//    （`PartnerProjectDetailView` にフィールドが無い）。「値があるかどうかを見て出し分ける」
//    形にしない —— それは「取得後に隠す」実装であり、`F-013 AC-2` の担保を画面まで持って
//    こられない。
//
// 🔴 **取引先に出さないもの**（`F-013 AC-2` / `F-014 AC-3` / `F-014 AC-4` / `BR-07`）:
//    エンド企業名、内部単価、他社名、公開先の社数と社名、この案件への総提案数、他社提案の存在。
//    件数バッジ・並び順の変化・「あなたは N 番目」に相当する表現も置かない（docs/04 §3.2）。
//
// 🔴 **T2（モバイル閲覧可）**（docs/04 §S-011 デバイス別 / `CLAUDE.md` §13.3）:
//    - 見出し（状態 / 募集人数 / 開始日）と**要件・条件は折りたたまない**
//      （「要件は判断材料であり折りたたまない」。docs/04 §11）
//    - デスクトップは左に要件・条件、右に公開範囲・提案。タブレット以下は縦積みで
//      「要件 → 条件 → 提案 → 公開範囲」（公開範囲は腰を据えた作業なので下）
//    - **遮断しない**（Tier 3 相当のセクションもモバイルで隠さない）
//
// 🔴 文言は props（`packages/i18n`）から受け取る。ここにベタ書きしない（`CLAUDE.md` §3.5）。
import type { ReactNode } from 'react';
import Link from 'next/link';
// 🔴 型だけを import する（本ファイルはサーバコンポーネントだが、`@ses/db` の**値**を
//    持ち込むと `*.render.test.tsx` が Prisma クライアントを読み込むことになる）。
import type { RequirementKind } from '@ses/db';
import {
  projectCommerceRows,
  projectConditionRows,
  projectHeadlineRows,
  projectRequirementRows,
  projectVisibilityRows,
  type ProjectDetailRow,
  type ProjectRequirementRow,
} from '../../../../lib/projects/detail';
import type { ProjectDetailView } from '../../../../lib/projects/service';

export type ProjectDetailScreenMessages = {
  readonly sectionRequirements: string;
  readonly sectionConditions: string;
  readonly sectionCommerce: string;
  readonly sectionPublicSummary: string;
  readonly sectionVisibility: string;
  /** 🔴 ホストは「この案件への提案」、取引先は「提案（御社が作成した提案）」（母集団を添える）。 */
  readonly sectionProposals: string;
  readonly requirementHeadings: Readonly<Record<RequirementKind, string>>;
  readonly requirementNotes: Readonly<Record<RequirementKind, string>>;
  readonly requirementEmpties: Readonly<Record<RequirementKind, string>>;
  readonly requirementColumnRequirement: string;
  readonly requirementColumnYears: string;
  readonly publicSummaryEmpty: string;
  readonly commerceNotice: string;
  readonly visibilityEmpty: string;
  readonly visibilityColumnPartner: string;
  readonly visibilityColumnPublishedOn: string;
  readonly visibilityProposalCountComingSoon: string;
  readonly visibilitySettingsComingSoon: string;
  readonly partnerPublished: string;
  readonly proposalsEmpty: string;
  readonly proposalsComingSoon: string;
  readonly candidatesComingSoon: string;
  readonly edit: string;
  readonly viewRecorded: string;
};

/**
 * 要件ブロックの並び（`MUST` → `NICE`）。
 * 🔴 値の出所は `@ses/db` の `REQUIREMENT_KINDS` であり、画面が独自に並べ替えたり
 *    文字列を書き写したりしない（`F-013 AC-1` の区分と 1 対 1。`form-props.ts` と同じ規律）。
 */
export type RequirementKindOrder = readonly RequirementKind[];

function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="border border-slate-200 bg-white" data-testid={`project-detail-${id}`}>
      <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">
        {title}
      </h2>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function DefinitionList({
  id,
  rows,
}: {
  readonly id: string;
  readonly rows: readonly ProjectDetailRow[];
}) {
  return (
    <dl className="text-sm">
      {rows.map((row) => (
        <div key={row.key} className="flex gap-3 border-b border-slate-100 py-2 last:border-b-0">
          <dt className="w-40 shrink-0 text-slate-500">{row.label}</dt>
          <dd className="m-0 text-slate-900" data-testid={`project-detail-${id}-${row.key}`}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RequirementTable({
  kind,
  rows,
  messages,
}: {
  readonly kind: RequirementKind;
  readonly rows: readonly ProjectRequirementRow[];
  readonly messages: ProjectDetailScreenMessages;
}) {
  return (
    <div className="mb-4 last:mb-0" data-testid={`project-detail-requirements-${kind}`}>
      <h3 className="text-sm font-bold text-slate-900">{messages.requirementHeadings[kind]}</h3>
      <p className="mb-2 text-xs text-slate-500">{messages.requirementNotes[kind]}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600" data-testid={`project-detail-requirements-${kind}-empty`}>
          {messages.requirementEmpties[kind]}
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-2">{messages.requirementColumnRequirement}</th>
              <th className="p-2">{messages.requirementColumnYears}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-slate-100">
                <td className="p-2">{row.requirement}</td>
                <td className="p-2">{row.years}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ProjectDetailScreen({
  view,
  requirementKinds,
  canEdit,
  messages,
}: {
  readonly view: ProjectDetailView;
  readonly requirementKinds: RequirementKindOrder;
  /**
   * 🔴 `VIEWER` と取引先には `S-012` への導線を出さない（docs/04 §S-011 権限差分）。
   *    ⚠️ これは UI の配慮であって拒否の本体ではない（本体は #26 のガードと `S-012` の
   *    リダイレクト、および `readProjectForEdit` の `requireHost`）。
   */
  readonly canEdit: boolean;
  readonly messages: ProjectDetailScreenMessages;
}) {
  const headline = projectHeadlineRows(view);
  const conditions = projectConditionRows(view);

  return (
    <div data-testid="project-detail-screen" data-audience={view.audience}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900" data-testid="project-detail-name">
          {view.name}
        </h1>
      </div>

      {/* 🔴 折りたたみの外（`CLAUDE.md` §13.3）。移動中の判断に要る 3 値。 */}
      <dl
        className="mb-4 grid grid-cols-1 gap-3 border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-3"
        data-testid="project-detail-headline"
      >
        {headline.map((row) => (
          <div key={row.key}>
            <dt className="text-slate-500">{row.label}</dt>
            <dd
              className="m-0 font-bold text-slate-900"
              data-testid={`project-detail-headline-${row.key}`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* 🔴 `docs/04` §S-011: 公開範囲未設定（ホスト）の警告は**要件の上**に置く（`F-014 AC-2`。
          既定は非公開であり、設定を忘れると誰にも届かない）。 */}
      {view.audience === 'HOST' && view.visibilities.length === 0 ? (
        <p
          className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="project-detail-visibility-warning"
        >
          {messages.visibilityEmpty}
        </p>
      ) : null}

      {/* 🔴 `docs/04` §S-011 取引先セクション 4「公開されている旨の説明」。 */}
      {view.audience === 'PARTNER' ? (
        <p
          className="mb-4 border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
          data-testid="project-detail-partner-published"
        >
          {messages.partnerPublished}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-4">
        {canEdit ? (
          <Link
            className="ses-secondary-link"
            href={`/projects/${view.id}/edit`}
            data-testid="project-detail-edit-link"
          >
            {messages.edit}
          </Link>
        ) : null}
        <p className="text-sm text-slate-500" data-testid="project-detail-view-recorded">
          {messages.viewRecorded}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 左（デスクトップ）/ 上（タブレット以下）: 要件 → 条件 → 外部公開用の記載 */}
        <div className="flex flex-col gap-4">
          <Section id="requirements" title={messages.sectionRequirements}>
            {requirementKinds.map((kind) => (
              <RequirementTable
                key={kind}
                kind={kind}
                rows={projectRequirementRows(view.requirements, kind)}
                messages={messages}
              />
            ))}
          </Section>

          <Section id="conditions" title={messages.sectionConditions}>
            <DefinitionList id="conditions" rows={conditions} />
          </Section>

          <Section id="public-summary" title={messages.sectionPublicSummary}>
            <p className="whitespace-pre-wrap text-sm text-slate-900" data-testid="project-detail-public-summary">
              {view.publicSummary ?? messages.publicSummaryEmpty}
            </p>
          </Section>
        </div>

        {/* 右（デスクトップ）/ 下（タブレット以下）: 提案 → 商流情報・公開範囲 */}
        <div className="flex flex-col gap-4">
          <Section id="proposals" title={messages.sectionProposals}>
            <p className="mb-2 text-sm text-slate-600" data-testid="project-detail-proposals-empty">
              {messages.proposalsEmpty}
            </p>
            <p className="text-xs text-slate-500" data-testid="project-detail-proposals-coming-soon">
              {messages.proposalsComingSoon}
            </p>
            {/* ⚠️ `docs/04` §S-011「候補を探す」（→ `S-016`）は SP-08 / T-06-04。
                存在しない画面へのリンクを置かない（`S-012` で `S-013` を保留したのと同じ判断）。 */}
            <p className="mt-2 text-xs text-slate-500" data-testid="project-detail-candidates-coming-soon">
              {messages.candidatesComingSoon}
            </p>
          </Section>

          {/* 🔴 ここから下はホストの枝にしか存在しない。取引先の枝には
              `endClientName` / `internalUnitPrice` / `visibilities` が**型として無い**。 */}
          {view.audience === 'HOST' ? (
            <>
              <Section id="commerce" title={messages.sectionCommerce}>
                <p className="mb-3 text-xs text-slate-500" data-testid="project-detail-commerce-notice">
                  {messages.commerceNotice}
                </p>
                <DefinitionList id="commerce" rows={projectCommerceRows(view)} />
              </Section>

              <Section id="visibility" title={messages.sectionVisibility}>
                {view.visibilities.length === 0 ? (
                  <p className="text-sm text-slate-600" data-testid="project-detail-visibility-empty">
                    {messages.visibilityEmpty}
                  </p>
                ) : (
                  <table className="w-full border-collapse text-sm" data-testid="project-detail-visibility-table">
                    <thead>
                      <tr className="border-b border-slate-200 text-left">
                        <th className="p-2">{messages.visibilityColumnPartner}</th>
                        <th className="p-2">{messages.visibilityColumnPublishedOn}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectVisibilityRows(view.visibilities).map((row) => (
                        <tr key={row.key} className="border-b border-slate-100">
                          <td className="p-2">{row.partnerCompanyName}</td>
                          <td className="p-2">{row.publishedOn}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="mt-3 text-xs text-slate-500" data-testid="project-detail-visibility-proposal-count">
                  {messages.visibilityProposalCountComingSoon}
                </p>
                {/* ⚠️ `S-013`（公開範囲の設定）は T-06-06。存在しない画面へのリンクを置かない。 */}
                <p className="mt-1 text-xs text-slate-500" data-testid="project-detail-visibility-settings">
                  {messages.visibilitySettingsComingSoon}
                </p>
              </Section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
