// apps/web/lib/proposal-requests/message-check.ts
// 依頼メッセージの商流検証（docs/05 §3.6「`message` — 商流情報を含めない（API で検証）」/
// §6.5「#31 / #32 / #35 の実装の決着」/ `F-018` 入力 / `CLAUDE.md` §3.1 経路 4
// 「匿名候補の段階で単価の交渉をさせない」）。T-08-06。
//
// 🔴 判断（`docs/sprints/SP-08` T-08-06「ゲートの対象にするか、定型文に限るか判断して報告」）:
//    **自由記述を許し、機械的照合で商流情報を弾く。** 定型文に限る案は、依頼文の存在意義
//    （開始時期の希望・面談可能日など案件の共通部分に無い補足）を消すため退けた。
//
// 🔴 照合は `@ses/ai` の `mask()` に委ねる（**照合の 2 実装を作らない**）。単価表記
//    （`65万円` / `¥650,000` / `650,000円`）と法人格の表記ゆれを吸収する正規表現は
//    `packages/ai/src/mask.ts` の 1 か所にしかなく、品質ゲート（docs/05 §11.4）と同じ照合である。
//    ここに `/万円/` のような正規表現を書き足すと、ゲートは弾くのに依頼文は通る（またはその逆）という
//    最も気づきにくい壊れ方になる。
// 🔴 `mask()` は決定的な純粋関数であり **LLM を呼ばない**（`AiUsage` の対象外）。`apps/web` が
//    `@ses/ai` に依存する理由はこの照合だけである。
// 🔴 **これは `ReviewGate` ではない。** ゲートの対象は「テナント外へ共有されるもの」（`CLAUDE.md` §3.3）
//    であり、依頼メッセージはテナント内のホスト → 取引先の連絡である。PII の照合は掛けない
//    （対象エンジニアの PII をホストは知らず、ホスト自身の連絡先は商流情報ではない）。
// 🔴 例外・戻り値に**本文も一致した文字列も載せない**（`MaskHit` は種別と件数だけ。docs/05 §16.2）。
import { mask, type KnownSensitiveValues, type MaskCategory } from '@ses/ai';

/**
 * 商流層の種別（`GateFinding.kind` の `UNIT_PRICE` / `END_CLIENT` に対応する `MaskCategory`）。
 * 🔴 `OTHER_COMPANY`（他社名）は `mask()` に一般の会社名検出が無いため照合できない —— 台帳が知る
 *    エンド企業名（`END_CLIENT`）だけが既知値である。これは品質ゲートの機械的検出と同じ射程である。
 */
export const PROPOSAL_REQUEST_COMMERCE_CATEGORIES = ['UNIT_PRICE', 'END_CLIENT'] as const satisfies readonly MaskCategory[];

/** 照合に渡す案件の既知値（`projects` の商流列。ホストだけが読める。`F-013 AC-2`）。 */
export type ProposalRequestMessageContext = {
  readonly endClientName: string | null;
  /** 円（数値）。`null` は未登録。 */
  readonly internalUnitPrice: number | null;
  readonly unitPriceMin: number | null;
  readonly unitPriceMax: number | null;
};

export type ProposalRequestMessageCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** 検出した商流の種別（重複なし・`PROPOSAL_REQUEST_COMMERCE_CATEGORIES` の順）。本文は含まない。 */
      readonly categories: readonly (typeof PROPOSAL_REQUEST_COMMERCE_CATEGORIES)[number][];
    };

function priceValues(context: ProposalRequestMessageContext): readonly string[] {
  return [context.internalUnitPrice, context.unitPriceMin, context.unitPriceMax]
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .map((value) => String(value));
}

/**
 * 依頼メッセージに商流情報（単価・エンド企業名）が含まれていないか。
 *
 * 🔴 既知値（案件の内部単価・公開単価レンジ・エンド企業名）と、`mask()` のパターン検出
 *    （`¥` / `万円` / `円` を伴う金額）の両方を見る。**公開単価レンジも弾く**のは、匿名候補の段階で
 *    単価の話をさせないため（`BR-58`）—— 取引先には `S-018` が案件の共通部分として単価レンジを
 *    見せるので、依頼文で繰り返す必要が無い。
 */
export function checkProposalRequestMessage(
  message: string,
  context: ProposalRequestMessageContext,
): ProposalRequestMessageCheck {
  const known: KnownSensitiveValues = {
    fullNames: [],
    birthDates: [],
    emails: [],
    phones: [],
    affiliations: [],
    unitPrices: priceValues(context),
    endClientNames: context.endClientName === null ? [] : [context.endClientName],
  };
  const { hits } = mask(message, known);
  const found = PROPOSAL_REQUEST_COMMERCE_CATEGORIES.filter((category) =>
    hits.some((hit) => hit.category === category && hit.count > 0),
  );
  return found.length === 0 ? { ok: true } : { ok: false, categories: found };
}
