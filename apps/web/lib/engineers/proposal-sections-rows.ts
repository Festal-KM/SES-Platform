// apps/web/lib/engineers/proposal-sections-rows.ts
// `S-006` セクション 4（提案履歴）・5（凍結情報との差分）の表示値の組み立て（docs/04 §S-006 / §5-6 / `F-019 AC-2` /
// docs/05 §6.5 #46b「#46b の境界と記録の確定」）。T-12-16。
//
// 🔴 画面（`app/(main)/engineers/[id]/**`）ではなくここに置く理由は `detail.ts` と同じ: `app/**` はユニットテストの対象外であり、
//    ①「提案後に変更」の注記が `frozen` と `current` の突き合わせ**だけ**から出ること（API は判定を返さない）
//    ②凍結側と現在値が**別のリスト**として組み立てられ、1 つの配列に混ざらないこと —— を固定できる場所が要る。**I/O を持たない。**
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは日本語の語を書かない。
// 🔴 セクション 4 の入力は `listProposals` の行（`HostProposalListItem` / `PartnerProposalListItem`）そのもの。`S-006` 固有の
//    射影を作らない（docs/05 §6.5。2 実装にすると片方だけ境界を見ない経路になる）。ここは**表示値への写像**だけである。
import { t, type MessageKey } from '@ses/i18n';
import type { ProposalState } from '@ses/domain';
import { formatDateTimeJst, toJstIsoDay } from '../format/datetime';
import { formatThousands } from '../format/number';
import { PREFECTURE_MESSAGE_KEYS } from '../format/prefectures';
import { proposalStateLabel } from '../proposals/editor-rows';
import { proposalDetailHref } from '../proposals/hrefs';
import { proposalStateTone, type ProposalStateTone } from '../proposals/list-rows';
import {
  careersEqual,
  snapshotFieldEquals,
  type ProposalSnapshotDiffView,
  type SnapshotDiffField,
  type SnapshotDiffFieldKey,
} from '../proposals/snapshot-diff-fields';
import type { ProposalListItem, ProposalSnapshotSkillView } from '../proposals/views';
import { engineerDetailCareerRows, formatCareerPeriod, formatYears, type EngineerDetailCareerRow } from './detail';
import { ENGINEER_SKILL_LEVEL_MESSAGE_KEYS, REMOTE_MODE_MESSAGE_KEYS } from './labels';

/** `S-006` の URL クエリ（セクション 4 の行 → セクション 5 の選択）。`?diff=<proposalId>`。 */
export const ENGINEER_DETAIL_DIFF_PARAM = 'diff';

/** セクション 4 の行から差分を開く導線（同じ `S-006` の URL に選択を足す）。 */
export function engineerSnapshotDiffHref(engineerId: string, proposalId: string): string {
  return `/engineers/${engineerId}?${ENGINEER_DETAIL_DIFF_PARAM}=${proposalId}#engineer-detail-snapshot-diff`;
}

// ----------------------------------------------------------------------------
// セクション 4: 提案履歴
// ----------------------------------------------------------------------------

/** 1 行分の表示値（文言化済み）。列 = 提案先 / 案件 / 状態バッジ / 作成日 / `S-023` への導線 + 差分の選択。 */
export type EngineerProposalHistoryRow = {
  readonly id: string;
  /** `S-023` への導線。 */
  readonly href: string;
  /** セクション 5 を開く導線（同じ画面の `?diff=`）。 */
  readonly diffHref: string;
  readonly recipient: string;
  readonly project: string;
  readonly state: ProposalState;
  readonly stateLabel: string;
  readonly tone: ProposalStateTone;
  /** JST の暦日（`YYYY-MM-DD`）。 */
  readonly createdOn: string;
  /** セクション 5 に表示中の提案か。 */
  readonly selected: boolean;
};

/**
 * 🔴 ホストと取引先で**同じ行の型**に畳む。取引先の行に無い値（作成会社 / 保留）はこの画面に列が無いので参照しない。
 *    エンジニア名の列は無い（この画面はその人の画面である。凍結側 `displayName` はセクション 5 が出す）。
 */
