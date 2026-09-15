'use client';

// apps/web/app/(main)/proposal-requests/[id]/proposal-request-respond-screen.tsx
// `S-018` 提案依頼の詳細と応諾・辞退（取引先）— 本体（docs/04 §S-018 / `F-018` `F-019` / docs/05 §6.5 #33 / #34）。T-08-07。
//
// ============================================================================
// 🔴 この画面が守るもの（`docs/04` §S-018 / `F-018 AC-1` `AC-3` / `BR-57` / `CLAUDE.md` §13.3）
// ============================================================================
//   ① 🔴 **判断材料を隠さない。** 案件名 / 必須・尚可要件 / 単価レンジ / 開始日 / 勤務地 / 依頼メッセージ / 返答期限 /
//      **応諾で開示される項目**を、モバイルでも同じ画面に出す（T1。折りたたまない）。
//   ② 🔴 **開示が起きる瞬間を明示する**（`F-018 AC-3`）。応諾は確認 1 段で、開示される 3 項目を列挙してから確定する。
//   ③ 🔴 **辞退の自由**（`BR-57`）。理由は任意で、入力欄の直下に「ホストには開示されません」を置く。
//      応諾を primary にしても辞退を目立たなくしない（同じ操作行に置く）。
//   ④ 🔴 **案件が公開されていなければ応諾の導線を描かない**（`rows.canAccept`。API 側も 422 で止める）。
//      辞退はできる。自動公開はしない（経路 1 のゲート対象）。
//   ⑤ 状態が `REQUESTED` でなければ操作を描かず、専用の文言を出す（`docs/04` §10.1 `S-018`）。
//      応諾・辞退の 422（競合）は「既に返答待ちではない」と伝え、再読込を促す。
//   ⑥ ⚠️ 応諾後の遷移先 `S-020` は SP-09。それまでは下書きの ID を示して `S-017` へ戻す。
//
// 🔴 `'use client'` は確認ステップ・辞退フォーム・毎分の残り時間のためだけである。**`@ses/db` に依存する
//    モジュールから値を import しない**（`tests/static/client-db-boundary.test.ts`）。文言は props で受け取る。
// 🔴 応諾・辞退の成功後は手元で行を書き換えず、`phase` を `ACCEPTED` / `DECLINED` に切り替えて結果の枠
//    （下書き ID / 辞退の完了）と `S-017` へ戻る導線だけを描く（再読込はしない）。
//    再訪時の表示はサーバの状態（`readPartnerProposalRequestDetail`）だけが正である。
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { Badge, Button, Field, SECONDARY_LINK_CLASSES, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea, type BadgeVariant } from '@ses/ui';
import type { ProposalRequestState } from '@ses/domain';
import type { ProposalRequestDetailRows } from '../../../../lib/proposal-requests/detail-rows';
import type { ProjectRequirementRow } from '../../../../lib/projects/detail';
import { PROPOSAL_REQUEST_DECLINE_REASON_MAX_LENGTH } from '../../../../lib/proposal-requests/limits';
import { formatRemaining, type RemainingLabels } from '../../../../lib/proposal-requests/remaining';

export type ProposalRequestRespondScreenMessages = {
  readonly backToList: string;
  readonly sectionRequest: string;
  readonly sectionEngineer: string;
  readonly sectionDisclosure: string;
  readonly sectionActions: string;
  readonly fieldProject: string;
  readonly fieldMessage: string;
  readonly fieldExpiresAt: string;
  readonly fieldCreatedAt: string;
  readonly fieldRespondedAt: string;
  readonly requirementsMust: string;
  readonly requirementsNice: string;
  readonly requirementsEmpty: string;
  readonly requirementColumnRequirement: string;
  readonly requirementColumnYears: string;
  readonly openProject: string;
  readonly openEngineer: string;
  readonly engineerMissing: string;
  readonly projectNotShared: string;
  readonly disclosureLead: string;
  readonly disclosureItems: readonly string[];
  readonly accept: string;
  readonly acceptConfirmTitle: string;
  readonly acceptConfirmLead: string;
  readonly acceptConfirmSubmit: string;
  readonly acceptConfirmCancel: string;
  readonly acceptSubmitting: string;
  readonly acceptDone: string;
  readonly acceptDoneProposalId: string;
  readonly acceptDoneNext: string;
  readonly decline: string;
  readonly declineReasonLabel: string;
  readonly declineReasonNote: string;
  readonly declineSubmit: string;
  readonly declineCancel: string;
  readonly declineSubmitting: string;
  readonly declineDone: string;
  readonly declineRecordedReason: string;
  readonly declineRecordedReasonNone: string;
  readonly errorState: string;
  readonly errorProjectNotShared: string;
  readonly errorGeneric: string;
  readonly viewerNotice: string;
  readonly deniedTitle: string;
  readonly remaining: RemainingLabels;
  readonly remainingNone: string;
  readonly valueNone: string;
};

