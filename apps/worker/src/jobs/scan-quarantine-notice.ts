// apps/worker/src/jobs/scan-quarantine-notice.ts
// 🔴 スキャン失敗・隔離の周知（`docs/02` `F-011` 処理④ / docs/05 §8.5 / §9.6 / `A-22`）。T-05-08。
//
// ============================================================================
// 🔴 周知は 2 経路あり、**片方だけでは要件を満たさない**
// ============================================================================
//   ① **アプリ内表示** … `S-003` / `S-004` の隔離ブロックと `S-008` の状態。
//      🔴 **宛先分類によらず必ず出る**（`F-011` 処理④ の 🔴「パートナーの担当者が隔離に
//      気づけない状態にならない」）。実装は `apps/web/lib/home/blocks.ts` であり、
//      **本ファイルの成否とは独立している**（メールが 0 通でも画面には出る）。
//   ② **メール** … 本ファイル。`sandbox` では宛先分類で実送信 / モックが分かれる
//      （分類 1 = 実送信 / 分類 2 = モック。`A-22` / `CLAUDE.md` §11.1）。
//      その振り分けは `email.dispatch` の単一経路（`performEmailSend` →
//      `SandboxRecipientScopedEmailSender`）が行い、**ここには環境の分岐が 1 つも無い**。
//
// ============================================================================
// 🔴 このファイルはメールを 1 通も送らない
// ============================================================================
// 行うのは「`EmailDispatch` を予約して `email.dispatch` を積む」ところまでである。
// 呼び出し元（`scan.apply-result` / `scan.poll`）は `attempts: 3` の内部ジョブであり、
// ここから直接送ると再試行が実送信に掛かる。冪等性は `EmailDispatch.dedupeKey` の `UNIQUE`
// （＝ 何回積んでも 1 通）が担保する。
//
// 🔴 **判定を 2 実装にしない。** 「隔離かどうか」は `@ses/domain` の
//    `isQuarantinedScanStatus`、「どちらの所有か」は `packages/db` の
//    `readScanQuarantineNotice`（`app_scan_quarantine_target`）だけが答える。
import { emailDispatchDedupeKey, readScanQuarantineNotice, reserveEmailDispatch } from '@ses/db';
import type { OperationalMailDispatch } from '@ses/connectors';
import { isQuarantinedScanStatus } from '@ses/domain';
import type { SystemTenantCtx } from '@ses/db';

/**
 * 🔴 SES 側のテンプレート名（`EmailDispatch.templateKey`）。
 *
 * 🔴 本文に**内容を 1 つも載せない**（差し込み値はアプリへのリンク 1 つだけ。
 *    `operational-mail-params.ts`）。氏名・ファイル名・版のメモは PII / 自由入力であり、
 *    メールは監査もアクセス制御もできない場所である（`CLAUDE.md` §3.5 / docs/05 §16.2）。
 *    「どの版が隔離されたか」は、閲覧者自身の権限で読める画面（`S-008`）が示す。
 */
export const SKILL_SHEET_QUARANTINE_TEMPLATE_KEY = 'SKILL_SHEET_QUARANTINE';

/**
 * `dedupeKey` の `targetId`（docs/05 §3.9 の `'{templateKey}:{targetId}:{recipientHash}'`）。
 *
 * 🔴 **状態を鍵に含める。** スキャン状態は重篤度が単調増加する（`UNSCANNABLE` → `INFECTED` 等。
 *    `packages/domain/src/scan/status.ts`）ため、**悪化したら改めて 1 通送る**のが正しい
 *    （前の通知は「検査不能」であり、感染の周知にはなっていない）。
 * 🔴 逆に、同じ状態への重複配信・順序逆転・ジョブの再試行では `targetId` が変わらないので
 *    `UNIQUE` に当たり **1 通に収束する**。
 * 🔴 区切りに `:` を使わない（`dedupeKey` 自体の 3 分割の形を壊さないため。
 *    `parseAccountMailDedupeKey` と同じ前提を保つ）。
 */
export function scanQuarantineTargetId(input: {
  readonly skillSheetId: string;
  readonly scanStatus: string;
}): string {
  return `${input.skillSheetId}#${input.scanStatus}`;
}

