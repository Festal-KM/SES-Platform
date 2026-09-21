// packages/domain/src/gate/project-publish.ts
// 🔴 公開後の再検査と自動解除（T-12-10。docs/05 §11.11「T-12-10 の実装の決着」①②⑤⑥⑨ /
//    `F-014 AC-6`〜`AC-13` / `UC-26` / [Issue #42](https://github.com/Festal-KM/SES-Platform/issues/42) = 回答②）。
//
// ============================================================================
// 🔴 このファイルが持つ「守るべき 1 行」
// ============================================================================
// **公開の瞬間に検査を通した内容が、後から商流情報を含む状態で取引先に見え続ける経路を塞ぐ。**
// そのために増やしてよいのは「再検査を起こす契機」と「FAIL のときに公開中の行を落とす確定」だけで
// あり、公開範囲の行を作る / 落とす場所は `settleProjectPublish` の 1 か所のままである（`AC-13`）。
//
// ============================================================================
// 🔴 なぜ `packages/domain` に置くか（`CLAUDE.md` §2.1）
// ============================================================================
//   ① 契機の判定（3 欄の値の比較）は `apps/web`（#26）が行うが、値を読むのは `packages/db` である
//   ② 公開の状態の導出（4 値）は `apps/web`（#27 / #25）が行うが、判定の規則は 1 つでなければ
//      「詳細と一覧が同じ 0 社を別の言葉で説明する」（`docs/04` §S-010 の 3 値目の理由そのもの）
//   ③ DB・ネットワーク・現在時刻を 1 つも持たない純粋関数である（時刻は呼び出し側が ISO 文字列で渡す）
//
// 🔴 **表示文字列を 1 つも持たない。** 返すのは欄のコードと状態の語だけであり、
//    「案件名 / 外部公開用の記載 / 要件の自由記述」の語は `packages/i18n` にある（`CLAUDE.md` §3.5）。

import type { GateFinding } from './types.js';
import type { GateHeldView } from './view.js';

/**
 * 🔴 公開先が読む自由入力の欄。**閉集合。**
 *
 * 🔴 **同じ「3 欄」が 3 つの型に現れる**（docs/05 §11.11「T-12-10 の実装の決着」⑨）:
 *    ①`GATE_FINDING_FIELDS` の `project_name` / `public_summary` / `requirement`（ゲートが検査する欄）
 *    ②`apps/web/lib/projects/publish-preview.ts` の `PUBLISHED_FIELDS`（`S-013` のプレビューの警告）
 *    ③本定数（#26 の変更検知 / 自動解除の原因の欄 / `S-012` の「この欄は公開先が読む」印）
 *    ずれると「プレビューに出ないのに FAIL する」「FAIL したのに原因の欄が出ない」が起きるため、
 *    3 者の 1 対 1 を `project-publish.test.ts` が固定する。
 * 🔴 **語の違い（`requirement` と `requirementFreeText`）を揃えるために既存の 2 つを改名しない** ——
 *    `GATE_FINDING_FIELDS` は `ReviewGate.findings`（JSON）に保存済みの値であり、改名は過去の行の
 *    読み替えを要求する。
 */
export const PROJECT_PUBLIC_FIELDS = ['name', 'publicSummary', 'requirementFreeText'] as const;

export type ProjectPublicField = (typeof PROJECT_PUBLIC_FIELDS)[number];

/**
 * 🔴 `GateFinding.field` → 公開欄（⑨ の写像）。3 欄に写せない `field` は `undefined` になる。
 *    `Record` で書くと `GATE_FINDING_FIELDS` が増えたときに全件の割り当てを強制されるため、
 *    **3 件だけの写像として持つ**（提案側の欄が増えても案件の原因の欄は変わらない）。
 */
const FINDING_FIELD_TO_PUBLIC_FIELD: Readonly<Record<string, ProjectPublicField>> = {
  project_name: 'name',
  public_summary: 'publicSummary',
  requirement: 'requirementFreeText',
};

/** 🔴 ⑨ の 1 対 1 をテストが読むための写像（`packages/domain` の外から書き換えない）。 */
export const PROJECT_PUBLIC_FIELD_BY_GATE_FINDING_FIELD = FINDING_FIELD_TO_PUBLIC_FIELD;