export function engineerProposalHistoryRows(
  items: readonly ProposalListItem[],
  engineerId: string,
  selectedProposalId: string | null,
): readonly EngineerProposalHistoryRow[] {
  return items.map((item) => ({
    id: item.id,
    href: proposalDetailHref(item.id),
    diffHref: engineerSnapshotDiffHref(engineerId, item.id),
    recipient: item.recipient === null ? t('proposals.list.recipient.unset') : item.recipient.companyName,
    project: item.project === null ? t('proposals.list.project.notShared') : item.project.name,
    state: item.state,
    stateLabel: proposalStateLabel(item.state),
    tone: proposalStateTone(item.state),
    createdOn: toJstIsoDay(new Date(item.createdAt)),
    selected: item.id === selectedProposalId,
  }));
}

// ----------------------------------------------------------------------------
// セクション 5: 凍結情報との差分（バージョン差分ビュー。docs/04 §5-6）
// ----------------------------------------------------------------------------

const FIELD_LABEL_KEYS: Readonly<Record<SnapshotDiffFieldKey, MessageKey>> = {
  displayName: 'engineers.snapshotDiff.field.displayName',
  skills: 'engineers.snapshotDiff.field.skills',
  unitPriceMin: 'engineers.snapshotDiff.field.unitPriceMin',
  unitPriceMax: 'engineers.snapshotDiff.field.unitPriceMax',
  availableFrom: 'engineers.snapshotDiff.field.availableFrom',
  prefecture: 'engineers.snapshotDiff.field.prefecture',
  remoteMode: 'engineers.snapshotDiff.field.remoteMode',
};

/** 項目 1 行。🔴 `frozen` と `current` は別の列（値は表示用の行の配列。スキルは 1 スキル 1 行）。 */
export type SnapshotDiffFieldRow = {
  readonly key: SnapshotDiffFieldKey;
  readonly label: string;
  readonly frozen: readonly string[];
  readonly current: readonly string[];
  /** 🔴 `snapshotFieldEquals` の否定。API の値ではなく画面側の突き合わせ。 */
  readonly changed: boolean;
  /** 「提案後に変更」/「変更なし」。 */
  readonly note: string;
};

/** 凍結された経歴 1 行（`S-023` セクション 3 と同じ 4 列。行 ID は無いので位置キー）。 */
export type SnapshotDiffFrozenCareerRow = {
  readonly key: string;
  readonly period: string;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
};

export type SnapshotDiffRows = {
  readonly proposalId: string;
  /** 「提案（YYYY-MM-DD HH:mm JST 凍結）↔ 現在」。 */
  readonly title: string;
  readonly frozenAt: string;
  readonly fields: readonly SnapshotDiffFieldRow[];
  /** 🔴 凍結側と現在値は**別のキー・別の配列**。1 つのリストに混在させない（`F-019 AC-5`）。 */
  readonly careers: {
    readonly frozen: readonly SnapshotDiffFrozenCareerRow[];
    readonly current: readonly EngineerDetailCareerRow[];
    readonly frozenEmpty: string | null;
    readonly currentEmpty: string | null;
    /** 列としての差（行数または 5 項目のいずれか）。行の対応付けではない。 */
    readonly changed: boolean;
    readonly note: string;
  };
};

function none(): string {
  return t('engineers.detail.valueNone');
}

function skillLevelLabel(level: number | null): string {
  if (level === null) return t('engineers.skills.level.unset');
  const keys: Readonly<Record<number, MessageKey | undefined>> = ENGINEER_SKILL_LEVEL_MESSAGE_KEYS;
  const key = keys[level];
  return key === undefined ? none() : t(key);
}

function skillLines(skills: readonly ProposalSnapshotSkillView[]): readonly string[] {
  if (skills.length === 0) return [t('engineers.snapshotDiff.skills.none')];
  return skills.map(
    (skill) =>
      `${skill.name} ${formatYears(skill.years)}${t('engineers.snapshotDiff.skills.levelPrefix')}${skillLevelLabel(skill.level)}${t('engineers.snapshotDiff.skills.levelSuffix')}`,
  );
}

