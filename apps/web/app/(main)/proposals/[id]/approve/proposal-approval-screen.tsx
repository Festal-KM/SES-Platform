'use client';

// apps/web/app/(main)/proposals/[id]/approve/proposal-approval-screen.tsx
// `S-021` 提案の承認 — 本体（docs/04 §S-021 / §6.1 / `F-021` `F-020` / docs/05 §6.5 #41 / #42 / §11.5 / §11.7）。
// T-09-03。🔴 **Tier 1（モバイル完結）。**
//
// ============================================================================
// 🔴 この画面が守るもの（`F-021 AC-4` / `AC-6` / `BR-49` / `BR-50` / `CLAUDE.md` §13.3）
// ============================================================================
//   ① 🔴 **判断材料（判断ヘッダ = 提案先・エンジニア・案件・単価・開始日・作成者・経過時間 / ゲートの指摘 / 整合層の警告 /
//      送信先別プレビュー）を同一画面に置き、これらを表示しないまま承認する導線を作らない。** モバイルでも同じ ——
//      タブでもアコーディオンでもなく **1 本の縦スクロール**。判断ヘッダは折りたたまず、ゲート結果を折りたたみの中に入れない。
//   ② 🔴 **アクションはプレビューの末尾まで到達するまで有効にならない**（`docs/04` §S-021 デバイス別 / §6.1）。
//      末尾の目印（`proposal-approval-preview-end`）が画面に入ったことを `IntersectionObserver` で観測する。
//      観測前（描画直後・JS 無効・`renderToStaticMarkup`）は**常に無効**であり、押せない理由を隣に明示する。
//   ③ 🔴 **「不合格」と「警告」を視覚的に別物として描く**（`docs/02` `ui-design` 申し送り 5）。不合格は層のブロック全体を
//      FAIL 表示 + 赤の指摘リスト、警告は琥珀の**別リスト**に「警告」ラベル付きで併記し、**警告のみでは承認を止めない**。
//   ④ 🔴 **`APPROVAL_PENDING` 以外の状態では承認アクションを描画しない**（`docs/04` §S-021「承認ゲートを迂回できない設計」①）。
//      `GATE_FAILED` では「検査で不合格のため承認できません」+ 指摘の一覧だけ。**ゲート FAIL を無視する操作・設定は無い**（②③）。
//   ⑤ 🔴 **一括承認に相当する操作を持たない**（本画面は 1 件の承認。一括は `S-019` の範囲で、モバイルでは既定の操作にしない。`BR-50`）。
//   ⑥ 承認は body を送らない（#41 はゲート結果を引数に取らない）。却下は理由必須（#42）。
//   ⑦ 承認・却下の成功後は手元で状態を書き換えず、結果の枠を出して `router.refresh()` する（サーバの状態が正）。
//   ⑧ 🔴 T-09-06: 承認後の primary は「送信する」（#43。docs/05 §6.5 #43 / §10.2 / §10.4 / §10.5）。**押した瞬間に「送信済み」と
//      見せない** —— 202 は「受け付けた」であり、`SUBMITTING` に入れるのも `SUBMITTED` / `SUBMIT_FAILED` に確定するのも送信ジョブ
//      である。受け付け後は「送信中」を出し、#46（`GET /api/proposals/{id}`。T-09-09）で状態を監視して変化があればサーバコンポーネントを読み直し、確定・保留を反映する。
//      送信の保留（`sendHoldReasonKey`）は理由ごとの文言と設定導線で描き、🔴 `PROVIDER_QUOTA` には `S-038` への導線を出さない。
//      `GATE_STALE` だけは自動復帰しないので「送信する」を再び選べる（§10.5）。Tier 1 のまま（モバイルで完結する）。
//   ⑨ 🔴 T-12-13 ⑤（SP-09 T-09-11 ①-① の申し送り）: #46 の読み直しは「送信する」を押した直後（`SUBMIT_REQUESTED`）と `SUBMITTING` の間
//      だけでなく、**`APPROVED` で送信の確定を待っている間**（`rows.awaitingSendSettlement` = 試行の末尾が `RESERVED`）**と保留中
//      （`sendHold` が非 null）**にも走らせる（`shouldPollSendSettlement`。根の `data-send-polling`）。#44 の 202 の後に遷移してきた
//      `S-021` が `APPROVED` のまま止まり、読み直すまで「送信する」が押せる状態に見える、を無くす —— #44 の受け付け直後（③ CAS の前で
//      試行の行がまだ無い窓）は `S-022` がセッションに残した印（`lib/proposals/submit-intent.ts`）をマウント時に消費して、#43 と同じ
//      `SUBMIT_REQUESTED`（セッション限定の枠）に入る。🔴 **DB の `last_failure_reason` を「送信中」の根拠にしない**（レビュー指摘。
//      2026-09-18）: #44 の CAS が残すこの列は enqueue が 409 `SEND_JOB_BLOCKED` で止まった行 / ジョブが ③ CAS より前に落ちた行でも
//      非 null のままで、それを「送信中」と断定すると「送信する」が二度と描かれない行き止まりになる。リロードで枠が消えて
//      「送信する」が戻るのは #43 と同じ既定挙動（押しても同じ `attemptSeq` で 1 本に畳まれる）。🔴 **確定を待つ間は「送信する」を
//      描かず**「送信を受け付けました。送信中です」を出す（押せる表示そのものを出さない）。確定後（`SUBMITTED` / `SUBMIT_FAILED`）は
//      従来どおり描かない。
//   ⑩ 🔴 T-12-13 ⑥（同 ①-②）: 根の `data-can-approve` は**立場**の表明で状態を含まない（`GATE_FAILED` でも `true`）。属性名から状態の可否と
//      誤読しないよう、「この瞬間に #41 を呼べるか」（立場 × `APPROVAL_PENDING` × 実行可 × 末尾の確認済み × 要求中 / 確定後でない）を
//      **`data-can-approve-now`** に別に出す（`canApproveNow`。承認ボタンの `disabled` と同じ 1 つの判定）。既存の属性・testid は変えない。
//
// 🔴 `'use client'` は末尾の観測・承認/却下フォーム・#40 のポーリングのためだけである。**`@ses/db` に依存する
//    モジュールから値を import しない**（`tests/static/client-db-boundary.test.ts`）。文言と表示値は props で受け取る。
// 🔴 応答の `messageKey` を UI で解釈しない。文言は応答コード（`error.code`）と HTTP 状態で選ぶ。
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Field, SECONDARY_LINK_CLASSES, Textarea, type BadgeVariant } from '@ses/ui';
import type { GateLayerState, GateResultView, ProposalState } from '@ses/domain';
import type { ApprovalGateFindingRow, ApprovalHighlight, ProposalApprovalRows } from '../../../../../lib/proposals/approval-rows';
import type { ProposalSendingDomainRows } from '../../../../../lib/proposals/editor-rows';
import { consumeSubmitRequested } from '../../../../../lib/proposals/submit-intent';