export type ScanQuarantineNoticeDeps = {
  /**
   * 🔴 `email.dispatch` を積む（BullMQ の配線は SP-07）。
   *    既定値（no-op）を置かない —— 置くと「周知したつもりで 1 通も出ていない」状態が生まれる
   *    （`CLAUDE.md` §11.1「成功したように見えて実際には起きていない」）。
   */
  readonly enqueueEmailDispatch: (job: OperationalMailDispatch) => Promise<void>;
};

export type ScanQuarantineNoticeOutcome =
  /** そのオブジェクトキーに対応する `SkillSheet` がテナント内に無い（呼び出し側が `A-005` に出す）。 */
  | { readonly kind: 'TARGET_NOT_FOUND' }
  /** 隔離ではない（`CLEAN` / `SCANNING`）。**正常系**であり、周知しない。 */
  | { readonly kind: 'NOT_QUARANTINED' }
  | {
      readonly kind: 'NOTIFIED';
      /** 周知の対象となった担当者の数（0 でもエラーではない。アプリ内表示は出る）。 */
      readonly recipients: number;
      /** この実行で `email.dispatch` を積んだ通数（重複は `dedupeKey` が畳むので 0 になりうる）。 */
      readonly queued: number;
    };

/**
 * 🔴 隔離を所有側の担当者へ周知する（`F-011` 処理④）。
 *
 * 呼び出し元は `scan.apply-result` / `scan.poll` の 2 つだけであり、**適用（`applyFileScanResult`）
 * の直後に、`WebhookDelivery` を処理済みにする前**に呼ぶ。順序の理由:
 * ここで失敗するとジョブが再試行されるが、`applyFileScanResult` は冪等（2 回目は `KEPT`）であり、
 * **状態は DB から読み直す**ので、再試行でも同じ周知が成立する。処理済みを先に立てると、
 * 周知だけが落ちたまま二度と再実行されない。
 */
export async function notifyScanQuarantine(
  deps: ScanQuarantineNoticeDeps,
  ctx: SystemTenantCtx,
  input: { readonly objectKey: string; readonly observedAt: Date },
): Promise<ScanQuarantineNoticeOutcome> {
  // 🔴 状態は**適用後の DB の値**を読む（ジョブが受け取った結果ではない）。順序逆転で
  //    より軽い判定が後から届いても、周知されるのは常に「いま隔離されている状態」である。
  const notice = await readScanQuarantineNotice(ctx, { objectKey: input.objectKey });
  if (notice === null) return { kind: 'TARGET_NOT_FOUND' };
  if (!isQuarantinedScanStatus(notice.target.scanStatus)) return { kind: 'NOT_QUARANTINED' };

  const targetId = scanQuarantineTargetId({
    skillSheetId: notice.target.skillSheetId,
    scanStatus: notice.target.scanStatus,
  });

  let queued = 0;
  for (const recipient of notice.recipients) {
    const dispatch = await reserveEmailDispatch(ctx, {
      // 🔴 分類は `packages/db` が `Membership` から導いた値をそのまま運ぶ
      //    （ここで所有側から組み立て直さない。docs/05 §8.2）。
      recipientClass: recipient.recipientClass,
      recipientEmail: recipient.email,
      templateKey: SKILL_SHEET_QUARANTINE_TEMPLATE_KEY,
      dedupeKey: emailDispatchDedupeKey({
        templateKey: SKILL_SHEET_QUARANTINE_TEMPLATE_KEY,
        targetId,
        recipientEmail: recipient.email,
      }),
      observedAt: input.observedAt,
    });

    // 🔴 `QUEUED` の行だけを積む。既に `SENT` / `MOCKED` / `HELD_*` / `FAILED` になっている行を
    //    積み直すと、`performEmailSend` は `ALREADY_SETTLED` で終わるだけの空撃ちになる
    //    （保留からの復帰は `send.hold-release` の責務であり、ここではない）。
    // 🔴 逆に「作成できなかったが `QUEUED` のまま」の行は積み直す —— 前回の実行が
    //    予約の後、enqueue の前に落ちた場合であり、積まないと永久に届かない。
    if (dispatch.status !== 'QUEUED') continue;
    await deps.enqueueEmailDispatch({
      dispatchId: dispatch.dispatchId,
      tenantId: ctx.tenantId,
      recipientClass: recipient.recipientClass,
    });
    queued += 1;
  }

  return { kind: 'NOTIFIED', recipients: notice.recipients.length, queued };
}
