// apps/worker/src/jobs/operational-mail-params.ts
// 🔴 `email.dispatch` の**差し込み値の実体**（docs/05 §9.4 の `resolveTemplateParams`）。T-05-08。
//
// ============================================================================
// 🔴 なぜ「テンプレートごとの表」にするのか
// ============================================================================
// `EmailDispatch` は差し込み値の列を持たない（docs/05 §3.9）。したがって本文に載せる値は
// **`templateKey` から決まる形で毎回組み立てる**しかない。ここに `{}` を既定として返す実装を
// 置くと、テンプレートを足した人が差し込みを忘れても**空欄のメールが黙って届く**
// （`CLAUDE.md` §11.1 の「成功したように見えて実際には起きていない」に近い壊れ方）。
// したがって**未登録の `templateKey` は例外にする**。
//
// ============================================================================
// 🔴 運用メールに業務の内容を載せない
// ============================================================================
// メールは監査もアクセス制御もできない場所である（`CLAUDE.md` §3.5 / docs/05 §16.2）。
// 隔離の周知に載せるのは**アプリへのリンク 1 つだけ**であり、氏名・エンジニア・版番号・
// ファイル名・版のメモは 1 つも載せない。「何がどうなったか」は、閲覧者自身の権限で
// 読める画面（`S-003` / `S-004` の隔離ブロック → `S-008`）が示す。
import { SKILL_SHEET_QUARANTINE_TEMPLATE_KEY } from './scan-quarantine-notice.js';

/** 🔴 差し込み値の定義が無いテンプレートで送信しようとした（実装漏れ）。握り潰さない。 */
export class UnknownOperationalMailTemplateError extends Error {
  constructor(templateKey: string) {
    super(
      `運用メールのテンプレート '${templateKey}' に差し込み値の定義がありません` +
        '（apps/worker/src/jobs/operational-mail-params.ts に追加してください。docs/05 §9.4）。',
    );
    this.name = 'UnknownOperationalMailTemplateError';
  }
}

export type OperationalMailParamsDeps = {
  /** `APP_URL`（`packages/config`）。🔴 ハンドラで組み立てず、起動時の設定から渡す。 */
  readonly appUrl: string;
};

type ParamsBuilder = (deps: OperationalMailParamsDeps) => Readonly<Record<string, unknown>>;

/**
 * 🔴 `templateKey` → 差し込み値。**ここに載っていないテンプレートは送れない。**
 *
 * ⚠️ 運用メールを足すタスク（`F-027` の上限接近通知 / `F-064` の削除予告 = SP-10 ほか）は
 *    **この表に追記する**（別の場所に分岐を作らない）。
 */
const TEMPLATE_PARAMS: Readonly<Record<string, ParamsBuilder>> = {
  // 🔴 T-05-08（`F-011` 処理④）。リンク先はホーム（`S-003` / `S-004`）である ——
  //    隔離された版の一覧は**閲覧者の境界（C3 OWNER_SCOPED）で絞られた**ホームの
  //    隔離ブロックが出す。メール側でエンジニアや版を指すと、宛先が本当に見てよい版かどうかを
  //    メールの組み立て時に判断することになり、判定が 2 実装になる。
  [SKILL_SHEET_QUARANTINE_TEMPLATE_KEY]: (deps) => ({ link: new URL('/', deps.appUrl).toString() }),
};

/**
 * 🔴 `email.dispatch` の `resolveTemplateParams` の実体（docs/05 §9.4）。
 *
 * SP-07 の配線はこれを渡す。名前を与えておく理由は `resolveSendingDomainFromDb` と同じで、
 * **「seam があるが誰も実体を渡していない」状態を配線を書く人が見落とさない**ようにするためである。
 */
export function createOperationalMailParamsResolver(
  deps: OperationalMailParamsDeps,
): (dispatch: {
  readonly templateKey: string;
  readonly dispatchId: string;
}) => Promise<Readonly<Record<string, unknown>>> {
  return async (dispatch) => {
    const build = TEMPLATE_PARAMS[dispatch.templateKey];
    if (build === undefined) throw new UnknownOperationalMailTemplateError(dispatch.templateKey);
    return build(deps);
  };
}