export type ProposalApprovalScreenMessages = {
  readonly sectionHeader: string;
  readonly sectionGate: string;
  readonly sectionPreview: string;
  readonly sectionAttachment: string;
  readonly sectionSendingDomain: string;
  readonly sectionActions: string;
  readonly fieldState: string;
  readonly fieldApprover: string;
  readonly gateRunning: string;
  readonly gateHeld: string;
  readonly gateHeldResetAtPrefix: string;
  readonly gateAiFailed: string;
  readonly gateFindingsTitle: string;
  readonly gateFindingsEmpty: string;
  readonly gateWarningsTitle: string;
  readonly gateWarningsEmpty: string;
  readonly gateWarningLabel: string;
  readonly gateWarningsNote: string;
  readonly gateNotRequested: string;
  readonly previewLead: string;
  readonly previewSubject: string;
  readonly previewBody: string;
  readonly previewSubjectEmpty: string;
  readonly previewBodyEmpty: string;
  readonly previewAttachmentLabel: string;
  readonly previewAttachmentNone: string;
  readonly previewHighlightBlock: string;
  readonly previewHighlightWarn: string;
  readonly previewEnd: string;
  readonly attachmentViewNote: string;
  readonly sendingDomainUnverifiedNote: string;
  readonly auditLink: string;
  readonly approve: string;
  readonly approving: string;
  readonly approved: string;
  readonly submit: string;
  readonly submitting: string;
  readonly submitRequested: string;
  readonly submitLead: string;
  readonly submitScrollRequired: string;
  readonly errorSubmitState: string;
  readonly errorSendBlocked: string;
  readonly reject: string;
  readonly rejectReasonLabel: string;
  readonly rejectSubmit: string;
  readonly rejecting: string;
  readonly rejected: string;
  readonly rejectCancel: string;
  readonly scrollRequired: string;
  readonly openEditor: string;
  readonly backHome: string;
  /** 🔴 T-09-08: `SUBMIT_FAILED` のときだけ描く `S-022` への導線の文言。 */
  readonly openSendFailures: string;
  readonly viewerNotice: string;
  readonly deniedTitle: string;
  readonly errorValidation: string;
  readonly errorStale: string;
  readonly errorState: string;
  readonly errorForbidden: string;
  readonly errorGeneric: string;
};

export type ProposalApprovalScreenProps = {
  readonly proposalId: string;
  readonly rows: ProposalApprovalRows;
  /** 🔴 実行系を止めている理由（`F-004 AC-7`）。`null` なら実行可。拒否の本体は API のガード。 */
  readonly denialMessage: string | null;
  readonly sendingDomain: ProposalSendingDomainRows;
  /** 監査ログ（`S-041`）への導線。`OWNER` / `ADMIN` 以外は `null`。 */
  readonly auditHref: string | null;
  readonly homeHref: string;
  /**
   * 🔴 T-09-08: `S-022`（送信失敗一覧）への導線。ホストだけ（取引先は `S-022` に到達しない）。
   *    描くのは `disposition.kind === 'SUBMIT_FAILED'` のときだけ（`docs/04` §S-021「送信失敗 → `S-022` への導線」）。
   */
  readonly sendFailuresHref: string | null;
  readonly messages: ProposalApprovalScreenMessages;
};

/** 状態バッジの色。`Record` で 14 状態の漏れをコンパイラに強制させる（`S-020` と同じ）。 */
const STATE_BADGE_VARIANTS = {
  DRAFT: 'neutral',
  GATE_RUNNING: 'warning',
  GATE_FAILED: 'danger',
  APPROVAL_PENDING: 'warning',
  APPROVED: 'success',
  SUBMITTING: 'warning',
  SUBMITTED: 'success',
  SUBMIT_FAILED: 'danger',
  INTERVIEW_SCHEDULED: 'outline',
  INTERVIEWED: 'outline',
  RESULT_PENDING: 'outline',
  WON: 'success',
  LOST: 'neutral',
  WITHDRAWN: 'neutral',
} as const satisfies Record<ProposalState, BadgeVariant>;

const LAYER_BADGE_VARIANTS = {
  RUNNING: 'warning',
  PASS: 'success',
  FAIL: 'danger',
  HELD: 'warning',
} as const satisfies Record<GateLayerState, BadgeVariant>;

/** #40 のポーリング間隔（`S-020` と同じ 5 秒）。 */
const GATE_POLL_MS = 5_000;
/** 🔴 T-09-06: 送信の確定を待つ間の読み直し間隔（#46 の `GET`。送信は数秒で確定する）。 */
const SEND_POLL_MS = 3_000;

