// apps/web/lib/engineers/registration-steps.ts
// `S-007` 左レールの**縦ステッパー 4 段**の状態を決める純関数。2026-10-05（人間提示のワイヤーフレーム
// 「SES Hub 新規人材登録ダッシュボード.png」）。
//
// ============================================================================
// 🔴 なぜ 4 段目が「AI による情報抽出」ではないのか
// ============================================================================
// ワイヤーフレームの第 2 段は「AI による情報抽出」だが、**その段は作らない**:
//   ① `CLAUDE.md` §3.2 は氏名・生年月日・連絡先・顔写真・現所属会社名を**送信前にマスキングする**と
//      定めている。マスキングした以上、AI はそれらを返せない（ワイヤーフレームの抽出項目は
//      氏名 / フリガナ / 性別 / 生年月日 / 年齢であり、`BR-52` で DB に列も無い）。
//   ② `sheet-parser`（§12.2）の配線は本タスクの範囲外であり、**押して何も起きないボタンを置かない**
//      （`UI_GUIDELINES.md` §7）。
// したがって第 2 段は、**画面に現に在るもの**（基本情報・スキル・経歴の入力）を指す語にする。
//
// ============================================================================
// 🔴 なぜ「完了」の判定をここまで狭くするのか
// ============================================================================
// このフォームで**必須なのは氏名だけ**である（他はすべて任意。`docs/04` §S-007）。したがって
// 「入力済み / 未入力」を任意の段に当てると、**空のままでよい段が欠陥に見える** ——
// `docs/04` §S-007 は経歴 0 行について「警告・注意色・保存の抑止を作らない」と明示しており、
// 同じ理由で任意の段に「未完了」を出さない。**任意の段は `OPTIONAL` という別の状態**にする。
//
// 🔴 **書類の段は `OPTIONAL` 固定である。** 既存の版の有無をこの画面は読まない（読むと
//    `S-008` と 2 つ目の版一覧になる）。「取り込み済みかどうか」を言えないので、言わない。
//
// 🔴 `'use client'` のフォーム本体と同じ束に入るため、**I/O も `@ses/i18n` も import しない**
//    （文言は呼び出し側が表で渡す。`_form/career-values.ts` と同じ規律）。
// 🔴 置き場所が `lib/engineers/` なのは、**`app/**` にユニットテストを置けない**ためである
//    （`vitest.config.ts` の `include` は `app/**` から `*.render.test.tsx` だけを拾う）。
//    判定規則をテストで固定したいので、純関数はここに置く。

/** 4 段の識別子（**順序はこの配列のとおり**）。 */
export const REGISTRATION_STEP_KEYS = ['documents', 'profile', 'conditions', 'review'] as const;

export type RegistrationStepKey = (typeof REGISTRATION_STEP_KEYS)[number];

/**
 * 段の状態。
 * - `DONE` … その段で**必須の入力**がすべて埋まっている
 * - `CURRENT` … いま埋めるところ（🔴 **1 段だけ**）
 * - `TODO` … このあと
 * - `OPTIONAL` … 必須の入力が無い段（埋めなくても登録できる）
 */
export type RegistrationStepState = 'DONE' | 'CURRENT' | 'TODO' | 'OPTIONAL';

export type RegistrationStep = {
  readonly key: RegistrationStepKey;
  /** 1 始まりの通し番号（画面に出す数字）。 */
  readonly order: number;
  readonly state: RegistrationStepState;
};

export type RegistrationStepInput = {
  readonly mode: 'CREATE' | 'EDIT';
  /** 🔴 このフォームで唯一の必須項目。`trim()` 前の生の値で受け取る。 */
  readonly displayName: string;
};

/**
 * 4 段の状態を決める。
 *
 * 🔴 規則は 2 つだけである:
 *   ① **氏名が空なら `profile` が `CURRENT`**、`review` は `TODO`（まだ確認できない）
 *   ② **氏名が入っていれば `profile` は `DONE`**、`review` が `CURRENT`（確認して登録できる）
 * `documents` と `conditions` は必須を持たないので常に `OPTIONAL` である。
 *
 * 🔴 **`CURRENT` はちょうど 1 段**である（`registration-steps.test.ts` が固定する）。
 *    2 段に出ると「いまどこか」が読めず、ステッパーが飾りになる。
 */
export function registrationSteps(input: RegistrationStepInput): readonly RegistrationStep[] {
  const named = input.displayName.trim() !== '';
  const stateOf = (key: RegistrationStepKey): RegistrationStepState => {
    if (key === 'profile') return named ? 'DONE' : 'CURRENT';
    if (key === 'review') return named ? 'CURRENT' : 'TODO';
    return 'OPTIONAL';
  };
  return REGISTRATION_STEP_KEYS.map((key, index) => ({
    key,
    order: index + 1,
    state: stateOf(key),
  }));
}

/**
 * 書類の段の注記は**モードで変わる**（`CREATE` では取り込めない）。
 *
 * 🔴 既存の API は版をエンジニアに紐づけて採番する（`POST /api/engineers/{id}/skill-sheets`）。
 *    登録前に取り込む経路は存在せず、作れば**新しいアップロード API** になる。したがって
 *    `CREATE` では枠を描かず、**いつできるかを書く**（`UI_GUIDELINES.md` §7
 *    「操作できないときは `disabled` で表さず、ボタンを描かず理由テキストを置く」）。
 */
export function canImportDocuments(mode: 'CREATE' | 'EDIT', engineerId: string | null): boolean {
  return mode === 'EDIT' && engineerId !== null;
}