/**
 * 🔴 `ProjectPublishRequest.kind`（docs/05 §3.5 の CHECK）。
 *
 * - `PUBLISH` … `#28`（相手を増やす）。FAIL は「追加しない」だけで、**公開中の行は落とさない**
 * - `RECHECK` … `#26`（公開中の内容を検査し直す）。FAIL は**公開中の行をすべて落とす**
 *
 * 🔴 **FAIL の意味が違うので 1 つの行に混ぜない**（②）。判定は `audience` に対する相対的なもので
 *    あり、`{A}` に公開中の案件へ B を足す要求が FAIL しても `{A}` だけには同じ本文が適法である。
 */
export const PROJECT_PUBLISH_REQUEST_KINDS = ['PUBLISH', 'RECHECK'] as const;

export type ProjectPublishRequestKind = (typeof PROJECT_PUBLISH_REQUEST_KINDS)[number];

/**
 * 🔴 `ReviewGate.run_trigger`（docs/05 §3.6 の CHECK）。**この行を作った実行の契機**。
 *    `PROJECT_PUBLISH` のときだけ値を持つ（`S-013` セクション 4 のラベルの出所）。
 *    値は `ProjectPublishRequestKind` と同じ 2 語だが、**別の列・別の意味**なので別の定数にする
 *    （要求の種類 ＝「何を頼んだか」/ 契機 ＝「この結果を生んだのはどの実行か」）。
 */
export const PROJECT_PUBLISH_RUN_TRIGGERS = ['PUBLISH', 'RECHECK'] as const;

export type ProjectPublishRunTrigger = (typeof PROJECT_PUBLISH_RUN_TRIGGERS)[number];

/**
 * 🔴 `ProjectVisibility.revoked_reason`（docs/05 §3.5 の CHECK）。
 *    **「公開先が 0 社」という事実だけから画面に推測させない**ための列である
 *    （未公開 = 設定し忘れ と 自動解除 を区別する。`docs/04` §S-010 / §S-011）。
 */
export const PROJECT_VISIBILITY_REVOKE_REASONS = ['MANUAL', 'GATE_RECHECK'] as const;

export type ProjectVisibilityRevokeReason = (typeof PROJECT_VISIBILITY_REVOKE_REASONS)[number];

export type ProjectPublicFieldValues = {
  readonly name: string;
  readonly publicSummary: string | null;
  /** 🔴 `readProjectRequirementTexts`（`packages/db`）が返す順（`kind` → `id` 昇順、空文字は除外済み）。 */
  readonly requirementFreeTexts: readonly string[];
};

/**
 * 🔴 公開欄 3 欄が**実際に変わったか**（`AC-6`。docs/05 §11.11「T-12-10 の実装の決着」①）。
 *
 * 🔴 **`PROJECT_PUBLISH` の `contentHash` を契機に使わない。** ハッシュの材料は公開先の集合と
 *    取引先すべての社名を含むので、**公開先を 1 社増やしただけ・社名が変わっただけで動く**。
 *    それを契機にすると `AC-6`（3 欄が実際に変わったときに限る）に反し、AI 原価が無用に増える。
 * 🔴 **完全一致で比較する**（trim / 正規化をここで足さない —— 揃えるならハッシュ側〔`gateHashSource`〕と
 *    両方を同時に変える。片方だけ緩めると「検知は変わったと言うがハッシュは同じ」が起きる）。
 * 🔴 `null`（未入力）と `''`（空文字で保存）は**別の値として扱う**（`publicSummary`）。
 */
export function projectPublicFieldsChanged(
  before: ProjectPublicFieldValues,
  after: ProjectPublicFieldValues,
): boolean {
  if (before.name !== after.name) return true;
  if (before.publicSummary !== after.publicSummary) return true;
  if (before.requirementFreeTexts.length !== after.requirementFreeTexts.length) return true;
  return before.requirementFreeTexts.some((text, index) => text !== after.requirementFreeTexts[index]);
}

/**
 * 🔴 自動解除の**原因の欄**をゲートの指摘から導く（`docs/04` 申し送り 21 ②）。
 *
 * 規則: **`severity='BLOCK'` かつ `layer ∈ {'PII','COMMERCE'}` の指摘だけ**を見て、`field` を
 * 3 欄に写し、**`PROJECT_PUBLIC_FIELDS` の宣言順**で重複なく返す。3 欄に写せない `field` は無視する。
 *
 * 🔴 `WARN`（`aiWarnings` 側）と整合層の指摘を拾わない —— 合否を作るのは `BLOCK` だけであり
 *    （`BR-61`）、警告を原因として並べると「直しても解除が戻らない欄」を示すことになる。
 * 🔴 **指摘の本文（`excerpt`）を返さない。** 商流層の指摘はエンド企業名そのものであり、
 *    案件詳細（`S-011`）に常時表示される経路を作らない（本文を読む場所は `S-013` セクション 4 だけ）。
 */
