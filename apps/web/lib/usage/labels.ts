// apps/web/lib/usage/labels.ts
// 利用量の 4 単位（`AiUnitKey`）の表示名の写像。
//
// 🔴 **写像は 1 箇所**にする。`S-038`（`app/(main)/settings/usage/page.tsx`）と共通外枠の
//    上限インジケータ（`lib/shell/usage-indicator.ts`）の両方が同じ単位名を出すため、
//    別々に持つと**片方だけ直る**状態が生まれる（T-1220 でここへ集約した）。
// 🔴 `Record<AiUnitKey, MessageKey>` にしているので、単位が増えたら写像の書き忘れがコンパイルで落ちる。
// 🔴 `gate-inspector` のキーはここに無い（`F-027 AC-7`。残量には現れず、**止まった理由としてだけ**現れる）。
import type { MessageKey } from '@ses/i18n';
import type { AiUnitKey } from './view';

export const AI_UNIT_MESSAGE_KEYS = {
  sheetParse: 'usage.aiUnit.sheetParse',
  matchRationale: 'usage.aiUnit.matchRationale',
  proposalDraft: 'usage.aiUnit.proposalDraft',
  renewalSummary: 'usage.aiUnit.renewalSummary',
} as const satisfies Readonly<Record<AiUnitKey, MessageKey>>;
