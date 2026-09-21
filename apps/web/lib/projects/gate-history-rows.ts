// apps/web/lib/projects/gate-history-rows.ts
// 🔴 `S-013` セクション 4「ゲート結果」の表示行（T-12-10。`docs/04` 改訂 14 §S-013 / §5-3）。
//
// 🔴 **公開の実行によるものと、公開後の再検査によるものの両方を、同じ体裁で描く。**
//    違うのは**契機の 1 行**（`公開の実行` / `公開欄の編集による再検査` + 実行日時）だけであり、
//    層の並びも語も変えない —— 承認者・設定者が画面をまたいで同じ読み方をできることが
//    ゲートの成立条件である（`docs/04` §S-013）。
// 🔴 **契機が読めないと、`S-011` の帯から辿った利用者が「これは公開しようとしたときの古い結果では」
//    と迷う。** 行ごとに必ず添える。
// 🔴 純粋関数（`packages/i18n` の語だけを引く）。`'use client'` の画面には**文字列で渡す**
//    （`visibility-props.ts` と同じ規律）。
import { t } from '@ses/i18n';
import type { GateResultHistoryItem, ProjectPublishRunTrigger } from '@ses/domain';
import type { MessageKey } from '@ses/i18n';
import { formatDateTimeJst } from '../format/datetime';

/** 🔴 契機 → 文言キー（`Record` にして、値が増えたら割り当てをコンパイラが強制する）。 */
const RUN_TRIGGER_MESSAGE_KEYS: Readonly<Record<ProjectPublishRunTrigger, MessageKey>> = {
  PUBLISH: 'projects.visibilitySettings.gate.history.trigger.PUBLISH',
  RECHECK: 'projects.visibilitySettings.gate.history.trigger.RECHECK',
};

const LAYER_MESSAGE_KEYS = {
  pii: 'projects.visibilitySettings.gate.layer.pii',
  commerce: 'projects.visibilitySettings.gate.layer.commerce',
  consistency: 'projects.visibilitySettings.gate.layer.consistency',
} as const satisfies Readonly<Record<keyof GateResultHistoryItem['layers'], MessageKey>>;

const VERDICT_MESSAGE_KEYS = {
  PASS: 'projects.visibilitySettings.gate.verdict.PASS',
  FAIL: 'projects.visibilitySettings.gate.verdict.FAIL',
  RUNNING: 'projects.visibilitySettings.gate.verdict.RUNNING',
  // 🔴 保留は「検査中」である（`GATE_FAILED` の語を使わない。`F-027 AC-5`）。
  HELD: 'projects.visibilitySettings.gate.verdict.HELD',
} as const satisfies Readonly<Record<string, MessageKey>>;

/** 1 層の表示（層名 + 判定 + 指摘の抜粋）。 */
export type ProjectGateLayerRow = {
  readonly key: 'pii' | 'commerce' | 'consistency';
  readonly label: string;
  readonly verdict: string;
  /**
   * 🔴 指摘の抜粋。**この画面にだけ出す**（`S-011` の帯には載せない。商流層の指摘は
   *    エンド企業名そのものであり、案件詳細に常時表示される経路を作らない）。
   */
  readonly findings: readonly string[];
};

/** `S-013` セクション 4 の 1 行（実行 1 回）。 */
export type ProjectGateHistoryRow = {
  readonly reviewGateId: string;
  /** 🔴 実行の契機（`公開の実行` / `公開欄の編集による再検査`）。**必ず出す。** */
  readonly trigger: string;
  /** 実行日時（`DONE`）または保留開始日時（`HELD_AI_COST_LIMIT`）。 */
  readonly occurredAt: string;
  /** 🔴 保留の行だけ（「修正して再実行」を促さず、`S-038` への導線も出さない）。 */
  readonly heldLabel: string | null;
  /** 現在の内容に対する結果か（`docs/04` §S-023 と同じ印）。 */
  readonly matchesCurrentContent: boolean;
  readonly layers: readonly ProjectGateLayerRow[];
};

function layerRow(
  key: ProjectGateLayerRow['key'],
  layer: GateResultHistoryItem['layers']['pii'],
): ProjectGateLayerRow {
  return {
    key,
    label: t(LAYER_MESSAGE_KEYS[key]),
    verdict: t(VERDICT_MESSAGE_KEYS[layer.state]),
    findings: layer.findings.map((finding) => finding.excerpt),
  };
}

/**
 * 🔴 履歴の全行を表示行に写す（並びは `packages/db` が保証する = 新しい実行が先）。
 *
 * 🔴 **契機が `null` の行は描かない。** `review_gates.run_trigger` は `PROJECT_PUBLISH` のとき
 *    NOT NULL（§3.6 の CHECK）であり、`null` は提案の行（この対象には現れない）か不変条件違反である。
 *    既定値（`PUBLISH`）で埋めると、再検査の結果を「公開の実行」と偽って描くことになる。
 */
export function projectGateHistoryRows(
  items: readonly GateResultHistoryItem[],
): readonly ProjectGateHistoryRow[] {
  return items.flatMap((item) => {
    if (item.runTrigger === null) return [];
    const occurredAt = item.executedAt ?? item.heldSince;
    return [
      {
        reviewGateId: item.reviewGateId,
        trigger: t(RUN_TRIGGER_MESSAGE_KEYS[item.runTrigger]),
        occurredAt: occurredAt === null ? '' : formatDateTimeJst(occurredAt),
        heldLabel:
          item.execution === 'HELD_AI_COST_LIMIT'
            ? t('projects.visibilitySettings.gate.history.held')
            : null,
        matchesCurrentContent: item.matchesCurrentContent,
        layers: [
          layerRow('pii', item.layers.pii),
          layerRow('commerce', item.layers.commerce),
          layerRow('consistency', item.layers.consistency),
        ],
      },
    ];
  });
}
