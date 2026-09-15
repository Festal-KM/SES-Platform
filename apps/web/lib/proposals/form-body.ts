// apps/web/lib/proposals/form-body.ts
// `S-020` のフォームの値 → #36 / #37 の body（docs/05 §6.5「T-09-01 の決着」）。T-09-01。
//
// 🔴 純粋モジュール（外部 import を持たない）。`'use client'` の画面（`proposal-editor.tsx`）が値 import し、
//    結合テスト（`tests/isolation/proposals-create-update.test.ts`）が **画面と同じ payload** を組み立てるために
//    同じ関数を使う（`tests/static/client-db-boundary.test.ts` の規律。`@ses/db` に依存しない）。
//
// 🔴 添付（`skillSheetId`）は**変更したときだけ**載せる（#37 の「未指定 = 変更しない」）。
//    レビュー指摘（T-09-01 NG-1）: 常に凍結版の ID を送り返すと、ホストが取引先作成の `DRAFT` を保存したときに
//    `skill_sheets` が C3 で見えず（他社の台帳）、変更していない添付の照合で 404 に倒れていた。
import type { ProposalFormValues } from './editor-rows';

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function integerOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * #36 の body（案件・エンジニアは呼び出し側が足す）。
 * 🔴 提案先の 2 列は**空なら載せない**（スキーマが空を受けないため。#36 では欠落 = 400 になる）。その他は空 → `null`。
 */
export function toProposalCreateBody(values: ProposalFormValues) {
  const companyName = emptyToNull(values.recipientCompanyName);
  const email = emptyToNull(values.recipientEmail);
  return {
    ...(companyName === null ? {} : { recipientCompanyName: companyName }),
    ...(email === null ? {} : { recipientEmail: email }),
    offeredUnitPrice: integerOrNull(values.offeredUnitPrice),
    offeredStartDate: emptyToNull(values.offeredStartDate),
    workStyle: emptyToNull(values.workStyle),
    subject: emptyToNull(values.subject),
    body: emptyToNull(values.body),
  };
}

/**
 * #37 の body。🔴 `skillSheetId` は `initial`（画面を開いたときの値 = 凍結側の現在値）から**変わったときだけ**載せる。
 * 変わっていなければキーごと省く（`undefined` ではなく存在しない）—— 「未指定 = 変更しない」。
 */
export function toProposalPatchBody(values: ProposalFormValues, initial: ProposalFormValues) {
  const attachmentChanged = values.skillSheetId.trim() !== initial.skillSheetId.trim();
  return {
    ...toProposalCreateBody(values),
    ...(attachmentChanged ? { skillSheetId: emptyToNull(values.skillSheetId) } : {}),
  };
}
