// packages/domain/src/gate/input.ts
// 🔴 品質ゲート（`F-020`）の入力（docs/05 §11.3）。T-07-06。
//
// ============================================================================
// 🔴 対象種別ごとに別の型にした（docs/05 §11.8 ② の申し送りの解消）
// ============================================================================
// §11.3 のスケッチは 1 つの `GateInput` に `snapshot?` / `requirements?` /
// `registeredSkills?` / `text: { subject?, body?, publicSummary? }` を任意項目として並べていた。
// その形は次の壊れ方を**型として許してしまう**:
//
//   ① 提案なのに `subject`（＝ 整合層の照合対象。`ConsistencySubject`）を渡し忘れる
//      → 必須要件の照合が黙って行われないのに整合層は PASS（`F-020` の中核が空回りする）
//   ② 案件の公開なのに `snapshot` を渡す
//      → 案件について何も主張していないのに「主張と台帳の矛盾」を検査したことになる
//   ③ 案件の公開の指摘に `field='snapshot'` が付く
//      → 承認画面（`S-013` / `S-020`）が存在しない欄をハイライトしようとする
//
// したがって **対象種別（`targetType`）で判別する合併**にし、欄（`GateFindingField`）も
// 種別ごとに絞る。`decideConsistency` へ渡す `consistency` も、提案では `subject` 必須・
// それ以外では `subject` を**渡せない**（`?: undefined`）形にした。
//
// 🔴 **依存の向きは `GateInput` → `ConsistencyInput`** である（§11.8 ②）。逆にすると
//    `decideConsistency` の引数型に `text` / `forbiddenTerms` / `knownPii` が現れ、
//    §17.2 #9（引数型に AI 由来の型・自由文が現れない）の検査が実質的に成立しなくなる。

import type { ConsistencyInput, ConsistencySubject } from './consistency.js';
import type { GateAudienceKind, GateFindingField } from './types.js';

/**
 * 検査対象が共有される相手（docs/05 §11.3 `GateInput.audience`）。
 *
 * 🔴 `kind` で商流層の判定基準が変わる（`PARTNER` = 取引先 / `EXTERNAL_CLIENT` = 提案先）。
 * 🔴 `partnerCompanyIds` は **この検査で共有先になる会社**である。ここに載っていない会社の名前が
 *    本文に出ていたら「他社の露出」（`CLAUDE.md` §3.1 の 🔴）であり、その判定材料として
 *    `forbiddenTerms.otherCompanyNames` を組み立てるのは**入力を用意する側**の責務である
 *    （ゲート本体は `forbiddenTerms` しか見ない = 判定基準が 1 箇所に残る）。
 */
export type GateAudience = {
  readonly kind: GateAudienceKind;
  readonly partnerCompanyIds: readonly string[];
};

/**
 * 検査する欄 1 つ。
 *
 * 🔴 `text` は**テナント外へ出る内容そのもの**（マスキング前）である。マスキングは
 *    「LLM に送るとき」にだけ行う（`BR-11`）—— ここでマスク済みの文字列を受け取ると、
 *    機械的 PII 検出（§11.4）が「既に伏せられた本文」を見ることになり、
 *    **台帳の氏名が本文に残っていても検出できない**（`F-020 AC-5` が空振りする）。
 */
export type GateSection<F extends GateFindingField> = {
  readonly field: F;
  readonly text: string;
};

/**
 * その公開範囲で出してはならない語（docs/05 §11.3 `GateInput.forbiddenTerms`）。
 *
 * 🔴 「出してはならないか」を決めるのは**入力を用意する側**である。たとえば提案先へ提示する
 *    単価（`Proposal.offeredUnitPrice`）は出してよく、案件の内部単価（`Project.internalUnitPrice`）は
 *    出してはならない。ゲート本体にこの区別を持たせると、対象種別が増えるたびに判定が分岐する。
 */
export type GateForbiddenTerms = {
  readonly unitPrices: readonly string[];
  readonly endClientNames: readonly string[];
  readonly otherCompanyNames: readonly string[];
};