export type ProposalRequestRespondScreenProps = {
  readonly rows: ProposalRequestDetailRows;
  /** 🔴 応諾・辞退を行えるロールか（`PROPOSAL_REQUEST_RESPONDER_ROLES`）。`VIEWER` は `false`。 */
  readonly canRespond: boolean;
  /** 🔴 実行系を止めている理由（`F-004 AC-7`）。`null` なら実行可。拒否の本体は #33 / #34 の `requireExecutable`。 */
  readonly denialMessage: string | null;
  /** サーバのリクエスト時刻（epoch ms）。初回描画の残り時間に使う。 */
  readonly nowMs: number;
  readonly messages: ProposalRequestRespondScreenMessages;
};

/** 状態バッジの色（`S-017` と同じ割り当て。`Record` で漏れをコンパイラに強制させる）。 */
const STATE_BADGE_VARIANTS = {
  REQUESTED: 'warning',
  ACCEPTED: 'success',
  DECLINED: 'neutral',
  WITHDRAWN_BY_HOST: 'outline',
  EXPIRED: 'danger',
} as const satisfies Record<ProposalRequestState, BadgeVariant>;

const REMAINING_TICK_MS = 60_000;

type Phase =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'CONFIRM_ACCEPT' }
  | { readonly kind: 'DECLINING' }
  | { readonly kind: 'SUBMITTING'; readonly action: 'ACCEPT' | 'DECLINE' }
  | { readonly kind: 'ACCEPTED'; readonly proposalId: string }
  | { readonly kind: 'DECLINED' };