/** #46 の応答のうちポーリングが読む 2 つ（`HostProposalDetailView` / `PartnerProposalDetailView` の共通部 + ホストの `sendHold`）。 */
type ProposalDetailPollBody = {
  readonly state?: ProposalState;
  readonly sendHold?: { readonly reasonKey?: string } | null;
};

/**
 * 🔴 T-09-09: #46（`GET /api/proposals/{id}`）を `SEND_POLL_MS` ごとに読み、`state` か保留理由が `expected` と食い違ったら
 *    `onChanged`（= `router.refresh()`）を 1 回呼んで止まる。読めない間（ネットワーク / 5xx）は次の周期で読み直す。
 *    戻り値は停止関数（`useEffect` のクリーンアップに渡す）。
 */
function pollProposalUntilChanged(
  proposalId: string,
  expected: { readonly state: ProposalState; readonly holdReasonKey: string | null },
  onChanged: () => void,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  async function poll(): Promise<void> {
    try {
      const response = await fetch(`/api/proposals/${proposalId}`, { cache: 'no-store' });
      if (cancelled) return;
      if (response.ok) {
        const body = (await response.json()) as ProposalDetailPollBody;
        if (cancelled) return;
        const holdReasonKey = body.sendHold?.reasonKey ?? null;
        if (body.state !== expected.state || holdReasonKey !== expected.holdReasonKey) {
          onChanged();
          return;
        }
      }
    } catch {
      // 次の周期で読み直す。
    }
    if (!cancelled) timer = setTimeout(() => void poll(), SEND_POLL_MS);
  }
  timer = setTimeout(() => void poll(), SEND_POLL_MS);
  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
  };
}

type Phase =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'REJECT_FORM' }
  | { readonly kind: 'SUBMITTING'; readonly action: 'APPROVE' | 'REJECT' | 'SUBMIT' }
  | { readonly kind: 'APPROVED' }
  | { readonly kind: 'REJECTED' }
  /** 🔴 #43 が 202 を返した。**送信済みではない**（確定は送信ジョブ）。読み直しで状態が動くまでこの枠を出す。 */
  | { readonly kind: 'SUBMIT_REQUESTED' };

type ErrorBody = { readonly error?: { readonly code?: string } };

/**
 * 🔴 T-12-13 ⑥: 「この瞬間に #41 を呼べるか」（根の `data-can-approve-now`。承認・却下ボタンの `disabled` と同じ判定）。
 *    `data-can-approve`（= `rows.canApprove`）は立場の表明で状態を含まない（`GATE_FAILED` でも `true`）。ここは
 *    立場 × 状態 `APPROVAL_PENDING` × テナントが実行可 × プレビュー末尾の確認済み × 要求中 / 確定後でない、のすべて。
 *    🔴 純粋関数として export する: render テスト（`renderToStaticMarkup` では `IntersectionObserver` が走らず `reachedEnd` を真にできない）が
 *    「末尾確認済みなら真」をここで固定する。画面はこの 1 本しか使わない（判定を 2 箇所に書かない）。
 */
export function canApproveNow(input: {
  readonly canApprove: boolean;
  readonly dispositionKind: ProposalApprovalRows['disposition']['kind'];
  readonly denialMessage: string | null;
  readonly reachedEnd: boolean;
  readonly phaseKind: Phase['kind'];
}): boolean {
  if (!input.canApprove || input.dispositionKind !== 'PENDING' || input.denialMessage !== null) return false;
  if (input.phaseKind === 'APPROVED' || input.phaseKind === 'REJECTED' || input.phaseKind === 'SUBMITTING') return false;
  return input.reachedEnd;
}

/**
 * 🔴 T-12-13 ⑤: #46 を読み続けるか（根の `data-send-polling`）。
 *  - `SUBMIT_REQUESTED`（#43 の 202 の直後）で `APPROVED` かつ保留なし —— 従来（T-09-06）
 *  - `SUBMITTING` —— 従来（T-09-06）
 *  - 🔴 `APPROVED` で送信の確定を待っている（`awaitingSendSettlement` = 試行の末尾が `RESERVED`）
 *  - 🔴 `APPROVED` で保留中（`holdReasonKey` が非 null）—— `send.hold-release` の復帰（`SUBMITTING` へ）を拾う
 *  #44 の受け付け直後は `S-022` の印（`submit-intent.ts`）から `SUBMIT_REQUESTED` に入るので 1 つ目の条件に合流する。
 *  確定後（`SUBMITTED` / `SUBMIT_FAILED` / 終端）は読まない。
 */
export function shouldPollSendSettlement(input: {
  readonly phaseKind: Phase['kind'];
  readonly dispositionKind: ProposalApprovalRows['disposition']['kind'];
  readonly holdReasonKey: string | null;
  readonly awaitingSendSettlement: boolean;
}): boolean {
  if (input.dispositionKind === 'SUBMITTING') return true;
  if (input.dispositionKind !== 'APPROVED') return false;
  if (input.phaseKind === 'SUBMIT_REQUESTED' && input.holdReasonKey === null) return true;
  return input.awaitingSendSettlement || input.holdReasonKey !== null;
}

