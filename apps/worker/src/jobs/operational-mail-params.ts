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
//
// ✅ T-10-12: 組み立てに **`EmailDispatch` の行（`dedupeKey`）とテナント文脈（`ctx`）**を渡せるようにした。
//    削除予告（`TENANT_CLOSING_NOTICE`）は「削除予定日」を本文に明記する要件（`F-064 AC-10` / docs/05 §9.7）を持ち、
//    その値は `tenants.closing_entered_at`（テナント文脈で読む）と段（`dedupeKey` の `targetId` に載る）から決まる。
//    既存のテンプレート（リンク 1 つ）は引数を無視するだけで、形は変わらない。
import { readTenantClosingSchedule, type SystemTenantCtx } from '@ses/db';
import {
  closingNoticeSchedule,
  parseClosingNoticeDedupeKey,
  TENANT_CLOSING_NOTICE_TEMPLATE_KEY,
  usagePeriodKey,
  type TenantClosingNoticePhase,
} from '@ses/domain';
import { t } from '@ses/i18n';
import { SKILL_SHEET_QUARANTINE_TEMPLATE_KEY } from './scan-quarantine-notice.js';
import { QUOTA_LOWERED_TEMPLATE_KEY, USAGE_LIMIT_NOTICE_TEMPLATE_KEY } from './usage-limit-notice.js';

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

/**
 * 🔴 削除予告の行から段を復元できない（`dedupeKey` が `tenant.closing-notify` の規約と合わない）。
 *    黙って `ENTERED` の本文で送らない —— 「7 日前」の予告が「入った日」の文面で届くと、期日の切迫が伝わらない。
 */
export class InvalidClosingNoticeDispatchError extends Error {
  constructor(readonly dispatchId: string) {
    super(
      'TENANT_CLOSING_NOTICE の EmailDispatch から段（ENTERED / D7）を復元できませんでした' +
        '（dedupeKey が tenant.closing-notify の規約と合いません。docs/05 §9.7）。',
    );
    this.name = 'InvalidClosingNoticeDispatchError';
  }
}

/**
 * 🔴 削除予告を送る時点でテナントが `CLOSING` の材料（`closing_entered_at`）を持っていない。
 *    削除予定日を計算できないので送らない（`null` の日付を本文に載せない）。
 */
export class ClosingNoticeScheduleUnavailableError extends Error {
  constructor(readonly dispatchId: string) {
    super(
      'TENANT_CLOSING_NOTICE を送る時点で tenants.closing_entered_at が無く、削除予定日を計算できません（docs/05 §9.7）。',
    );
    this.name = 'ClosingNoticeScheduleUnavailableError';
  }
}

export type OperationalMailParamsDeps = {
  /** `APP_URL`（`packages/config`）。🔴 ハンドラで組み立てず、起動時の設定から渡す。 */
  readonly appUrl: string;
  /** `TENANT_PURGE_GRACE_DAYS`（`packages/config`。既定 30）。削除予告の「削除予定日」の計算に使う。ハードコードしない。 */
  readonly purgeGraceDays: number;
};

/** 差し込み値の組み立てに渡す `EmailDispatch` の行（本文・宛先は含まない。`dedupeKey` は段の復元に使う）。 */
export type OperationalMailDispatchRef = {
  readonly templateKey: string;
  readonly dispatchId: string;
  readonly dedupeKey: string;
};

type ParamsBuilder = (
  deps: OperationalMailParamsDeps,
  dispatch: OperationalMailDispatchRef,
  ctx: SystemTenantCtx,
) => Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>;

/**
 * 🔴 `S-042`（データの返却と保持期間）のパス。T-10-09 が画面を実装する。**URL だけ**を本文に載せる
 *    （画面の実装状況を本文に書かない）。T-10-09 でパスが違う形に決まったら、ここ 1 箇所を直す。
 */
const RETENTION_SCREEN_PATH = '/settings/retention';

/**
 * 🔴 T-10-12（`F-064 AC-10` / docs/05 §9.7）。削除予告の本文。載せるのは**テナント名・削除予定日・返却画面の URL**だけ
 *    （件数の内訳・個人情報を載せない）。文言は `packages/i18n`（`email.tenantClosingNotice.*`）、値の連結だけをここで行う。
 *
 *   - 段（`ENTERED` / `D7`）は `dedupeKey` の `targetId` から復元する（`tenant.closing-notify` が書いた規約の逆）。
 *   - 削除予定日は送る時点の `tenants.closing_entered_at + purgeGraceDays`（JST 暦日）。`closing_entered_at` は `CLOSING` に
 *     入った後は変わらないので、起票時に計算した値と一致する。
 */
