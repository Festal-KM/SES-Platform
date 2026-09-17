// apps/web/app/(main)/engineers/[id]/engineer-proposal-sections.tsx
// `S-006` セクション 4（提案履歴）・5（凍結情報との差分）。docs/04 §S-006 / §5-6 / `F-019 AC-2` / docs/05 §6.5 #46b。T-12-16。
//
// ============================================================================
// 🔴 この 2 セクションが守るもの
// ============================================================================
//   ① 🔴 **セクション 4 の行は `S-019` と同じ出所・同じ射影**（`listProposals` の `HostProposalListItem` / `PartnerProposalListItem`）。
//      `S-006` 固有の射影を作らない（docs/05 §6.5）。列 = 提案先 / 案件 / 状態バッジ / 作成日 / `S-023` への導線。
//      空 → 「この人材はまだ提案されていません」。
//   ② 🔴 **セクション 5 は凍結側と現在値を左右に並置し、1 つのリストに混在させない**（`F-019 AC-5` / docs/05 §6.5「#36 / #46 / #46b の
//      経験内容の凍結」）。項目の表は `frozen` / `current` が**別の列**、経歴は**別の表**（凍結側 = `S-023` セクション 3 と同じ 4 列・
//      同じ並び / 現在値 = セクション 8 と同じ部品）。行どうしの対応付けは描かない（凍結行に台帳の行 ID が無い）。
//   ③ 🔴 「提案後に変更」の注記は `lib/engineers/proposal-sections-rows.ts` が `frozen` と `current` を突き合わせて付けた `changed`
//      だけから描く（API は判定を返さない）。
//   ④ 404（現在値を参照できない）は「この提案の現在値は参照できません」とだけ出し、理由（他社所有）を語らない（docs/05 §4.8）。
//
// 🔴 `'use client'` を付けない（状態もイベントハンドラも持たない。選択は `?diff=` の URL で表し、サーバコンポーネントが
//    `readProposalSnapshotDiff`〔#46b と同じ関数〕を呼ぶ）。文言は props（`proposal-sections-props.ts` が `t()` で解決する）。
// 🔴 T2（モバイル閲覧可）。表は `Table` の器（`overflow-x-auto`）に閉じ、行数で打ち切らない。経歴の並置は `lg` 未満で縦積み
//    （2 カラムの縮小ではなく順序を保った縦積み。凍結側 → 現在値）。
import Link from 'next/link';
import { Badge, SECONDARY_LINK_CLASSES, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type BadgeVariant } from '@ses/ui';
import type { EngineerProposalHistoryRow, SnapshotDiffRows } from '../../../../lib/engineers/proposal-sections-rows';
import type { ProposalStateTone } from '../../../../lib/proposals/list-rows';
import { DetailSection } from './detail-section';

export type EngineerProposalSectionsMessages = {
  readonly sectionProposals: string;
  readonly sectionDiff: string;
  readonly proposalsEmpty: string;
  readonly columnRecipient: string;
  readonly columnProject: string;
  readonly columnState: string;
  readonly columnCreatedAt: string;
  readonly columnActions: string;
  readonly detailLink: string;
  readonly diffLink: string;
  readonly diffSelected: string;
  readonly diffLead: string;
  readonly diffUnavailable: string;
  readonly columnField: string;
  readonly columnFrozen: string;
  readonly columnCurrent: string;
  readonly careerColumnPeriod: string;
  readonly careerColumnRole: string;
  readonly careerColumnDescription: string;
  readonly careerColumnTechnologies: string;
  readonly careerColumnSource: string;
  readonly careersFrozenTitle: string;
  readonly careersCurrentTitle: string;
  readonly careersNote: string;
};

/** セクション 5 の状態。`NONE` = 未選択（提案がある場合だけ描く）/ `UNAVAILABLE` = 404 / `READY` = 差分。 */
export type EngineerSnapshotDiffState =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'UNAVAILABLE' }
  | { readonly kind: 'READY'; readonly rows: SnapshotDiffRows };

export type EngineerProposalSectionsProps = {
  readonly history: readonly EngineerProposalHistoryRow[];
  readonly diff: EngineerSnapshotDiffState;
  readonly messages: EngineerProposalSectionsMessages;
};

const TONE_VARIANTS = {
  neutral: 'neutral',
  progress: 'outline',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
} as const satisfies Record<ProposalStateTone, BadgeVariant>;