function Section({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="border border-slate-200 bg-white" data-testid={`proposal-approval-section-${id}`}>
      <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">{title}</h2>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

/**
 * 🔴 本文に指摘 / 警告の該当箇所を色付けして描く（docs/04 §S-021 セクション 4「含まれていればハイライトして警告」）。
 *    不合格（`BLOCK`）は赤、警告（`WARN`）は琥珀 —— **同じ色にしない**（③）。重なりは先勝ち（開始位置順）。
 */
function HighlightedText({
  text,
  highlights,
  messages,
}: {
  readonly text: string;
  readonly highlights: readonly ApprovalHighlight[];
  readonly messages: ProposalApprovalScreenMessages;
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  highlights.forEach((highlight, index) => {
    if (highlight.start < cursor || highlight.end > text.length) return;
    if (highlight.start > cursor) parts.push(text.slice(cursor, highlight.start));
    parts.push(
      <mark
        key={`${String(index)}-${String(highlight.start)}`}
        className={highlight.severity === 'BLOCK' ? 'bg-red-200 text-red-950' : 'bg-amber-200 text-amber-950'}
        data-testid={`proposal-approval-preview-highlight-${highlight.severity === 'BLOCK' ? 'block' : 'warn'}`}
        data-finding-kind={highlight.kind}
        title={highlight.severity === 'BLOCK' ? messages.previewHighlightBlock : messages.previewHighlightWarn}
      >
        {text.slice(highlight.start, highlight.end)}
      </mark>,
    );
    cursor = highlight.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function FindingList({
  id,
  title,
  emptyLabel,
  findings,
  severityLabel,
  tone,
}: {
  readonly id: 'findings' | 'warnings';
  readonly title: string;
  readonly emptyLabel: string;
  readonly findings: readonly ApprovalGateFindingRow[];
  /** 「警告」のラベル（不合格の指摘には付けない。視覚的に別物にする）。 */
  readonly severityLabel: string | null;
  readonly tone: 'danger' | 'warning';
}) {
  const frame = tone === 'danger' ? 'border-red-300 bg-red-50 text-red-950' : 'border-amber-300 bg-amber-50 text-amber-950';
  return (
    <div className={`mt-3 border px-3 py-2 ${frame}`} data-testid={`proposal-approval-gate-${id}`} data-tone={tone}>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {findings.length === 0 ? (
        <p className="m-0 text-sm">{emptyLabel}</p>
      ) : (
        <ul className="m-0 list-disc pl-5 text-sm">
          {findings.map((finding) => (
            <li key={finding.key} data-finding-kind={finding.kind}>
              {severityLabel === null ? null : (
                <Badge variant="outline" className="mr-2">
                  {severityLabel}
                </Badge>
              )}
              <span className="opacity-80">{finding.fieldLabel}: </span>
              <span className="break-words">{finding.excerpt}</span>
              {finding.locationNote === null ? null : <span className="ml-1 opacity-80">{finding.locationNote}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProposalApprovalScreen(props: ProposalApprovalScreenProps) {
  const { proposalId, rows, denialMessage, sendingDomain, auditHref, homeHref, sendFailuresHref, messages } = props;
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'IDLE' });
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  /** 🔴 ②: プレビューの末尾に到達したか。観測前は常に `false`（＝ 承認・却下は押せない）。 */
  const [reachedEnd, setReachedEnd] = useState(false);
  const endRef = useRef<HTMLParagraphElement | null>(null);

  const pending = rows.disposition.kind === 'PENDING';
  const canExecute = rows.canApprove && denialMessage === null;
  const submitting = phase.kind === 'SUBMITTING';
  const settled = phase.kind === 'APPROVED' || phase.kind === 'REJECTED';
  const actionable = pending && canExecute && !settled;
  // 🔴 ⑩: 承認・却下ボタンの `disabled` と根の `data-can-approve-now` は同じ 1 つの判定（`canApproveNow`）。
  const buttonsEnabled = canApproveNow({
    canApprove: rows.canApprove,
    dispositionKind: rows.disposition.kind,
    denialMessage,
    reachedEnd,
    phaseKind: phase.kind,
  });
  // 🔴 ⑨: 送信の確定を待っている間（#43 / #44 の受け付け直後 = `SUBMIT_REQUESTED` / 試行の末尾が未確定）は「送信する」を描かず、
  //    受け付けの枠を出す。押しても 1 本に畳まれるが、押せる表示そのものを出さない。
  const sendPending = phase.kind === 'SUBMIT_REQUESTED' || (rows.disposition.kind === 'APPROVED' && rows.awaitingSendSettlement);
  // 🔴 ⑧: 送信を要求できるのは「承認済み × 送信の立場 × テナントが実行可 × 保留が無いか自動復帰しない保留（GATE_STALE）× 確定待ちでない」。
  //    自動復帰する保留（ドメイン未検証 / 上限 / 環境の枠 / 停止）中は `send.hold-release` に任せ、ボタンを出さない。
  const holdBlocksSubmit = rows.sendHold !== null && rows.sendHold.autoRelease;
  const sendActionable =
    rows.disposition.kind === 'APPROVED' && rows.canSubmit && denialMessage === null && !holdBlocksSubmit && !sendPending;
  const sendButtonEnabled = sendActionable && reachedEnd && !submitting;

  useEffect(() => {
    if (!actionable && !sendActionable) return undefined;
    const target = endRef.current;
    if (target === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setReachedEnd(true);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [actionable, sendActionable]);

  // 🔴 ⑧: 送信の確定を待つ。受け付け直後（`SUBMIT_REQUESTED`）と `SUBMITTING` の間は 3 秒ごとに #46（`GET /api/proposals/{id}`。
  //    T-09-09）を読み、`state` か保留（`sendHold`）が props と食い違ったときだけサーバコンポーネントを読み直す
  //    （T-09-06 の申し送り 3: `router.refresh()` の定期実行から #46 の `GET` に置き換えた —— RSC の全再描画を 3 秒ごとに
  //    行わない）。確定（`SUBMITTED` / `SUBMIT_FAILED`）や保留は props に現れるので、それで受け付けの枠を閉じる。
  //    🔴 ⑨（T-12-13 ⑤）: 加えて、`APPROVED` で送信の確定を待っている間（`rows.awaitingSendSettlement`）と保留中（`sendHold`）も読む
  //    （`shouldPollSendSettlement` の 1 判定。根の `data-send-polling` と同じ値）。#44 の 202 の後に遷移してきた画面は `APPROVED` で
  //    描かれるが、この効果が `SUBMITTING` / `SUBMITTED` / `SUBMIT_FAILED` への確定を #46 の差分で拾って読み直す。
  const holdReasonKey = rows.sendHold?.reasonKey ?? null;
  const sendPolling = shouldPollSendSettlement({
    phaseKind: phase.kind,
    dispositionKind: rows.disposition.kind,
    holdReasonKey,
    awaitingSendSettlement: rows.awaitingSendSettlement,
  });
  // 🔴 ⑨（T-12-13 ⑤）: #44 の 202 の直後に `S-022` から遷移してきたか（セッションの印。マウント時に 1 回だけ消費する）。
  //    印があり、かつ行が `APPROVED` で保留なし（= 受け付け後・③ CAS 前の窓）なら #43 と同じ `SUBMIT_REQUESTED` に入り、
  //    下の効果が #46 を読んで `SUBMITTING` / 確定 / 保留で枠を閉じる。印はどの状態でも消費する（残さない）。
  //    DB の値（`last_failure_reason`）を根拠にしないのは、409 / failed job の行を恒久的に「送信中」と描かないため。
  useEffect(() => {
    if (!consumeSubmitRequested(() => window.sessionStorage, proposalId)) return;
    if (rows.disposition.kind === 'APPROVED' && rows.sendHold === null) setPhase({ kind: 'SUBMIT_REQUESTED' });
    // マウント時にだけ評価する（印は 1 回きり。以後の props の変化で再評価しても常に `false`）。
  }, [proposalId]);
  useEffect(() => {
    // #43 の受け付けの枠は、読み直しで確定・保留が props に現れたら閉じる（保留中の読み直しは下の `sendPolling` が引き継ぐ）。
    if (phase.kind === 'SUBMIT_REQUESTED' && (rows.disposition.kind !== 'APPROVED' || holdReasonKey !== null)) {
      setPhase({ kind: 'IDLE' });
      return undefined;
    }
    if (!sendPolling) return undefined;
    return pollProposalUntilChanged(proposalId, { state: rows.state, holdReasonKey }, () => router.refresh());
  }, [phase.kind, sendPolling, rows.disposition.kind, rows.state, holdReasonKey, proposalId, router]);

  // 🔴 ゲート結果（#40）: 検査中の間だけ 5 秒ごとに読み、確定したらサーバコンポーネントを読み直す。
  useEffect(() => {
    if (rows.disposition.kind !== 'GATE_RUNNING') return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function poll(): Promise<void> {
      try {
        const response = await fetch(`/api/proposals/${proposalId}/gate`, { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const result = (await response.json()) as GateResultView;
        if (cancelled) return;
        if (result.execution !== 'RUNNING') {
          router.refresh();
          return;
        }
        timer = setTimeout(() => void poll(), GATE_POLL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(() => void poll(), GATE_POLL_MS);
      }
    }
    timer = setTimeout(() => void poll(), GATE_POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [rows.disposition.kind, proposalId, router]);

  function errorFor(status: number, code: string | undefined): string {
    if (code === 'GATE_STALE') return messages.errorStale;
    if (code === 'SEND_JOB_BLOCKED') return messages.errorSendBlocked;
    if (code === 'INVALID_STATE_TRANSITION' || code === 'PROPOSAL_TRANSITION_RESERVED') return messages.errorState;
    if (status === 403) return messages.errorForbidden;
    if (status === 400) return messages.errorValidation;
    return messages.errorGeneric;
  }

  async function readErrorCode(response: Response): Promise<string | undefined> {
    const body = (await response.json().catch(() => null)) as ErrorBody | null;
    return body?.error?.code;
  }

  async function approve(): Promise<void> {
    if (!buttonsEnabled) return;
    setError(null);
    setPhase({ kind: 'SUBMITTING', action: 'APPROVE' });
    try {
      // 🔴 body を送らない（#41 はゲート結果を引数に取らない）。
      const response = await fetch(`/api/proposals/${proposalId}/approve`, { method: 'POST' });
      if (!response.ok) {
        setError(errorFor(response.status, await readErrorCode(response)));
        setPhase({ kind: 'IDLE' });
        return;
      }
      setPhase({ kind: 'APPROVED' });
      router.refresh();
    } catch {
      setError(messages.errorGeneric);
      setPhase({ kind: 'IDLE' });
    }
  }

  async function submit(): Promise<void> {
    if (!sendButtonEnabled) return;
    setError(null);
    setPhase({ kind: 'SUBMITTING', action: 'SUBMIT' });
    try {
      // 🔴 body を送らない（#43 は宛先・本文・添付を引数に取らない。送るものは行の値だけ）。
      const response = await fetch(`/api/proposals/${proposalId}/submit`, { method: 'POST' });
      if (!response.ok) {
        const code = await readErrorCode(response);
        setError(code === 'INVALID_STATE_TRANSITION' ? messages.errorSubmitState : errorFor(response.status, code));
        setPhase({ kind: 'IDLE' });
        return;
      }
      // 🔴 202 = 受け付け。送信済みと見せない。確定・保留はサーバを読み直して反映する。
      setPhase({ kind: 'SUBMIT_REQUESTED' });
      router.refresh();
    } catch {
      setError(messages.errorGeneric);
      setPhase({ kind: 'IDLE' });
    }
  }

  async function reject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // 🔴 ⑩: 承認と同じ 1 つの判定（`canApproveNow`）。前提を 2 箇所に書かない。
    if (!buttonsEnabled) return;
    if (reason.trim().length === 0) {
      setError(messages.errorValidation);
      return;
    }
    setError(null);
    setPhase({ kind: 'SUBMITTING', action: 'REJECT' });
    try {
      const response = await fetch(`/api/proposals/${proposalId}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!response.ok) {
        setError(errorFor(response.status, await readErrorCode(response)));
        setPhase({ kind: 'REJECT_FORM' });
        return;
      }
      setPhase({ kind: 'REJECTED' });
      router.refresh();
    } catch {
      setError(messages.errorGeneric);
      setPhase({ kind: 'REJECT_FORM' });
    }
  }

  const gate = rows.gate;

  return (
    <div
      className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      data-testid="proposal-approval"
      data-proposal-state={rows.state}
      data-can-approve={rows.canApprove ? 'true' : 'false'}
      data-can-approve-now={buttonsEnabled ? 'true' : 'false'}
      data-can-submit={rows.canSubmit ? 'true' : 'false'}
      data-send-hold={rows.sendHold?.reasonKey ?? ''}
      data-send-polling={sendPolling ? 'true' : 'false'}
      data-reached-end={reachedEnd ? 'true' : 'false'}
    >
      {/* 左（モバイルでは上）: 判断ヘッダ + ゲート結果 */}
      <div className="grid grid-cols-1 gap-4">
        {/* 🔴 セクション 1: 判断ヘッダ。折りたたまない。モバイルでは上部に固定して常に見える
            （高さは画面の 45% までに抑え、超えた分はヘッダ内でスクロールする —— 判断材料を隠すのではなく、
            プレビューを読む領域を残すため）。 */}
        <section
          className="sticky top-0 z-10 max-h-[45vh] overflow-y-auto border border-slate-200 bg-white lg:static lg:max-h-none lg:overflow-visible"
          data-testid="proposal-approval-header"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
            <h2 className="m-0 text-base font-bold text-slate-900">{messages.sectionHeader}</h2>
            <span className="text-sm text-slate-500">{messages.fieldState}</span>
            <Badge variant={STATE_BADGE_VARIANTS[rows.state]} data-testid="proposal-approval-state">
              {rows.stateLabel}
            </Badge>
          </div>
          <dl className="m-0 grid grid-cols-1 gap-x-4 px-4 py-2 text-sm sm:grid-cols-2">
            {rows.header.map((row) => (
              <div
                key={row.field}
                className="flex gap-2 border-b border-slate-100 py-1.5 last:border-b-0 sm:last:border-b"
                data-testid={`proposal-approval-header-row-${row.field}`}
                data-emphasis={row.emphasis}
              >
                <dt className="w-28 shrink-0 text-slate-500">{row.label}</dt>
                <dd className={`m-0 min-w-0 break-words ${row.emphasis === 'ATTENTION' ? 'font-semibold text-amber-900' : 'text-slate-900'}`}>
                  {row.value}
                </dd>
              </div>
            ))}
            {rows.approver === null ? null : (
              <div className="flex gap-2 py-1.5" data-testid="proposal-approval-approver">
                <dt className="w-28 shrink-0 text-slate-500">{messages.fieldApprover}</dt>
                <dd className="m-0 min-w-0 break-words text-slate-900">
                  {rows.approver}
                  {auditHref === null ? null : (
                    <>
                      {' '}
                      <Link className={SECONDARY_LINK_CLASSES} href={auditHref} data-testid="proposal-approval-audit-link">
                        {messages.auditLink}
                      </Link>
                    </>
                  )}
                </dd>
              </div>
            )}
          </dl>
          <p className="m-0 border-t border-slate-100 px-4 py-2 text-xs text-slate-500" data-testid="proposal-approval-frozen-notice">
            {rows.frozenNotice}
          </p>
        </section>

        {rows.audienceNotice === null ? null : (
          <p className="m-0 text-sm text-slate-600" data-testid="proposal-approval-partner-notice">
            {rows.audienceNotice}
          </p>
        )}
        {rows.canApprove || rows.audienceNotice !== null ? null : (
          <p className="m-0 text-sm text-slate-600" data-testid="proposal-approval-viewer">
            {messages.viewerNotice}
          </p>
        )}
        {rows.canApprove && denialMessage !== null ? (
          <div role="alert" className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="proposal-approval-denied">
            <p className="font-bold">{messages.deniedTitle}</p>
            <p>{denialMessage}</p>
          </div>
        ) : null}

        {/* 🔴 セクション 2: ゲート結果（層ごと。不合格と警告は別物。折りたたみに入れない） */}
        <Section id="gate" title={messages.sectionGate}>
          {rows.disposition.kind === 'DRAFT' ? (
            <p className="m-0 text-sm text-slate-600" data-testid="proposal-approval-gate-not-requested">
              {messages.gateNotRequested}
            </p>
          ) : (
            <div data-testid="proposal-approval-gate" data-gate-execution={gate.execution}>
              <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-3">
                {gate.layers.map((layer) => (
                  <li
                    key={layer.key}
                    className={`border px-3 py-2 ${layer.state === 'FAIL' ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}
                    data-testid={`proposal-approval-gate-layer-${layer.key}`}
                    data-layer-state={layer.state}
                  >
                    <p className="mb-1 text-xs text-slate-500">{layer.label}</p>
                    <Badge variant={LAYER_BADGE_VARIANTS[layer.state]}>{layer.verdictLabel}</Badge>
                  </li>
                ))}
              </ul>
              {gate.execution === 'RUNNING' ? (
                <p role="status" className="mt-3 mb-0 text-sm text-slate-700" data-testid="proposal-approval-gate-running">
                  {messages.gateRunning}
                </p>
              ) : null}
              {gate.execution === 'HELD_AI_COST_LIMIT' ? (
                <p role="status" className="mt-3 mb-0 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="proposal-approval-gate-held">
                  {messages.gateHeld} {messages.gateHeldResetAtPrefix}
                  {gate.heldResetAt}
                </p>
              ) : null}
              {gate.aiFailed ? (
                <p role="alert" className="mt-3 mb-0 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900" data-testid="proposal-approval-gate-ai-failed">
                  {messages.gateAiFailed}
                </p>
              ) : null}
              {gate.lead === null ? null : (
                <p className={`mt-3 mb-0 text-sm ${gate.failed ? 'text-red-800' : 'text-emerald-800'}`} data-testid="proposal-approval-gate-lead">
                  {gate.lead}
                </p>
              )}
              {gate.execution === 'DONE' ? (
                <FindingList
                  id="findings"
                  title={messages.gateFindingsTitle}
                  emptyLabel={messages.gateFindingsEmpty}
                  findings={gate.findings}
                  severityLabel={null}
                  tone="danger"
                />
              ) : null}
              {gate.execution === 'DONE' ? (
                <>
                  <FindingList
                    id="warnings"
                    title={messages.gateWarningsTitle}
                    emptyLabel={messages.gateWarningsEmpty}
                    findings={gate.warnings}
                    severityLabel={messages.gateWarningLabel}
                    tone="warning"
                  />
                  <p className="mt-2 mb-0 text-xs text-slate-500" data-testid="proposal-approval-gate-warnings-note">
                    {messages.gateWarningsNote}
                  </p>
                </>
              ) : null}
            </div>
          )}
        </Section>
      </div>

      {/* 右（モバイルでは下）: プレビュー + 添付 + 送信元ドメイン + アクション */}
      <div className="grid grid-cols-1 gap-4">
        {/* 🔴 セクション 4: 送信先別プレビュー。承認者が実際に相手が見るものを見てから押す順序を作る。 */}
        <Section id="preview" title={messages.sectionPreview}>
          <div data-testid="proposal-approval-preview">
            <p className="mb-3 text-xs text-slate-500">{messages.previewLead}</p>
            <p className="mb-1 text-xs text-slate-500">{messages.previewSubject}</p>
            <p className="mb-3 break-words font-semibold text-slate-900" data-testid="proposal-approval-preview-subject">
              {rows.preview.subject === null ? (
                <span className="font-normal text-slate-500">{messages.previewSubjectEmpty}</span>
              ) : (
                <HighlightedText text={rows.preview.subject} highlights={rows.preview.subjectHighlights} messages={messages} />
              )}
            </p>
            <p className="mb-1 text-xs text-slate-500">{messages.previewBody}</p>
            <p className="mb-3 whitespace-pre-wrap break-words border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900" data-testid="proposal-approval-preview-body">
              {rows.preview.body === null ? (
                <span className="text-slate-500">{messages.previewBodyEmpty}</span>
              ) : (
                <HighlightedText text={rows.preview.body} highlights={rows.preview.bodyHighlights} messages={messages} />
              )}
            </p>
            <p className="mb-0 text-sm text-slate-700" data-testid="proposal-approval-preview-attachment">
              <span className="text-slate-500">{messages.previewAttachmentLabel}: </span>
              {rows.preview.attachment ?? messages.previewAttachmentNone}
            </p>
          </div>
        </Section>

        {/* セクション 5: 添付 */}
        <Section id="attachment" title={messages.sectionAttachment}>
          <p className="m-0 text-sm text-slate-900" data-testid="proposal-approval-attachment">
            {rows.attachmentNotice}
          </p>
          <p className="mt-2 mb-0 text-xs text-slate-500">{messages.attachmentViewNote}</p>
        </Section>

        {/* セクション 6: 送信元ドメインの状態（`U-04`。未検証なら承認はできるが送信できない） */}
        <Section id="sending-domain" title={messages.sectionSendingDomain}>
          {sendingDomain.kind === 'PARTNER' || sendingDomain.kind === 'NOT_REQUIRED' ? (
            <p className="m-0 text-sm text-slate-600" data-testid="proposal-approval-sending-domain">
              {sendingDomain.note}
            </p>
          ) : sendingDomain.kind === 'VERIFIED' ? (
            <p className="m-0 text-sm text-slate-900" data-testid="proposal-approval-sending-domain">
              {sendingDomain.label}
            </p>
          ) : (
            <div data-testid="proposal-approval-sending-domain">
              <p role="status" className="mb-2 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {sendingDomain.notice} {messages.sendingDomainUnverifiedNote}
              </p>
              <Link className={SECONDARY_LINK_CLASSES} href={sendingDomain.href} data-testid="proposal-approval-sending-domain-open">
                {sendingDomain.linkLabel}
              </Link>
            </div>
          )}
        </Section>

        {/* 🔴 ②: プレビューの末尾の目印。ここが画面に入るまで承認・却下は押せない。 */}
        <p ref={endRef} className="m-0 text-xs text-slate-400" data-testid="proposal-approval-preview-end">
          {messages.previewEnd}
        </p>

        {/* セクション 7: アクション（モバイルでは下部に固定） */}
        <section
          className="sticky bottom-0 z-10 border border-slate-200 bg-white lg:static"
          data-testid="proposal-approval-actions"
          data-actionable={actionable ? 'true' : 'false'}
        >
          <h2 className="border-b border-slate-200 px-4 py-3 text-base font-bold text-slate-900">{messages.sectionActions}</h2>
          <div className="px-4 py-4">
            {rows.disposition.kind !== 'PENDING' ? (
              <p role="status" className="m-0 text-sm text-slate-700" data-testid="proposal-approval-notice" data-disposition={rows.disposition.kind}>
                {rows.disposition.notice}
              </p>
            ) : null}
            {/* 🔴 T-09-08: 送信失敗 → `S-022` への導線（再送は `S-022` の確認ステップを経てだけ行う。ここに「再送」ボタンは置かない）。 */}
            {rows.disposition.kind === 'SUBMIT_FAILED' && sendFailuresHref !== null ? (
              <Link className={`${SECONDARY_LINK_CLASSES} mt-2 inline-block`} href={sendFailuresHref} data-testid="proposal-approval-open-send-failures">
                {messages.openSendFailures}
              </Link>
            ) : null}
            {phase.kind === 'APPROVED' ? (
              <p role="status" className="m-0 text-sm text-emerald-800" data-testid="proposal-approval-result" data-result="APPROVED">
                {messages.approved}
              </p>
            ) : null}
            {phase.kind === 'REJECTED' ? (
              <p role="status" className="m-0 text-sm text-slate-800" data-testid="proposal-approval-result" data-result="REJECTED">
                {messages.rejected}
              </p>
            ) : null}
            {/* 🔴 ⑧: 送信の保留（理由 × 開始時刻 × 設定導線）。PROVIDER_QUOTA には S-038 の導線を出さない。 */}
            {rows.sendHold === null ? null : (
              <div
                role="status"
                className="mt-2 mb-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                data-testid="proposal-approval-send-hold"
                data-reason-key={rows.sendHold.reasonKey}
                data-auto-release={rows.sendHold.autoRelease ? 'true' : 'false'}
              >
                <p className="m-0 font-bold">{rows.sendHold.title}</p>
                <p className="mt-1 mb-0">{rows.sendHold.message}</p>
                <p className="mt-1 mb-0 text-xs">{rows.sendHold.since}</p>
                {rows.sendHold.settingsLink === null ? null : (
                  <Link className={`${SECONDARY_LINK_CLASSES} mt-2 inline-block`} href={rows.sendHold.settingsLink.href} data-testid="proposal-approval-send-hold-link">
                    {rows.sendHold.settingsLink.label}
                  </Link>
                )}
              </div>
            )}
            {phase.kind === 'SUBMIT_REQUESTED' ? (
              <p role="status" className="m-0 text-sm text-slate-800" data-testid="proposal-approval-result" data-result="SUBMIT_REQUESTED">
                {messages.submitRequested}
              </p>
            ) : null}
            {/* 🔴 ⑨（T-12-13 ⑤）: 読み直して `APPROVED` のまま確定を待っている（試行の末尾が未確定 = `RESERVED`）。「送信する」の代わりに受け付けの枠。 */}
            {phase.kind !== 'SUBMIT_REQUESTED' && rows.disposition.kind === 'APPROVED' && rows.awaitingSendSettlement ? (
              <p role="status" className="m-0 text-sm text-slate-800" data-testid="proposal-approval-send-pending">
                {messages.submitRequested}
              </p>
            ) : null}
            {sendActionable ? (
              <div data-testid="proposal-approval-submit-block">
                <p className="mt-2 mb-2 text-xs text-slate-600" data-testid="proposal-approval-submit-lead">
                  {messages.submitLead}
                </p>
                <Button type="button" disabled={!sendButtonEnabled} onClick={() => void submit()} data-testid="proposal-approval-submit">
                  {phase.kind === 'SUBMITTING' && phase.action === 'SUBMIT' ? messages.submitting : messages.submit}
                </Button>
                {!reachedEnd ? (
                  <p role="status" className="mt-2 mb-0 text-sm text-amber-900" data-testid="proposal-approval-submit-scroll-required">
                    {messages.submitScrollRequired}
                  </p>
                ) : null}
              </div>
            ) : null}
            {actionable && phase.kind !== 'REJECT_FORM' ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" disabled={!buttonsEnabled} onClick={() => void approve()} data-testid="proposal-approval-approve">
                  {phase.kind === 'SUBMITTING' && phase.action === 'APPROVE' ? messages.approving : messages.approve}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!buttonsEnabled}
                  onClick={() => {
                    setError(null);
                    setPhase({ kind: 'REJECT_FORM' });
                  }}
                  data-testid="proposal-approval-reject"
                >
                  {messages.reject}
                </Button>
              </div>
            ) : null}
            {actionable && phase.kind === 'REJECT_FORM' ? (
              <form onSubmit={(event) => void reject(event)} data-testid="proposal-approval-reject-form">
                <Field label={messages.rejectReasonLabel} className="mb-3">
                  <Textarea
                    name="reason"
                    rows={3}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={2_000}
                    required
                    data-testid="proposal-approval-reject-reason"
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={!reachedEnd || submitting} data-testid="proposal-approval-reject-submit">
                    {messages.rejectSubmit}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={submitting}
                    onClick={() => setPhase({ kind: 'IDLE' })}
                    data-testid="proposal-approval-reject-cancel"
                  >
                    {messages.rejectCancel}
                  </Button>
                </div>
              </form>
            ) : null}
            {/* 🔴 押せない理由を明示する（無言で disabled にしない）。 */}
            {actionable && !reachedEnd ? (
              <p role="status" className="mt-2 mb-0 text-sm text-amber-900" data-testid="proposal-approval-scroll-required">
                {messages.scrollRequired}
              </p>
            ) : null}
            {error === null ? null : (
              <p role="alert" className="mt-2 mb-0 text-sm text-red-700" data-testid="proposal-approval-error">
                {error}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Link className={SECONDARY_LINK_CLASSES} href={rows.editorHref} data-testid="proposal-approval-open-editor">
                {messages.openEditor}
              </Link>
              <Link className={SECONDARY_LINK_CLASSES} href={homeHref} data-testid="proposal-approval-back-home">
                {messages.backHome}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
