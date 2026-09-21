// apps/web/lib/projects/labels.ts
// 案件の値集合 → 文言キーの写像（`S-012`。後続で `S-010` / `S-011` も使う）。T-06-01。
//
// 🔴 文言そのものは `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。ここは写像だけを持つ。
// 🔴 テンプレートリテラルでキーを組み立てない（`lib/engineers/labels.ts` と同じ規律）。
//    `Record<値集合, MessageKey>` にすることで、**値が増えたら文言の割り当てをコンパイラが強制する**。
import type { ProjectStatus, RemoteMode, RequirementKind } from '@ses/db';
import type { ProjectPublicField } from '@ses/domain';
import type { MessageKey } from '@ses/i18n';

export const PROJECT_STATUS_MESSAGE_KEYS: Readonly<Record<ProjectStatus, MessageKey>> = {
  OPEN: 'projects.status.OPEN',
  FILLED: 'projects.status.FILLED',
  SUCCESSOR_WANTED: 'projects.status.SUCCESSOR_WANTED',
};

/**
 * 🔴 `engineers.remoteMode.*` と同じ意味の値だが、案件側の文言キーを別に持つ。
 *    人材の「リモート可否」と案件の「リモート可否」は同じ語彙でも文脈が違い、片方だけを
 *    言い換えたくなったときにキーが共有されていると両方が動く（`docs/04` の画面別文言の原則）。
 */
export const PROJECT_REMOTE_MODE_MESSAGE_KEYS: Readonly<Record<RemoteMode, MessageKey>> = {
  FULL_REMOTE: 'projects.remoteMode.FULL_REMOTE',
  PARTIAL_REMOTE: 'projects.remoteMode.PARTIAL_REMOTE',
  ONSITE_ONLY: 'projects.remoteMode.ONSITE_ONLY',
};

/**
 * 🔴 `F-013 AC-1` の 2 区分。**見出しと説明を区分ごとに分ける**（`docs/04` §S-012
 *    「必須 / 尚可の 2 ブロックを視覚的に分ける」）。
 */
export const REQUIREMENT_KIND_HEADING_KEYS: Readonly<Record<RequirementKind, MessageKey>> = {
  MUST: 'projects.section.must',
  NICE: 'projects.section.nice',
};

export const REQUIREMENT_KIND_NOTE_KEYS: Readonly<Record<RequirementKind, MessageKey>> = {
  MUST: 'projects.requirements.must.note',
  NICE: 'projects.requirements.nice.note',
};

export const REQUIREMENT_KIND_EMPTY_KEYS: Readonly<Record<RequirementKind, MessageKey>> = {
  MUST: 'projects.requirements.must.empty',
  NICE: 'projects.requirements.nice.empty',
};

/**
 * 🔴 T-12-10: 公開欄 3 欄 → 文言キー（`docs/04` 改訂 14 §S-011 の原因の欄 / §S-012 の印）。
 *
 * 🔴 **`S-011` の帯と `S-012` の入力欄が同じ語を使う**（別の語にすると、原因の欄から
 *    直す場所に辿り着けない。`docs/04` §S-011 の 🔴）。
 * 🔴 `Record<ProjectPublicField, MessageKey>` にすることで、**3 欄が増えたら文言の割り当てを
 *    コンパイラが強制する**（`PROJECT_PUBLIC_FIELDS` は閉集合であり、増やすのは人間の判断）。
 */
export const PROJECT_PUBLIC_FIELD_MESSAGE_KEYS: Readonly<Record<ProjectPublicField, MessageKey>> = {
  name: 'projects.detail.publishState.field.name',
  publicSummary: 'projects.detail.publishState.field.publicSummary',
  requirementFreeText: 'projects.detail.publishState.field.requirementFreeText',
};