function unitPrice(value: number | null): string {
  return value === null ? none() : `${formatThousands(value)} ${t('engineers.unitPrice.unit')}`;
}

function prefectureLabel(code: string | null): string {
  if (code === null) return none();
  // 値集合の外の値（DB を直接更新された場合など）で画面を落とさない（`detail.ts` の `skillLevelLabel` と同じ）。
  const keys: Readonly<Record<string, MessageKey | undefined>> = PREFECTURE_MESSAGE_KEYS;
  const key = keys[code];
  return key === undefined ? code : t(key);
}

function remoteModeLabel(mode: string | null): string {
  if (mode === null) return none();
  const keys: Readonly<Record<string, MessageKey | undefined>> = REMOTE_MODE_MESSAGE_KEYS;
  const key = keys[mode];
  return key === undefined ? mode : t(key);
}

/** 片側の値を表示用の行に写す（凍結側・現在値で**同じ関数**を通す。写し方が違うと差分が偽陽性になる）。 */
function valueLines(field: SnapshotDiffField, side: 'frozen' | 'current'): readonly string[] {
  switch (field.key) {
    case 'displayName':
      return [field[side]];
    case 'skills':
      return skillLines(field[side]);
    case 'unitPriceMin':
    case 'unitPriceMax':
      return [unitPrice(field[side])];
    case 'availableFrom':
      return [field[side] ?? none()];
    case 'prefecture':
      return [prefectureLabel(field[side])];
    case 'remoteMode':
      return [remoteModeLabel(field[side])];
  }
}

function changeNote(changed: boolean): string {
  return changed ? t('engineers.snapshotDiff.changedNote') : t('engineers.snapshotDiff.unchangedNote');
}

/**
 * セクション 5 の表示値。
 * 🔴 「提案後に変更」は **`snapshotFieldEquals` / `careersEqual`（`frozen` と `current` の突き合わせ）だけ**から出る。
 *    API の応答に `changed` は無い（docs/05 §6.5「変更の有無は画面側の純粋関数が導き、API は判定を返さない」）。
 * 🔴 経歴の現在値は `S-006` セクション 8 と**同じ部品**（`engineerDetailCareerRows`）、凍結側は `S-023` セクション 3 と同じ 4 列・
 *    同じ並び（配列順のまま。並べ替えない）。
 */
export function snapshotDiffRows(proposalId: string, view: ProposalSnapshotDiffView): SnapshotDiffRows {
  const frozenAt = formatDateTimeJst(view.frozenAt);
  const careersChanged = !careersEqual(view.careers.frozen, view.careers.current);
  return {
    proposalId,
    title: `${t('engineers.snapshotDiff.title.prefix')}${frozenAt}${t('engineers.snapshotDiff.title.frozenSuffix')}`,
    frozenAt,
    fields: view.fields.map((field) => {
      const changed = !snapshotFieldEquals(field);
      return {
        key: field.key,
        label: t(FIELD_LABEL_KEYS[field.key]),
        frozen: valueLines(field, 'frozen'),
        current: valueLines(field, 'current'),
        changed,
        note: changeNote(changed),
      };
    }),
    careers: {
      frozen: view.careers.frozen.map((career, index) => ({
        key: `frozen-${String(index)}`,
        period: formatCareerPeriod(career.periodFrom, career.periodTo),
        role: career.role,
        description: career.description,
        technologies: career.technologies === '' ? none() : career.technologies,
      })),
      current: engineerDetailCareerRows(view.careers.current),
      frozenEmpty: view.careers.frozen.length === 0 ? t('engineers.snapshotDiff.careers.frozenEmpty') : null,
      currentEmpty: view.careers.current.length === 0 ? t('engineers.snapshotDiff.careers.currentEmpty') : null,
      changed: careersChanged,
      note: changeNote(careersChanged),
    },
  };
}