export function projectPublicFieldsFromFindings(
  findings: readonly GateFinding[],
): readonly ProjectPublicField[] {
  const hit = new Set<ProjectPublicField>();
  for (const finding of findings) {
    if (finding.severity !== 'BLOCK') continue;
    if (finding.layer !== 'PII' && finding.layer !== 'COMMERCE') continue;
    const field = FINDING_FIELD_TO_PUBLIC_FIELD[finding.field];
    if (field !== undefined) hit.add(field);
  }
  return PROJECT_PUBLIC_FIELDS.filter((field) => hit.has(field));
}

/**
 * 自動解除の原因（`docs/04` §S-011 の帯）。
 *
 * 🔴 **判定不能（LLM の失敗・タイムアウト・スキーマ違反）は FAIL であって保留ではない**
 *    （`docs/02` A-26 の既定①）。画面は前者で欄名を並べ、後者で「検査を完了できなかったため
 *    公開を解除しました」を描く（`docs/04` §S-013）。
 * 🔴 **`fields` が空の `GATE_FINDINGS` を型として作らない**（非空タプルで縛る）。
 */
export type ProjectPublishRevocationCause =
  | {
      readonly kind: 'GATE_FINDINGS';
      readonly fields: readonly [ProjectPublicField, ...ProjectPublicField[]];
    }
  | { readonly kind: 'GATE_INCONCLUSIVE'; readonly fields?: never };

/** 直近のゲート実行 1 件（`S-011` の帯と `S-013` セクション 4 が同じ材料を読む）。 */
export type ProjectPublishGateRef = {
  readonly reviewGateId: string;
  /** 🔴 `review_gates.run_trigger`（docs/05 §3.6）。`公開の実行` / `公開欄の編集による再検査`。 */
  readonly runTrigger: ProjectPublishRunTrigger;
  readonly execution: 'DONE' | 'HELD_AI_COST_LIMIT';
  /** `DONE` のとき ISO 8601。 */
  readonly executedAt: string | null;
  /** `HELD_AI_COST_LIMIT` のとき ISO 8601。 */
  readonly heldSince: string | null;
};

export type ProjectPublishRevocation = {
  /** ISO 8601。確定の時刻。 */
  readonly revokedAt: string;
  /** 🔴 **件数だけ**（社名は帯に出さない。`docs/04` §S-011）。 */
  readonly revokedPartnerCount: number;
  /** 「指摘を見る」の導線（`S-013` セクション 4）。 */
  readonly reviewGateId: string;
  readonly cause: ProjectPublishRevocationCause;
};

/**
 * 🔴 公開の状態（`docs/04` §S-011 の 4 値。**判別可能な合併**）。
 *
 * 🔴 **`revocation`（FAIL）と `held`（保留）は別の枝の別のフィールドである。** 1 つの `reason` に
 *    畳まない —— 画面は前者で「公開を解除しました（今すぐ直す）」、後者で「公開は維持されています
 *    （待つ）」と**逆のこと**を書く（`AC-12`）。**型としてどちらか一方しか読めない。**
 */
export type ProjectPublishStateView =
  | {
      readonly state: 'UNPUBLISHED';
      readonly visibleToCount: 0;
      readonly revocation?: never;
      readonly held?: never;
      readonly recheckRunning?: never;
      readonly latestGate: ProjectPublishGateRef | null;
    }
  | {
      readonly state: 'PUBLISHED';
      readonly visibleToCount: number;
      readonly revocation?: never;
      readonly held?: never;
      /** 🔴 再検査のジョブが走っている（= 未消費の `RECHECK` 要求があり、保留行が無い）。公開は維持。 */
      readonly recheckRunning: boolean;
      readonly latestGate: ProjectPublishGateRef | null;
    }
  | {
      readonly state: 'AUTO_REVOKED';
      readonly visibleToCount: 0;
      readonly revocation: ProjectPublishRevocation;
      readonly held?: never;
      readonly recheckRunning?: never;
      readonly latestGate: ProjectPublishGateRef | null;
    }
  | {
      readonly state: 'PUBLISHED_RECHECK_HELD';
      readonly visibleToCount: number;
      readonly revocation?: never;
      /** 🔴 §11.7 の `GateHeldView` **そのもの**（`usageHref` を足さない。`docs/04` `U-19`）。 */
      readonly held: GateHeldView;
      readonly recheckRunning?: never;
      readonly latestGate: ProjectPublishGateRef | null;
    };

