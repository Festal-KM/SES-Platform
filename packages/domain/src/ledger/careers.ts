// packages/domain/src/ledger/careers.ts
// 経験内容と従事期間（`EngineerCareer`）の純粋な値と関数。T-09-12
// （docs/05 §3.4.1 / §3.6 / §6.4「#16 / #16b / #17 の経験内容の決着」/ Issue #35 = A）。
//
// 🔴 ここに置くのは 3 つだけである:
//   ① 1 行の 5 項目（`CareerRowValues`）と、凍結行（`FrozenCareer` = 同じ 5 項目。**行 ID を持たない**）
//   ② `diffCareerRows` —— 「保存前の行集合」と「送られた行集合」の差分（行ごとの監査ログの材料）
//   ③ `frozenCareersToInspectionText` —— 凍結行を品質ゲートの `field='snapshot'` に渡す 1 本の文字列
// 並び順の確定（`period_from DESC → created_at ASC → id ASC`）は **DB の `ORDER BY`** が行う
// （索引がそのまま供給する。docs/05 §3.4.1）。ここでソートし直す関数を置かない —— 2 実装になると
// 「画面と凍結で行の順が違う」事故の温床になる。
//
// 🔴 `packages/domain` は I/O・現在時刻を持たない（`CLAUDE.md` §2.1）。すべて入力だけで決まる。

/** 1 行の 5 項目（`F-008 AC-5`）。期間は `YYYY-MM`、終了の `null` = 継続中。 */
export type CareerRowValues = {
  readonly periodFrom: string;
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
};

/**
 * `EngineerSnapshot.careers` の 1 行（docs/05 §3.6 `FrozenCareer`）。
 * 🔴 台帳の行 ID・FK を**持たない**。値の複製だけが凍結である（持つと「現在値へ辿る導線」が生まれ、
 *    `S-023` が凍結側だけを描く契約〔#46〕が実装のうっかりで破れる）。
 */
export type FrozenCareer = CareerRowValues;

/** 5 項目のキー（監査の `changedFields` と、凍結の複製が同じ集合を見るための単一出所）。 */
export const CAREER_VALUE_FIELDS = [
  'periodFrom',
  'periodTo',
  'role',
  'description',
  'technologies',
] as const;

export type CareerValueField = (typeof CAREER_VALUE_FIELDS)[number];

/** 台帳に保存済みの行（`id` を必ず持つ）。 */
export type StoredCareerRow = CareerRowValues & { readonly id: string };

/** 送られてきた行。`id` があれば既存行の編集、無ければ追加。 */
export type SubmittedCareerRow = CareerRowValues & { readonly id?: string | undefined };

export type CareerRowsDiff = {
  /** `id` を持たない行（追加）。配列順は入力順（保存順は DB が決める）。 */
  readonly created: readonly SubmittedCareerRow[];
  /** `id` が一致し、**5 項目のいずれかが実際に変わった**行だけ（同じ値の再送信で監査は増えない）。 */
  readonly updated: readonly {
    readonly id: string;
    readonly before: StoredCareerRow;
    readonly after: SubmittedCareerRow;
    readonly changedFields: readonly CareerValueField[];
  }[];
  /** 保存済みだったが送られてこなかった行（削除）。 */
  readonly deleted: readonly StoredCareerRow[];
  /**
   * 🔴 `id` を持つのに保存済みの集合に無い行。呼び出し側は **404** にする（docs/05 §4.8 / §6.4:
   *    「他人の行だった」ことを応答で区別しない）。ここで黙って追加に倒さない —— 倒すと
   *    「編集したつもりが別の行として増える」うえ、監査が `create` になって嘘になる。
   */
  readonly unmatched: readonly SubmittedCareerRow[];
};

function changedFieldsOf(before: CareerRowValues, after: CareerRowValues): CareerValueField[] {
  return CAREER_VALUE_FIELDS.filter((field) => before[field] !== after[field]);
}

/**
 * 「置き換え」保存（`careers[]` は送られた集合が保存後のすべて。docs/05 §6.4 #16）を、
 * 行ごとの `create` / `update` / `delete` に分解する（`F-008 AC-5` / `docs/04` 申し送り 17-⑤）。
 *
 * 🔴 純粋関数である（`tests/static/career-audit-per-row.test.ts` が `packages/domain` の純度検査と
 *    同じ述語で固定する）。同じ `id` が `after` に 2 回現れたら `RangeError`（黙って後勝ちにすると、
 *    利用者が入力した片方の行が理由なく消える。`skills` の重複を 400 にするのと同じ判断）。
 */
export function diffCareerRows(
  before: readonly StoredCareerRow[],
  after: readonly SubmittedCareerRow[],
): CareerRowsDiff {
  const stored = new Map(before.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const created: SubmittedCareerRow[] = [];
  const updated: CareerRowsDiff['updated'][number][] = [];
  const unmatched: SubmittedCareerRow[] = [];

  for (const row of after) {
    if (row.id === undefined) {
      created.push(row);
      continue;
    }
    if (seen.has(row.id)) {
      throw new RangeError('同じ経歴の行が 2 回送られています。');
    }
    seen.add(row.id);
    const previous = stored.get(row.id);
    if (previous === undefined) {
      unmatched.push(row);
      continue;
    }
    const changedFields = changedFieldsOf(previous, row);
    if (changedFields.length > 0) {
      updated.push({ id: row.id, before: previous, after: row, changedFields });
    }
  }

  const deleted = before.filter((row) => !seen.has(row.id));
  return { created, updated, deleted, unmatched };
}

/** 凍結行の 5 項目だけを写す（余分なキー〔`id` 等〕を落とす。凍結の形をここで固定する）。 */
export function toFrozenCareer(row: CareerRowValues): FrozenCareer {
  return {
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    role: row.role,
    description: row.description,
    technologies: row.technologies,
  };
}

/** 行の区切り（ゲートの `offsetStart` / `offsetEnd` が連結後の位置を指すため、区切りも固定する）。 */
export const CAREER_INSPECTION_ROW_SEPARATOR = '\n---\n';
/** 行内の項目の区切り。 */
export const CAREER_INSPECTION_FIELD_SEPARATOR = '\n';

/**
 * 凍結された経歴を、品質ゲートの `field='snapshot'` に渡す 1 本の文字列にする
 * （docs/05 §6.5「凍結行はゲートの検査対象である」/ §11.3 `EngineerSnapshotFacts`）。
 *
 * 🔴 検査に載せるのは自由入力の 3 項目（`role` / `description` / `technologies`）だけである。
 *    期間（`YYYY-MM`）は形式が CHECK で固定されており、語が潜り込めない。
 * 🔴 行の区切りが分かる形で連結する（指摘のオフセットから「何行目か」を画面が示せるように）。
 * 🔴 0 行は空文字（ゲートは空の欄を検査対象から外す。`hasInspectableText`）。
 */
export function frozenCareersToInspectionText(careers: readonly FrozenCareer[]): string {
  return careers
    .map((row) => [row.role, row.description, row.technologies].join(CAREER_INSPECTION_FIELD_SEPARATOR))
    .join(CAREER_INSPECTION_ROW_SEPARATOR);
}
