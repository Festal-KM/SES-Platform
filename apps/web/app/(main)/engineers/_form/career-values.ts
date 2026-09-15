// apps/web/app/(main)/engineers/_form/career-values.ts
// `S-007` の経歴 1 行の画面表現（T-09-12。docs/04 §S-007 セクション 3 / docs/05 §6.4 `CareerRowInput`）。
//
// 🔴 `'use client'` を付けない純粋なモジュールにする理由: `form-props.ts`（サーバ側だけで読む）と
//    `engineer-form.tsx`（クライアント）の**両方**が同じ変換を使う。`'use client'` のモジュールから
//    値を import するとサーバ側ではクライアント参照になり呼べない（型だけなら問題ないが、関数は動かない）。

/**
 * 画面上の経歴 1 行（`EngineerCareer`）。
 * 🔴 `id` は既存行だけが持つ（追加した行は `null`）。`key` は React の描画用であり送信しない。
 * 🔴 `removed` は「保存すると削除される」印。保存前に限り取り消せる。
 */
export type EngineerFormCareer = {
  readonly key: string;
  readonly id: string | null;
  /** `YYYY-MM`。 */
  readonly periodFrom: string;
  /** `YYYY-MM`。`ongoing` のときは無視する。 */
  readonly periodTo: string;
  /** 🔴 継続中 = 終了年月を `null` で送る（空文字にしない）。 */
  readonly ongoing: boolean;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
  readonly removed: boolean;
};

/** 保存済みの行（`CareerRowView` / `#16` の応答）のうち画面が要る形。 */
export type StoredCareerRowLike = {
  readonly id: string;
  readonly periodFrom: string;
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
};

/**
 * 保存済みの行を画面の行にする。`form-props.ts`（初期値）と保存後の応答の両方が使う。
 * 🔴 `source` / `skillSheetExtractionId` は画面の入力項目ではない（出所は変えられない。docs/05 §6.4 #16b）。
 */
export function toEngineerFormCareer(row: StoredCareerRowLike): EngineerFormCareer {
  return {
    key: row.id,
    id: row.id,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo ?? '',
    ongoing: row.periodTo === null,
    role: row.role,
    description: row.description,
    technologies: row.technologies,
    removed: false,
  };
}