/**
 * 一覧（`#25` / `S-010` の公開状況列）の 3 値。
 * 🔴 **保留は一覧で区別しない**（公開は維持されているので `PUBLISHED`）。したがって一覧は
 *    `project_publish_requests` も `review_gates` も読まない（`docs/04` §S-010）。
 */
export const PROJECT_PUBLISH_LIST_STATUSES = ['UNSET', 'PUBLISHED', 'AUTO_REVOKED'] as const;

export type ProjectPublishListStatus = (typeof PROJECT_PUBLISH_LIST_STATUSES)[number];

/** 「最後に解除された行」（`revoked_at DESC → id DESC` の 1 行）。 */
export type ProjectPublishLastRevoked = {
  readonly reason: ProjectVisibilityRevokeReason;
  /** ISO 8601。 */
  readonly revokedAt: string;
  /** 🔴 `'GATE_RECHECK'` のとき非 null（docs/05 §3.5 の CHECK）。 */
  readonly reviewGateId: string | null;
  /** その `revoked_review_gate_id` で落ちた行の数（帯の「N 社」）。 */
  readonly partnerCount: number;
};

/**
 * 🔴 一覧と詳細が**同じ規則**で 0 社を読み分ける（docs/05 §11.11「T-12-10 の実装の決着」⑤⑥）。
 *
 * 🔴 根拠は **`project_visibilities.revoked_reason` 列**であり、「公開先が 0 社」という事実からの
 *    推測ではない。`latestGate` も見ない —— 自動解除の後にホストが公開し直して FAIL すると
 *    `latestGate` は `PUBLISH` の FAIL になるが、その案件は依然として「再検査で落ちたまま」である
 *    （行の事実 > 直近の実行）。
 */
export function projectPublishListStatus(input: {
  readonly liveVisibilityCount: number;
  readonly lastRevokedReason: ProjectVisibilityRevokeReason | null;
}): ProjectPublishListStatus {
  if (input.liveVisibilityCount > 0) return 'PUBLISHED';
  return input.lastRevokedReason === 'GATE_RECHECK' ? 'AUTO_REVOKED' : 'UNSET';
}

/** 🔴 入力は `packages/db` / `apps/web` 側が materialize する（domain に I/O と現在時刻を持ち込まない）。 */
export type DeriveProjectPublishStateInput = {
  /** `project_visibilities` の `revoked_at IS NULL` の件数。 */
  readonly liveVisibilityCount: number;
  /** 🔴 **最後に解除された行**。1 度も解除していなければ `null`。 */
  readonly lastRevoked: ProjectPublishLastRevoked | null;
  /** 未消費の `kind='RECHECK'` の公開要求があるか。 */
  readonly recheckPending: boolean;
  /** 🔴 `listReviewGateResults` の先頭 1 行を写したもの（無ければ `null`）。 */
  readonly latestGate: ProjectPublishGateRef | null;
  /** `latestGate.execution === 'HELD_AI_COST_LIMIT'` のときだけ渡す（`heldViewFor` が組み立てる）。 */
  readonly latestGateHeld: GateHeldView | null;
  /** 🔴 `lastRevoked.reviewGateId` が指す行の中身（原因の欄の導出にだけ使う）。 */
  readonly revokingGate: {
    readonly findings: readonly GateFinding[];
    readonly aiFailed: boolean;
  } | null;
};

/**
 * 🔴 `cause.kind` の決め方（docs/05 §11.11「T-12-10 の実装の決着」⑤）:
 *   ①`aiFailed = true` なら**無条件に** `GATE_INCONCLUSIVE`（機械的検出が欄を特定できていても、である。
 *     検査の一部が完了していないことのほうが重要で、「この欄だけ直せば通る」と読ませてはならない）
 *   ②そうでなく `fields` が 1 つ以上あれば `GATE_FINDINGS`
 *   ③`fields` が空なら `GATE_INCONCLUSIVE`（欄に帰せない FAIL）
 */