/**
 * 台帳が持つ PII（`BR-11` の 5 種のうちテキストで扱える 4 種 + 生年月日）。
 *
 * 🔴 **氏名は台帳が持つ全表記を渡す**（漢字・カナ・ローマ字の列があれば全部。docs/05 §7.13 ②-2）。
 *    表記の欠けはそのまま漏れになる —— 既知値置換（主）が拾えなかった表記は、
 *    パターン検出（補助）では拾えない（氏名に形の手掛かりが無いため）。
 *    機械的 PII 検出（§11.4）も同じ集合を使うので、欠けると
 *    **AI の見落としに対する保険まで同時に外れる**。
 */
export type GateKnownPii = {
  readonly fullNames: readonly string[];
  readonly birthDates: readonly string[];
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  readonly affiliations: readonly string[];
};

type GateInputBase<F extends GateFindingField> = {
  readonly targetId: string;
  /** 🔴 §11.5。この内容のハッシュ。`ReviewGate.contentHash` にそのまま保存する。 */
  readonly contentHash: string;
  readonly audience: GateAudience;
  /** 🔴 少なくとも 1 欄が非空であること（空だと検査するものが無い = PASS にしてはならない）。 */
  readonly sections: readonly GateSection<F>[];
  readonly forbiddenTerms: GateForbiddenTerms;
  readonly knownPii: GateKnownPii;
};

/** 🔴 提案は**必ず**整合層の照合対象を持つ（渡し忘れをコンパイルエラーにする）。 */
type ProposalConsistencyInput = ConsistencyInput & { readonly subject: ConsistencySubject };

/**
 * 🔴 エンジニアについて何も主張しない対象は、照合対象を**渡せない**
 *    （`subject?: undefined` により値を書くとコンパイルエラー。docs/05 §11.8 ②）。
 */
type SubjectlessConsistencyInput = ConsistencyInput & { readonly subject?: undefined };

/** 提案（越境経路 2）。欄は件名・本文・凍結された主張の 3 つ。 */
export type ProposalGateInput = GateInputBase<'subject' | 'body' | 'snapshot'> & {
  readonly targetType: 'PROPOSAL';
  readonly consistency: ProposalConsistencyInput;
};

/** 案件の公開（越境経路 1）。欄は公開用の記載だけ（`Project.publicSummary`）。 */
export type ProjectPublishGateInput = GateInputBase<'public_summary'> & {
  readonly targetType: 'PROJECT_PUBLISH';
  readonly consistency: SubjectlessConsistencyInput;
};

/** スキルシートの外部共有（`F-011`）。欄は添付そのもの。 */
export type SkillSheetShareGateInput = GateInputBase<'attachment'> & {
  readonly targetType: 'SKILL_SHEET_SHARE';
  readonly consistency: SubjectlessConsistencyInput;
};

/**
 * 🔴 ゲートの入力（Phase 1 の 3 種）。
 *
 * ⚠️ `CHAT_ATTACHMENT`（Phase 2 / `F-038`）と `CONTRACT_DOCUMENT`（Phase 3 / `F-047`）は
 *    ここに**まだ無い**。足すときは `GateInputBase` の欄を種別に合わせて絞ること
 *    （契約書の整合層は `mergeResult.unfilled` の照合であり、`ConsistencySubject` とは
 *    型を共用しない。docs/05 §11.8 ⑦-4）。
 */
export type GateInput = ProposalGateInput | ProjectPublishGateInput | SkillSheetShareGateInput;

/** `GateInput` が扱える対象種別（`PHASE1_GATE_TARGET_TYPES` と一致することを型で固定する）。 */
export type GateInputTargetType = GateInput['targetType'];

/** 🔴 `sections` に非空の欄が 1 つも無い入力を、検査したことにしない（`F-020 AC-1`）。 */
export function hasInspectableText(input: GateInput): boolean {
  return input.sections.some((section) => section.text.trim().length > 0);
}