async function tenantClosingNoticeParams(
  deps: OperationalMailParamsDeps,
  dispatch: OperationalMailDispatchRef,
  ctx: SystemTenantCtx,
): Promise<Readonly<Record<string, unknown>>> {
  const parsed = parseClosingNoticeDedupeKey(dispatch.dedupeKey);
  if (parsed === null || parsed.tenantId !== ctx.tenantId) throw new InvalidClosingNoticeDispatchError(dispatch.dispatchId);
  const tenant = await readTenantClosingSchedule(ctx);
  if (tenant.closingEnteredAt === null) throw new ClosingNoticeScheduleUnavailableError(dispatch.dispatchId);
  const { purgeScheduledOn } = closingNoticeSchedule({
    closingEnteredDayKey: usagePeriodKey('DAY', tenant.closingEnteredAt),
    graceDays: deps.purgeGraceDays,
  });
  const link = new URL(RETENTION_SCREEN_PATH, deps.appUrl).toString();
  return {
    subject: t('email.tenantClosingNotice.subject'),
    body: renderTenantClosingNoticeBody({ tenantName: tenant.name, phase: parsed.phase, purgeScheduledOn, link }),
    tenantName: tenant.name,
    phase: parsed.phase,
    purgeScheduledOn,
    link,
  };
}

/** 本文（プレーンテキスト）。SES 側テンプレートは `{{body}}` を置くか、`tenantName` / `purgeScheduledOn` / `link` を個別に使う。 */
export function renderTenantClosingNoticeBody(input: {
  readonly tenantName: string;
  readonly phase: TenantClosingNoticePhase;
  readonly purgeScheduledOn: string;
  readonly link: string;
}): string {
  const lead = input.phase === 'D7' ? t('email.tenantClosingNotice.lead.D7') : t('email.tenantClosingNotice.lead.ENTERED');
  return [
    `${input.tenantName}${t('email.tenantClosingNotice.greeting.suffix')}`,
    '',
    lead,
    `${t('email.tenantClosingNotice.purgeDate.prefix')}${input.purgeScheduledOn}${t('email.tenantClosingNotice.purgeDate.suffix')}`,
    '',
    t('email.tenantClosingNotice.export.lead'),
    input.link,
    '',
    t('email.tenantClosingNotice.contact'),
    '',
    t('product.name'),
  ].join('\n');
}

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
  // 🔴 T-10-03（`F-027` 処理④ / `AC-4` / `AC-6`）。上限接近・到達の通知。**差し込みはリンク 1 つだけ** ——
  //    どの上限が・どこまで・いつリセットされるかは `S-038`（`/settings/usage`。閲覧者の権限で読める）が示す。
  //    金額・残量・上限値を本文に載せない（テナント側の通知に金額表示を 1 つも作らない。`BR-24`）。
  [USAGE_LIMIT_NOTICE_TEMPLATE_KEY.NEARING]: (deps) => ({
    link: new URL('/settings/usage', deps.appUrl).toString(),
  }),
  [USAGE_LIMIT_NOTICE_TEMPLATE_KEY.REACHED]: (deps) => ({
    link: new URL('/settings/usage', deps.appUrl).toString(),
  }),
  // 🔴 T-11-02（`F-057 AC-3`）。運営者によるクォータ引き下げの予告。**差し込みはリンク 1 つだけ** ——
  //    どの上限が・いつから・いくつになるかは `S-038` が示す。新旧の値を本文に載せない（`BR-24` と同じ規律）。
  [QUOTA_LOWERED_TEMPLATE_KEY]: (deps) => ({
    link: new URL('/settings/usage', deps.appUrl).toString(),
  }),
  // 🔴 T-10-12（`F-064 AC-10` / docs/05 §9.7）。削除予告。テナント名・削除予定日・`S-042` の URL だけ（上記）。
  [TENANT_CLOSING_NOTICE_TEMPLATE_KEY]: tenantClosingNoticeParams,
};

/**
 * 🔴 `email.dispatch` の `resolveTemplateParams` の実体（docs/05 §9.4）。
 *
 * SP-07 の配線はこれを渡す。名前を与えておく理由は `resolveSendingDomainFromDb` と同じで、
 * **「seam があるが誰も実体を渡していない」状態を配線を書く人が見落とさない**ようにするためである。
 */
export function createOperationalMailParamsResolver(
  deps: OperationalMailParamsDeps,
): (dispatch: OperationalMailDispatchRef, ctx: SystemTenantCtx) => Promise<Readonly<Record<string, unknown>>> {
  return async (dispatch, ctx) => {
    const build = TEMPLATE_PARAMS[dispatch.templateKey];
    if (build === undefined) throw new UnknownOperationalMailTemplateError(dispatch.templateKey);
    return build(deps, dispatch, ctx);
  };
}