function Lines({ lines }: { readonly lines: readonly string[] }) {
  return (
    <ul className="m-0 list-none p-0">
      {lines.map((line, index) => (
        <li key={`${String(index)}-${line}`}>{line}</li>
      ))}
    </ul>
  );
}

function FrozenCareers({ rows, messages }: { readonly rows: SnapshotDiffRows['careers']; readonly messages: EngineerProposalSectionsMessages }) {
  return (
    <div data-testid="engineer-snapshot-diff-careers-frozen" data-side="frozen">
      <h4 className="mb-2 text-sm font-semibold text-slate-900">{messages.careersFrozenTitle}</h4>
      {rows.frozenEmpty === null ? (
        <Table data-testid="engineer-snapshot-diff-careers-frozen-table">
          <TableHeader>
            <TableRow>
              <TableHead>{messages.careerColumnPeriod}</TableHead>
              <TableHead>{messages.careerColumnRole}</TableHead>
              <TableHead>{messages.careerColumnDescription}</TableHead>
              <TableHead>{messages.careerColumnTechnologies}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.frozen.map((career) => (
              <TableRow key={career.key} align="top" data-testid={`engineer-snapshot-diff-frozen-career-${career.key}`}>
                <TableCell>{career.period}</TableCell>
                <TableCell whitespace="normal">{career.role}</TableCell>
                <TableCell whitespace="normal" className="whitespace-pre-wrap">
                  {career.description}
                </TableCell>
                <TableCell whitespace="normal">{career.technologies}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-slate-600" data-testid="engineer-snapshot-diff-careers-frozen-empty">
          {rows.frozenEmpty}
        </p>
      )}
    </div>
  );
}

function CurrentCareers({ rows, messages }: { readonly rows: SnapshotDiffRows['careers']; readonly messages: EngineerProposalSectionsMessages }) {
  return (
    <div data-testid="engineer-snapshot-diff-careers-current" data-side="current">
      <h4 className="mb-2 text-sm font-semibold text-slate-900">{messages.careersCurrentTitle}</h4>
      {rows.currentEmpty === null ? (
        <Table data-testid="engineer-snapshot-diff-careers-current-table">
          <TableHeader>
            <TableRow>
              <TableHead>{messages.careerColumnPeriod}</TableHead>
              <TableHead>{messages.careerColumnRole}</TableHead>
              <TableHead>{messages.careerColumnDescription}</TableHead>
              <TableHead>{messages.careerColumnTechnologies}</TableHead>
              <TableHead>{messages.careerColumnSource}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.current.map((career) => (
              <TableRow key={career.id} align="top" data-testid={`engineer-snapshot-diff-current-career-${career.id}`}>
                <TableCell>{career.period}</TableCell>
                <TableCell whitespace="normal">{career.role}</TableCell>
                <TableCell whitespace="normal" className="whitespace-pre-wrap">
                  {career.description}
                </TableCell>
                <TableCell whitespace="normal">{career.technologies}</TableCell>
                <TableCell>{career.source}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-slate-600" data-testid="engineer-snapshot-diff-careers-current-empty">
          {rows.currentEmpty}
        </p>
      )}
    </div>
  );
}

function SnapshotDiffView({ rows, messages }: { readonly rows: SnapshotDiffRows; readonly messages: EngineerProposalSectionsMessages }) {
  return (
    <div data-testid="engineer-snapshot-diff" data-proposal-id={rows.proposalId}>
      <h3 className="mb-3 text-sm font-semibold text-slate-900" data-testid="engineer-snapshot-diff-title">
        {rows.title}
      </h3>

      {/* 項目の差分。🔴 `frozen` / `current` は別の列。注記（提案後に変更 / 変更なし）は `changed` から。 */}
      <Table data-testid="engineer-snapshot-diff-fields">
        <TableHeader>
          <TableRow>
            <TableHead>{messages.columnField}</TableHead>
            <TableHead>{messages.columnFrozen}</TableHead>
            <TableHead>{messages.columnCurrent}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.fields.map((field) => (
            <TableRow
              key={field.key}
              align="top"
              data-testid={`engineer-snapshot-diff-field-${field.key}`}
              data-changed={field.changed ? 'true' : 'false'}
            >
              <TableCell className="text-slate-500">{field.label}</TableCell>
              <TableCell whitespace="normal" data-testid={`engineer-snapshot-diff-frozen-${field.key}`}>
                <Lines lines={field.frozen} />
              </TableCell>
              <TableCell whitespace="normal" data-testid={`engineer-snapshot-diff-current-${field.key}`}>
                <Lines lines={field.current} />
              </TableCell>
              <TableCell>
                {field.changed ? (
                  <Badge variant="warning" data-testid={`engineer-snapshot-diff-note-${field.key}`}>
                    {field.note}
                  </Badge>
                ) : (
                  <span className="text-xs text-slate-500" data-testid={`engineer-snapshot-diff-note-${field.key}`}>
                    {field.note}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* 経歴。🔴 左右に並置（`lg` 未満は縦積み）。1 つのリストに混在させない。 */}
      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {rows.careers.changed ? (
            <Badge variant="warning" data-testid="engineer-snapshot-diff-careers-note" data-changed="true">
              {rows.careers.note}
            </Badge>
          ) : (
            <span className="text-xs text-slate-500" data-testid="engineer-snapshot-diff-careers-note" data-changed="false">
              {rows.careers.note}
            </span>
          )}
          <p className="m-0 text-xs text-slate-500" data-testid="engineer-snapshot-diff-careers-lead">
            {messages.careersNote}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="engineer-snapshot-diff-careers">
          <FrozenCareers rows={rows.careers} messages={messages} />
          <CurrentCareers rows={rows.careers} messages={messages} />
        </div>
      </div>
    </div>
  );
}

export function EngineerProposalSections({ history, diff, messages }: EngineerProposalSectionsProps) {
  return (
    <>
      <DetailSection id="proposals" title={messages.sectionProposals}>
        {history.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="engineer-detail-proposals-empty">
            {messages.proposalsEmpty}
          </p>
        ) : (
          <Table data-testid="engineer-detail-proposals-table">
            <TableHeader>
              <TableRow>
                <TableHead>{messages.columnRecipient}</TableHead>
                <TableHead>{messages.columnProject}</TableHead>
                <TableHead>{messages.columnState}</TableHead>
                <TableHead>{messages.columnCreatedAt}</TableHead>
                <TableHead>{messages.columnActions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((row) => (
                <TableRow
                  key={row.id}
                  align="top"
                  data-testid={`engineer-proposal-row-${row.id}`}
                  data-state={row.state}
                  data-selected={row.selected ? 'true' : 'false'}
                >
                  <TableCell whitespace="normal">{row.recipient}</TableCell>
                  <TableCell whitespace="normal">{row.project}</TableCell>
                  <TableCell>
                    <Badge variant={TONE_VARIANTS[row.tone]}>{row.stateLabel}</Badge>
                  </TableCell>
                  <TableCell>{row.createdOn}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-3">
                      <Link className={SECONDARY_LINK_CLASSES} href={row.href} data-testid={`engineer-proposal-detail-link-${row.id}`}>
                        {messages.detailLink}
                      </Link>
                      {row.selected ? (
                        <span className="text-sm text-slate-500" data-testid={`engineer-proposal-diff-selected-${row.id}`}>
                          {messages.diffSelected}
                        </span>
                      ) : (
                        // 🔴 `prefetch={false}`: 差分の描画は `engineer.view`（SNAPSHOT_DIFF）を記録する。hover の先読みで描かせると
                        //    **見ていない閲覧**が記録に混ざる（docs/05 §6.4「#20 / #21 … 見ていない閲覧を混ぜない」と同じ判断）。
                        <Link
                          className={SECONDARY_LINK_CLASSES}
                          href={row.diffHref}
                          prefetch={false}
                          data-testid={`engineer-proposal-diff-link-${row.id}`}
                        >
                          {messages.diffLink}
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DetailSection>

      {/* 🔴 セクション 5 は提案がある場合だけ（docs/04 §S-006「凍結情報との差分（提案がある場合）」）。 */}
      {history.length === 0 ? null : (
        <DetailSection id="snapshot-diff" title={messages.sectionDiff}>
          {diff.kind === 'NONE' ? (
            <p className="text-sm text-slate-600" data-testid="engineer-snapshot-diff-lead">
              {messages.diffLead}
            </p>
          ) : diff.kind === 'UNAVAILABLE' ? (
            <p className="text-sm text-slate-600" data-testid="engineer-snapshot-diff-unavailable">
              {messages.diffUnavailable}
            </p>
          ) : (
            <SnapshotDiffView rows={diff.rows} messages={messages} />
          )}
        </DetailSection>
      )}
    </>
  );
}
