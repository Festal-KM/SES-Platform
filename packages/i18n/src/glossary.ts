// packages/i18n/src/glossary.ts
// 🔴 境界と責任に関わる語の唯一の出所（docs/02 §7.11 / `BR-32` / CLAUDE.md §3.5 / §4.2。T-10-01）。
//    `index.ts` の状態ラベルはここを参照し、同じ語を 2 箇所に書かない。
//
// 🔴 語を変えるときはここだけを変える。ただし **4 つの「うまくいかなかった」は互いに別の語**でなければならない
//    （`glossary.test.ts` が固定する。`CLAUDE.md` §4.2「失敗と保留を混同しない」/ docs/02 §7.11 受け入れ基準）:
//      - `GATE_FAILED`   … 送る前に自ら止めた（直せば進む。外部には何も起きていない）
//      - `SUBMIT_FAILED` … 送信自体が失敗した（障害）
//      - `LOST`          … 提案は届いたが見送られた（業務上の終わり）
//      - `DECLINED`      … 提案依頼を断られた（提案はまだ存在しない。取引先の正当な権利の行使であり失敗ではない）
//    1 つの語（「失敗」「失効」）にまとめると成約率と障害率の両方の指標が汚れる（docs/01 章 6.4 / `BR-23` / `BR-60`）。

/**
 * 🔴 プロダクト名の唯一のリテラル（CLAUDE.md §9-1。正式名称は Issue #1 で確認中。仮称）。
 *    `product.name` と、名称を含む他の文言（`admin.console.issuer` 等）はすべてここから組み立てる。
 *    改称はこの 1 行の差し替えで済む（`tests/static/product-name-single-key.test.ts` が製品コードに直書きが無いことを固定する）。
 */
export const PRODUCT_NAME = 'SES Platform';

/**
 * docs/02 §7.11 の語。**同じ概念を画面ごとに違う語で呼ばない**ための基準語。
 * 文中で活用する場合（「承認する」「送信済み」）も、語幹はこの表と一致させる。
 */
export const GLOSSARY = {
  /** `Proposal`。案件 × エンジニア × 提案先。 */
  proposal: '提案',
  /** `ProposalRequest`。匿名候補への依頼（§3.1 経路 4）。応諾で `Proposal` になるまで「提案」ではない。 */
  proposalRequest: '提案依頼',
  /** `ProjectVisibility`。案件を取引先に見せること。 */
  publish: '公開',
  /** `EngineerShare`。パートナーが自社エンジニアを匿名で見せること。 */
  share: '共有',
  /** `APPROVAL_PENDING → APPROVED`。人間（または全層 PASS のときだけ `system`）の判断。 */
  approve: '承認',
  /** `APPROVED → SUBMITTING → SUBMITTED`。テナント外への外部送信。 */
  submit: '送信',
  /** `ReviewGate`（品質ゲート）の実行。 */
  inspect: '検査',
  /** 検査で不合格 / 承認で却下 → `DRAFT` に戻すこと。 */
  sendBack: '差し戻し',
  /** `sendHold.*`（`APPROVED` のまま外部を呼ばずに待つ）。**失敗でも見送りでもない。** */
  hold: '保留',
  /** 外部送信が失敗した（`SUBMIT_FAILED` / `SEND_FAILED`）。障害の語。 */
  failure: '失敗',
  /** `LOST`。提案が届いたうえで先方に見送られた。 */
  lost: '見送り',
  /** `Proposal.WITHDRAWN`（こちらから辞退）と、`ProposalRequest` を辞退する操作の語幹。 */
  decline: '辞退',
} as const;

/**
 * 🔴 4 つの「うまくいかなかった」の表示語（docs/04 §10.1 の状態設計マトリクスの語をそのまま採る）。
 *    `Proposal` の状態 3 つと `ProposalRequest` の状態 1 つであり、一覧・フィルタ・集計・通知のどこでも別の語で出す。
 *    `DECLINED` は `Proposal.WITHDRAWN`（= `GLOSSARY.decline`）と並ぶ画面（`S-019`）があるため「依頼を」を冠する。
 */
export const OUTCOME_LABELS = {
  GATE_FAILED: `${GLOSSARY.sendBack}（${GLOSSARY.inspect}で不合格）`,
  SUBMIT_FAILED: `${GLOSSARY.submit}${GLOSSARY.failure}`,
  LOST: GLOSSARY.lost,
  DECLINED: `依頼を${GLOSSARY.decline}`,
} as const;

export type OutcomeKind = keyof typeof OUTCOME_LABELS;

export const OUTCOME_KINDS = Object.keys(OUTCOME_LABELS) as readonly OutcomeKind[];
