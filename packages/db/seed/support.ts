// packages/db/seed/support.ts
// シードの共通部品（ID の組み立て / 相対日 / 状態遷移の適用）。
//
// 🔴 docs/05 §13.6 の 3 つの規律をここに集約する:
//    ①冪等な再生成（ID は決定的に組み立てる。乱数 UUID にしない）
//    ②時系列データは「実行日 = T」からの相対日で作る
//    ③🔴 DB に直接 INSERT せず、`packages/domain` の `transition()` を通して状態を進める
import type { StateMachine, TransitionTable } from '@ses/domain';

/**
 * 決定的な UUID を組み立てる。
 * 🔴 乱数 UUID にしない（`docs/05` §13.6「冪等な再生成」/ §10.1 と同じ理由）。
 *    再実行で同じ ID になることが、テストの期待値を安定させる唯一の方法である。
 *    形は uuid(7) と同じ 8-4-4-4-12 で、可変部は「テナント連番 + 種別コード + 連番」だけである。
 */
export function seedUuid(options: {
  readonly presetCode: string; // 4 hex。プリセット間で母集団が混ざらないようにする
  readonly tenantIndex: number; // 0..255
  readonly entityCode: number; // 0..255
  readonly seq: number; // 0..0xffffffff
}): string {
  const hex = (value: number, width: number): string =>
    value.toString(16).padStart(width, '0').slice(-width);
  return [
    `0193${options.presetCode}`,
    '0000',
    '7000',
    '8000',
    `${hex(options.tenantIndex, 2)}${hex(options.entityCode, 2)}${hex(options.seq, 8)}`,
  ].join('-');
}

/** 「実行日 = T」からの相対日（docs/05 §13.6）。UTC で日数を足すだけの純粋計算。 */
export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/** `@db.Date` 列に渡す値（時刻を切り落とす）。 */
export function dateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** 1 ステップ分の遷移。`data` は遷移と同時に埋める列（承認日時・締結日時など）。 */
export type StateStep<S extends string, D> = {
  readonly to: S;
  readonly data?: D;
};

/**
 * 🔴 状態を「transition() を通して」進める（docs/05 §13.6）。
 *
 * - 可否は `packages/domain` の遷移表だけが決める（ここに if を書かない）。
 * - DB 側は **CAS**（`WHERE id = ? AND state = <from>`）で 1 行だけ更新する
 *   （docs/05 §10.2 と同じ規律。0 件更新なら不整合なので例外にする）。
 * - 途中の状態を飛ばさないため、`SUBMITTED` の行も必ず `DRAFT → … → SUBMITTED` を通る。
 */
export async function advanceState<S extends string, T extends TransitionTable<S>, D>(
  machine: StateMachine<S, T>,
  options: {
    readonly id: string;
    readonly from: S;
    readonly steps: ReadonlyArray<StateStep<S, D>>;
    readonly update: (args: {
      readonly id: string;
      readonly from: S;
      readonly to: S;
      readonly data: D | undefined;
    }) => Promise<number>;
  },
): Promise<S> {
  let current = options.from;
  for (const step of options.steps) {
    // 🔴 遷移表に無い組はここで InvalidStateTransitionError（422）になる。
    machine.transition(
      current as S & keyof T,
      step.to as never,
    );
    const updated = await options.update({
      id: options.id,
      from: current,
      to: step.to,
      data: step.data,
    });
    if (updated !== 1) {
      throw new Error(
        `${machine.entity}(${options.id}): ${current} -> ${step.to} の CAS が ${updated} 件でした` +
          '（1 件でなければシードの前提が壊れている）。',
      );
    }
    current = step.to;
  }
  return current;
}