function revocationCause(
  gate: DeriveProjectPublishStateInput['revokingGate'],
): ProjectPublishRevocationCause {
  if (gate === null || gate.aiFailed) return { kind: 'GATE_INCONCLUSIVE' };
  const fields = projectPublicFieldsFromFindings(gate.findings);
  const [first, ...rest] = fields;
  if (first === undefined) return { kind: 'GATE_INCONCLUSIVE' };
  return { kind: 'GATE_FINDINGS', fields: [first, ...rest] };
}

/**
 * 🔴 公開の状態を 4 値で導く（`#27` のホストの枝だけが呼ぶ。`docs/04` 申し送り 21 ①③④）。
 *
 * | 条件 | `state` |
 * |---|---|
 * | 生きている行 ≥ 1 かつ 未消費の `RECHECK` 要求 かつ 直近が `HELD_AI_COST_LIMIT` | `PUBLISHED_RECHECK_HELD` |
 * | 生きている行 ≥ 1（上以外） | `PUBLISHED`（`recheckRunning` = 未消費の `RECHECK` 要求があるか） |
 * | 生きている行 = 0 かつ 最後に解除された行の理由が `GATE_RECHECK` | `AUTO_REVOKED` |
 * | 生きている行 = 0（上以外） | `UNPUBLISHED` |
 *
 * ⚠️ **`PUBLISHED_RECHECK_HELD` の判定に `latestGate.runTrigger` を使わない。** 保留行は対象ごとに
 *    高々 1 行（§3.6 の部分 UNIQUE）で常に先頭に来るので、`recheckPending && execution='HELD…'` で足りる。
 *    契機で分岐させると、同じ「上限で止まっている」を 2 通りに描くことになる。
 *
 * @throws RangeError 保留の枝なのに `latestGateHeld` が無いとき（`toGateResultView` と同じ規律で、
 *         「保留なのに理由が描けない」状態を黙って通さない）。
 */
export function deriveProjectPublishState(
  input: DeriveProjectPublishStateInput,
): ProjectPublishStateView {
  const status = projectPublishListStatus({
    liveVisibilityCount: input.liveVisibilityCount,
    lastRevokedReason: input.lastRevoked?.reason ?? null,
  });

  if (status === 'PUBLISHED') {
    if (input.recheckPending && input.latestGate?.execution === 'HELD_AI_COST_LIMIT') {
      if (input.latestGateHeld === null) {
        throw new RangeError(
          '保留中の再検査なのに GateHeldView がありません（docs/05 §11.11「T-12-10 の実装の決着」⑤）。',
        );
      }
      return {
        state: 'PUBLISHED_RECHECK_HELD',
        visibleToCount: input.liveVisibilityCount,
        held: input.latestGateHeld,
        latestGate: input.latestGate,
      };
    }
    return {
      state: 'PUBLISHED',
      visibleToCount: input.liveVisibilityCount,
      recheckRunning: input.recheckPending,
      latestGate: input.latestGate,
    };
  }

  // 🔴 `projectPublishListStatus` が `AUTO_REVOKED` を返す条件そのものが
  //    「`lastRevoked` の理由が `GATE_RECHECK`」なので、この枝で `lastRevoked` は必ず非 null である。
  const lastRevoked = input.lastRevoked;
  if (status === 'AUTO_REVOKED' && lastRevoked !== null) {
    if (lastRevoked.reviewGateId === null) {
      // 🔴 `'GATE_RECHECK'` の行は `revoked_review_gate_id` を必ず持つ（docs/05 §3.5 の CHECK）。
      //    壊れていたら握り潰さない（「指摘を見る」の導線が無い帯を描かない）。
      throw new RangeError(
        "revoked_reason='GATE_RECHECK' の行に revoked_review_gate_id がありません（docs/05 §3.5 の CHECK が壊れています）。",
      );
    }
    return {
      state: 'AUTO_REVOKED',
      visibleToCount: 0,
      revocation: {
        revokedAt: lastRevoked.revokedAt,
        revokedPartnerCount: lastRevoked.partnerCount,
        reviewGateId: lastRevoked.reviewGateId,
        cause: revocationCause(input.revokingGate),
      },
      latestGate: input.latestGate,
    };
  }

  return { state: 'UNPUBLISHED', visibleToCount: 0, latestGate: input.latestGate };
}