function Section({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="border border-slate-200 bg-white" data-testid={`proposal-request-respond-${id}`}>
      <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">{title}</h2>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function DetailRow({ label, value, field }: { readonly label: string; readonly value: string; readonly field: string }) {
  return (
    <div className="flex gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
      <dd className="m-0 break-words text-slate-900" data-field={field}>
        {value}
      </dd>
    </div>
  );
}

function RequirementTable({
  id,
  title,
  rows,
  messages,
}: {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly ProjectRequirementRow[];
  readonly messages: ProposalRequestRespondScreenMessages;
}) {
  return (
    <div className="mb-3" data-testid={`proposal-request-respond-requirements-${id}`}>
      <h3 className="mb-1 text-sm font-semibold text-slate-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-slate-600">{messages.requirementsEmpty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{messages.requirementColumnRequirement}</TableHead>
              <TableHead>{messages.requirementColumnYears}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell whitespace="normal">{row.requirement}</TableCell>
                <TableCell>{row.years}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function ProposalRequestRespondScreen({ rows, canRespond, denialMessage, nowMs, messages }: ProposalRequestRespondScreenProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'IDLE' });
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  // 🔴 初回はサーバの時刻（props）。mount 後に端末時刻へ切り替え、以後 1 分ごとに進める（`S-017` と同じ 1 関数）。
  const [now, setNow] = useState(nowMs);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), REMAINING_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const canExecute = canRespond && denialMessage === null;
  const submitting = phase.kind === 'SUBMITTING';
  const remaining = rows.state === 'REQUESTED' ? formatRemaining(rows.expiresAtIso, now, messages.remaining) : messages.remainingNone;

  function errorFor(status: number): string {
    // 🔴 応答コードで文言を選ぶ（本文の `messageKey` を UI で解釈しない。`candidate-screen.tsx` と同じ形）。
    //    422 のうち「案件が公開されていない」と「遷移表に無い」は本文の `code` で分ける必要があるが、
    //    前者は導線そのものを描かないので通常は到達しない —— 到達したら状態の説明に倒す（安全側）。
    return status === 422 ? messages.errorState : messages.errorGeneric;
  }

  async function accept(): Promise<void> {
    if (submitting || !canExecute || !rows.canAccept) return;
    setError(null);
    setPhase({ kind: 'SUBMITTING', action: 'ACCEPT' });
    try {
      // 🔴 body を送らない（#33 は提案先を決められる主体を持たない。docs/05 §6.5「T-08-07 の決着」）。
      const response = await fetch(`/api/proposal-requests/${rows.id}/accept`, { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
        setError(
          body?.error?.code === 'PROPOSAL_REQUEST_PROJECT_NOT_SHARED' ? messages.errorProjectNotShared : errorFor(response.status),
        );
        setPhase({ kind: 'IDLE' });
        return;
      }
      const body = (await response.json()) as { proposalId: string };
      setPhase({ kind: 'ACCEPTED', proposalId: body.proposalId });
    } catch {
      setError(messages.errorGeneric);
      setPhase({ kind: 'IDLE' });
    }
  }

  async function decline(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !canExecute || !rows.canDecline) return;
    setError(null);
    setPhase({ kind: 'SUBMITTING', action: 'DECLINE' });
    try {
      const response = await fetch(`/api/proposal-requests/${rows.id}/decline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        setError(errorFor(response.status));
        setPhase({ kind: 'DECLINING' });
        return;
      }
      setPhase({ kind: 'DECLINED' });
    } catch {
      setError(messages.errorGeneric);
      setPhase({ kind: 'DECLINING' });
    }
  }

  return (
    <div data-testid="proposal-request-respond-screen" data-request-state={rows.state}>
      {/* 🔴 状態と期限を最初に出す（`docs/04` §9「S-018 で最も強調するのは返答期限」）。 */}
      <div className="mb-4 flex flex-wrap items-center gap-3" data-testid="proposal-request-respond-header">
        <Badge variant={STATE_BADGE_VARIANTS[rows.state]} data-testid="proposal-request-respond-state">
          {rows.stateLabel}
        </Badge>
        <p className="m-0 text-base font-bold text-slate-900" data-testid="proposal-request-respond-remaining">
          {messages.fieldExpiresAt}: {rows.expiresAt}（{remaining}）
        </p>
      </div>

      {rows.closedNotice === null ? null : (
        <p role="status" className="mb-4 border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700" data-testid="proposal-request-respond-closed">
          {rows.closedNotice}
        </p>
      )}

      {canRespond && denialMessage !== null ? (
        <div role="alert" className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="proposal-request-respond-denied">
          <p className="font-bold">{messages.deniedTitle}</p>
          <p>{denialMessage}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4">
        {/* セクション 1: 依頼の内容（案件の判断材料 + 依頼メッセージ + 期限） */}
        <Section id="request" title={messages.sectionRequest}>
          {rows.project === null ? (
            <div className="mb-3">
              <p className="mb-2 text-sm text-slate-900" data-testid="proposal-request-respond-project-name">
                {messages.fieldProject}: {messages.valueNone}
              </p>
              {/* 🔴 案件が公開されていない ＝ 応諾できない事実を明示する（隠さない。辞退は可能）。 */}
              <p role="status" className="m-0 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="proposal-request-respond-project-not-shared">
                {messages.projectNotShared}
              </p>
            </div>
          ) : (
            <div className="mb-3" data-testid="proposal-request-respond-project">
              <p className="mb-2 text-base font-semibold text-slate-900" data-testid="proposal-request-respond-project-name">
                {rows.project.name}
              </p>
              <dl className="mb-3 text-sm" data-testid="proposal-request-respond-project-headline">
                {rows.project.headline.map((row) => (
                  <DetailRow key={row.key} label={row.label} value={row.value} field={row.key} />
                ))}
                {rows.project.conditions.map((row) => (
                  <DetailRow key={row.key} label={row.label} value={row.value} field={row.key} />
                ))}
              </dl>
              {/* 🔴 必須要件が多くても折りたたまない（`docs/04` §11「要件は判断材料であり折りたたまない」）。 */}
              <RequirementTable id="MUST" title={messages.requirementsMust} rows={rows.project.mustRequirements} messages={messages} />
              <RequirementTable id="NICE" title={messages.requirementsNice} rows={rows.project.niceRequirements} messages={messages} />
              <Link className={SECONDARY_LINK_CLASSES} href={rows.project.href} data-testid="proposal-request-respond-open-project">
                {messages.openProject}
              </Link>
            </div>
          )}
          <dl className="text-sm">
            <DetailRow label={messages.fieldMessage} value={rows.message} field="message" />
            <DetailRow label={messages.fieldExpiresAt} value={`${rows.expiresAt}（${remaining}）`} field="expires-at" />
            <DetailRow label={messages.fieldCreatedAt} value={rows.createdAt} field="created-at" />
            {rows.respondedAt === null ? null : <DetailRow label={messages.fieldRespondedAt} value={rows.respondedAt} field="responded-at" />}
          </dl>
        </Section>

        {/* セクション 2: 対象の自社エンジニア（実名。自社の情報） */}
        <Section id="engineer" title={messages.sectionEngineer}>
          {rows.engineer === null ? (
            <p className="m-0 text-sm text-slate-700" data-testid="proposal-request-respond-engineer-missing">
              {messages.engineerMissing}
            </p>
          ) : (
            <div>
              <p className="mb-2 text-base font-semibold text-slate-900" data-testid="proposal-request-respond-engineer-name">
                {rows.engineer.displayName}
              </p>
              <Link className={SECONDARY_LINK_CLASSES} href={rows.engineer.href} data-testid="proposal-request-respond-open-engineer">
                {messages.openEngineer}
              </Link>
            </div>
          )}
        </Section>

        {/* セクション 3: 応諾するとどうなるかの説明（`F-018 AC-3`。モバイルでも省略しない） */}
        <Section id="disclosure" title={messages.sectionDisclosure}>
          <p className="mb-2 text-sm text-slate-900" data-testid="proposal-request-respond-disclosure-lead">
            {messages.disclosureLead}
          </p>
          <ul className="m-0 list-disc pl-5 text-sm text-slate-900" data-testid="proposal-request-respond-disclosure-items">
            {messages.disclosureItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>

        {/* セクション 4: 応諾 / 辞退の操作 */}
        <Section id="actions" title={messages.sectionActions}>
          {phase.kind === 'ACCEPTED' ? (
            <div role="status" className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-testid="proposal-request-respond-accepted">
              <p className="mb-1 font-bold">{messages.acceptDone}</p>
              <p className="mb-1">
                {messages.acceptDoneProposalId}: <span data-testid="proposal-request-respond-accepted-proposal-id">{phase.proposalId}</span>
              </p>
              <p className="mb-2">{messages.acceptDoneNext}</p>
              <Link className={SECONDARY_LINK_CLASSES} href={rows.listHref} data-testid="proposal-request-respond-back-to-list">
                {messages.backToList}
              </Link>
            </div>
          ) : phase.kind === 'DECLINED' ? (
            <div role="status" className="border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900" data-testid="proposal-request-respond-declined">
              <p className="mb-2 font-bold">{messages.declineDone}</p>
              <Link className={SECONDARY_LINK_CLASSES} href={rows.listHref} data-testid="proposal-request-respond-back-to-list">
                {messages.backToList}
              </Link>
            </div>
          ) : rows.state === 'DECLINED' ? (
            // 🔴 辞退済み: 自社の記録として理由を再表示する（ホストには存在しない情報。`F-018 AC-1`）。
            <div data-testid="proposal-request-respond-recorded-reason">
              <p className="mb-1 text-sm text-slate-500">{messages.declineRecordedReason}</p>
              <p className="m-0 text-sm text-slate-900 break-words" data-testid="proposal-request-respond-recorded-reason-value">
                {rows.declineReason ?? messages.declineRecordedReasonNone}
              </p>
            </div>
          ) : rows.state === 'ACCEPTED' ? (
            <div data-testid="proposal-request-respond-accepted-before">
              <p className="mb-1 text-sm text-slate-500">{messages.acceptDoneProposalId}</p>
              <p className="m-0 text-sm text-slate-900" data-testid="proposal-request-respond-accepted-proposal-id">
                {rows.proposalId ?? messages.valueNone}
              </p>
            </div>
          ) : rows.state !== 'REQUESTED' ? (
            // 期限切れ / 取り下げ: 操作なし（専用文言は上部の `closedNotice`）。
            <p className="m-0 text-sm text-slate-600" data-testid="proposal-request-respond-no-actions">
              {messages.remainingNone}
            </p>
          ) : !canRespond ? (
            <p className="m-0 text-sm text-slate-600" data-testid="proposal-request-respond-viewer">
              {messages.viewerNotice}
            </p>
          ) : phase.kind === 'CONFIRM_ACCEPT' ? (
            // 🔴 確認ステップ: 開示される項目を列挙してから確定する（`docs/04` §S-018「操作と結果」）。
            <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="proposal-request-respond-accept-confirm">
              <p className="font-bold">{messages.acceptConfirmTitle}</p>
              <ul className="my-2 list-disc pl-5" data-testid="proposal-request-respond-accept-confirm-items">
                {messages.disclosureItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p>{messages.acceptConfirmLead}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <Button type="button" disabled={submitting} onClick={() => void accept()} data-testid="proposal-request-respond-accept-submit">
                  {messages.acceptConfirmSubmit}
                </Button>
                <button type="button" className={SECONDARY_LINK_CLASSES} disabled={submitting} onClick={() => setPhase({ kind: 'IDLE' })} data-testid="proposal-request-respond-accept-cancel">
                  {messages.acceptConfirmCancel}
                </button>
              </div>
            </div>
          ) : phase.kind === 'DECLINING' || (phase.kind === 'SUBMITTING' && phase.action === 'DECLINE') ? (
            <form className="border border-slate-200 bg-slate-50 p-3" onSubmit={decline} data-testid="proposal-request-respond-decline-form">
              {/* 🔴 理由は任意（`BR-57`）。非開示を入力欄の直下に明記する（`F-018 AC-1`）。 */}
              <Field label={messages.declineReasonLabel} description={messages.declineReasonNote} className="mb-3">
                <Textarea
                  name="reason"
                  rows={3}
                  maxLength={PROPOSAL_REQUEST_DECLINE_REASON_MAX_LENGTH}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={submitting}
                  data-testid="proposal-request-respond-decline-reason"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-4">
                <Button type="submit" variant="secondary" disabled={submitting} data-testid="proposal-request-respond-decline-submit">
                  {submitting ? messages.declineSubmitting : messages.declineSubmit}
                </Button>
                <button type="button" className={SECONDARY_LINK_CLASSES} disabled={submitting} onClick={() => setPhase({ kind: 'IDLE' })} data-testid="proposal-request-respond-decline-cancel">
                  {messages.declineCancel}
                </button>
              </div>
            </form>
          ) : phase.kind === 'SUBMITTING' ? (
            <p role="status" className="m-0 text-sm text-slate-700" data-testid="proposal-request-respond-submitting">
              {messages.acceptSubmitting}
            </p>
          ) : (
            // 🔴 応諾と辞退を同じ操作行に置く（辞退を目立たなくしない。`docs/04` §S-018「なぜこの構成か」）。
            <div className="flex flex-wrap items-center gap-4" data-testid="proposal-request-respond-actions-row">
              {rows.canAccept && canExecute ? (
                <Button type="button" onClick={() => setPhase({ kind: 'CONFIRM_ACCEPT' })} data-testid="proposal-request-respond-accept">
                  {messages.accept}
                </Button>
              ) : null}
              {rows.canDecline && canExecute ? (
                <Button type="button" variant="secondary" onClick={() => setPhase({ kind: 'DECLINING' })} data-testid="proposal-request-respond-decline">
                  {messages.decline}
                </Button>
              ) : null}
            </div>
          )}

          {error === null ? null : (
            <p role="alert" className="mt-3 mb-0 text-sm text-red-700" data-testid="proposal-request-respond-error">
              {error}
            </p>
          )}
        </Section>
      </div>

      <Link className={`${SECONDARY_LINK_CLASSES} mt-4`} href={rows.listHref} data-testid="proposal-request-respond-back">
        {messages.backToList}
      </Link>
    </div>
  );
}
