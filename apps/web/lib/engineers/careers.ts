// apps/web/lib/engineers/careers.ts
// 経験内容と従事期間（`EngineerCareer`）の読み書き（docs/05 §6.4「#16 / #16b / #17 の経験内容の決着」。
// `F-008 AC-5` / `docs/04` §S-006 セクション 8 / §S-007 セクション 3 / 申し送り 17）。T-09-12。
//
// 🔴 **専用の CRUD エンドポイントを作らない。** 経歴は `EngineerInput.careers[]` の一部として `#16` が
//    まとめて保存する（`S-007` は 1 画面 1 保存。行だけ別 API にすると「エンジニアは保存されたが経歴だけ
//    失敗した」状態が生まれる）。本モジュールは `service.ts` の同じトランザクションの内側からだけ呼ばれる。
//
// 🔴 **並び順はサーバ側で確定する**（`period_from DESC → created_at ASC → id ASC` = `@ses/db` の
//    `ENGINEER_CAREER_ORDER_BY`。凍結〔`createProposalDraft`〕と同じ並び）。応答の配列順がそのまま表示順で
//    あり、画面はソートし直さない。**入力の配列順は保存にも表示にも使わない**（`sortOrder` 列を作らない）。
//
// 🔴 **監査は行ごと**（`engineer_career.create` / `.update` / `.delete`。docs/05 §16.1）。1 回の保存で
//    3 行追加 + 1 行削除なら 4 件残る。`engineer.update` 1 件にまとめない。差分は `@ses/domain` の
//    `diffCareerRows`（純粋関数）が返す `created` / `updated` / `deleted` をそのまま 1 件ずつ書く。
//    🔴 `summary` に `role` / `description` / `technologies` の本文を載せない（自由入力で PII と商流が混ざり、
//    運営者も横断検索する。載せると監査ログが第 2 の経歴台帳になり PURGED / 保持期間削除の射程外に残る）。
//    載せるのは `{ careerId, periodFrom, periodTo, changedFields, source }` まで。
//
// 🔴 **行の所有はアプリが判定しない。** `where` は `engineerId`（+ `id`）だけであり、母集団は
//    `engineer_careers` の RLS（C3。親と同じ）と Prisma 拡張が決める。`id` 付きの行が保存済みの集合に無ければ
//    404（境界外と不存在を区別しない。docs/05 §4.8）。
import {
  ENGINEER_CAREER_ORDER_BY,
  writeAuditLog,
  type AuthenticatedTenantCtx,
  type EngineerCareerSource,
  type withTenant,
} from '@ses/db';
import {
  compareYearMonth,
  diffCareerRows,
  type CareerValueField,
  type StoredCareerRow,
} from '@ses/domain';
import { NotFoundError, ValidationError } from '../api/errors';
import type { CareerRowInput } from './schemas';

/**
 * docs/05 §16.1 の 3 種。🔴 独自 action（`engineer_career.save` 等）を作らない —— `S-041` の操作種別
 * フィルタ（`CREATE_UPDATE_DELETE` = 接尾辞一致）から漏れる（`skill_alias.update` と同じ理由）。
 */
export const ENGINEER_CAREER_AUDIT_ACTIONS = {
  create: 'engineer_career.create',
  update: 'engineer_career.update',
  delete: 'engineer_career.delete',
} as const;

/**
 * 台帳の現在値（docs/05 §6.4 `CareerRowView`）。🔴 配列順 = 表示順（サーバ側で確定済み）。
 * `id` は行単位の追加・更新・削除と行ごとの監査ログのために API 境界に出す。
 * 🔴 `EngineerSnapshot` の凍結行（`FrozenCareer`）はこの `id` を参照しない（docs/05 §3.6）。
 */
export type CareerRowView = {
  readonly id: string;
  readonly periodFrom: string;
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
  readonly source: EngineerCareerSource;
  readonly skillSheetExtractionId: string | null;
};

/** 監査ログに残す実行環境（`service.ts` の `EngineerViewMeta` と同じ形）。 */
export type CareerWriteMeta = {
  readonly ipAddress: string | null;
};

/** `withTenant` が `fn` に渡すクライアントのうち、本モジュールが触るデリゲート。 */
type CareerDb = Pick<
  Parameters<Parameters<typeof withTenant<void>>[1]>[0],
  'engineerCareer' | 'auditLog'
>;

const CAREER_VIEW_SELECT = {
  id: true,
  periodFrom: true,
  periodTo: true,
  role: true,
  description: true,
  technologies: true,
  source: true,
  skillSheetExtractionId: true,
} as const;

type CareerRow = {
  readonly id: string;
  readonly periodFrom: string;
  readonly periodTo: string | null;
  readonly role: string;
  readonly description: string;
  readonly technologies: string;
  readonly source: string;
  readonly skillSheetExtractionId: string | null;
};

function toView(row: CareerRow): CareerRowView {
  return {
    id: row.id,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    role: row.role,
    description: row.description,
    technologies: row.technologies,
    source: row.source as EngineerCareerSource,
    skillSheetExtractionId: row.skillSheetExtractionId,
  };
}

/**
 * 台帳の現在値を表示順で読む（`#17` / `S-006` セクション 8 / `S-007` の初期値）。
 * 🔴 0 行は `[]`（`null` にしない。画面が「未取得」と区別できる。`docs/04` 申し送り 17-②）。
 */
export async function readEngineerCareers(
  db: Pick<CareerDb, 'engineerCareer'>,
  engineerId: string,
): Promise<readonly CareerRowView[]> {
  const rows = await db.engineerCareer.findMany({
    where: { engineerId },
    select: CAREER_VIEW_SELECT,
    orderBy: [...ENGINEER_CAREER_ORDER_BY],
  });
  return rows.map(toView);
}

/**
 * 🔴 期間の前後関係（開始 ≤ 終了）。境界の Zod では項目をまたぐ検証ができない（`schemas.ts` の注記）ため
 *    ここで見る。DB の CHECK（`period_to >= period_from`）も同じ条件を持つ（二重防御。ここで 400 にするのは
 *    「入力の誤り」を 500 に見せないため）。
 */
function assertPeriodOrder(rows: readonly CareerRowInput[]): void {
  for (const row of rows) {
    if (row.periodTo !== null && compareYearMonth(row.periodTo, row.periodFrom) < 0) {
      throw new ValidationError(['body.careers']);
    }
  }
}

/**
 * 🔴 監査の `summary` に載せるキーの全部（docs/05 §16.1 / §6.4）。**`role` / `description` / `technologies` を
 *    含めない**（自由入力で PII と商流が混ざる。運営者も横断検索する）。`changedFields` は項目名だけである。
 *    `tests/static/career-audit-per-row.test.ts` がこの集合を固定する。
 */
export const ENGINEER_CAREER_AUDIT_SUMMARY_KEYS = [
  'careerId',
  'periodFrom',
  'periodTo',
  'changedFields',
  'source',
] as const;

type CareerAuditSummary = Readonly<
  Record<(typeof ENGINEER_CAREER_AUDIT_SUMMARY_KEYS)[number], string | null>
>;

/** 監査の `summary`（🔴 本文を載せない。`AuditSummary` は配列を持てないため項目名は `,` 区切り）。 */
function careerSummary(
  row: {
    readonly id: string;
    readonly periodFrom: string;
    readonly periodTo: string | null;
    readonly source: string;
  },
  changedFields: readonly CareerValueField[] | null,
): CareerAuditSummary {
  return {
    careerId: row.id,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    changedFields: changedFields === null ? null : changedFields.join(','),
    source: row.source,
  };
}

/**
 * 🔴 `careers[]` を**置き換え**で保存する（送られた集合が保存後のすべて。docs/05 §6.4 #16）。
 *
 * 手順（呼び出し側の 1 トランザクションの内側）:
 *   ① 期間の前後関係を検証する（400）
 *   ② 保存済みの行を読み（RLS が母集団）、`diffCareerRows` で `created` / `updated` / `deleted` に分ける
 *      🔴 `id` 付きなのに保存済みに無い行があれば **404**（他人の行 / 削除済み / 不存在を区別しない）
 *   ③ 削除 → 更新 → 追加を書く。🔴 `ownerPartnerCompanyId` は渡さない（継承トリガが親の値で上書きする）
 *   ④ 変わった行の数と同じ件数の `AuditLog` を**同じトランザクションで**書く（書けなければ保存も成立しない）
 *   ⑤ 保存後の集合を表示順で読み直して返す（応答の配列順 = 表示順）
 *
 * 🔴 `source` は手入力なので常に `MANUAL`。既存行の `source` は**更新しても書き換えない**（出所は
 *    「どこから来たか」であって「誰が最後に触ったか」ではない。docs/05 §6.4 #16b）。
 */
export async function replaceEngineerCareers(
  db: CareerDb,
  ctx: AuthenticatedTenantCtx,
  engineerId: string,
  rows: readonly CareerRowInput[],
  meta: CareerWriteMeta,
): Promise<readonly CareerRowView[]> {
  assertPeriodOrder(rows);

  const stored = await db.engineerCareer.findMany({
    where: { engineerId },
    select: { ...CAREER_VIEW_SELECT },
  });
  const before: StoredCareerRow[] = stored.map((row) => ({
    id: row.id,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    role: row.role,
    description: row.description,
    technologies: row.technologies,
  }));
  const sourceOf = new Map(stored.map((row) => [row.id, row.source]));
  // 🔴 `diffCareerRows` の `updated` / `deleted` は `before`（= `stored`）由来なので必ず引ける。引けなければ
  //    実装の不整合であり、既定値で埋めて監査の `source` を嘘にしない（fail-closed）。
  const storedSourceOf = (id: string): string => {
    const source = sourceOf.get(id);
    if (source === undefined) throw new Error(`engineer_careers(${id}) の出所を読み出せません（保存済みの集合に無い）。`);
    return source;
  };

  let diff: ReturnType<typeof diffCareerRows>;
  try {
    diff = diffCareerRows(before, rows);
  } catch (error) {
    // 同じ `id` が 2 回送られた（`RangeError`）。黙って畳まず 400 にする。
    if (error instanceof RangeError) throw new ValidationError(['body.careers']);
    throw error;
  }
  if (diff.unmatched.length > 0) throw new NotFoundError();

  const audit = (
    action: (typeof ENGINEER_CAREER_AUDIT_ACTIONS)[keyof typeof ENGINEER_CAREER_AUDIT_ACTIONS],
    row: { readonly id: string; readonly periodFrom: string; readonly periodTo: string | null; readonly source: string },
    changedFields: readonly CareerValueField[] | null,
  ) =>
    writeAuditLog(db, {
      action,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'EngineerCareer',
      targetId: row.id,
      summary: careerSummary(row, changedFields),
      ipAddress: meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });

  // ③-1 削除。🔴 `where` は `engineerId` + `id`。直前に読めた行が消えている（並行削除）なら 0 件を成功に
  //     せず 404 にする（`updateEngineer` と同じ判断）。記録は変更が成立したあとに書く（起きなかった変更を残さない）。
  for (const row of diff.deleted) {
    const removed = await db.engineerCareer.deleteMany({ where: { id: row.id, engineerId } });
    if (removed.count !== 1) throw new NotFoundError();
    await audit(ENGINEER_CAREER_AUDIT_ACTIONS.delete, { ...row, source: storedSourceOf(row.id) }, null);
  }

  // ③-2 更新（値が実際に変わった行だけ）。
  for (const change of diff.updated) {
    const updated = await db.engineerCareer.updateMany({
      where: { id: change.id, engineerId },
      data: {
        periodFrom: change.after.periodFrom,
        periodTo: change.after.periodTo,
        role: change.after.role,
        description: change.after.description,
        technologies: change.after.technologies,
      },
    });
    if (updated.count !== 1) throw new NotFoundError();
    await audit(
      ENGINEER_CAREER_AUDIT_ACTIONS.update,
      {
        id: change.id,
        periodFrom: change.after.periodFrom,
        periodTo: change.after.periodTo,
        source: storedSourceOf(change.id),
      },
      change.changedFields,
    );
  }

  // ③-3 追加。🔴 行 ID は `create` の戻り値で受ける（監査の `targetId` に要る）。`createMany` にしない。
  for (const row of diff.created) {
    const created = await db.engineerCareer.create({
      data: {
        // 🔴 テナントキーは第 2 防御が確定させるが、Prisma の型が必須列として要求するため明示する。
        tenantId: ctx.tenantId,
        // 🔴 `ownerPartnerCompanyId` を**渡さない**。`engineer_careers_inherit_owner` トリガが親の値で上書きする。
        engineerId,
        periodFrom: row.periodFrom,
        periodTo: row.periodTo,
        role: row.role,
        description: row.description,
        technologies: row.technologies,
        source: 'MANUAL',
      },
      select: { id: true },
    });
    await audit(
      ENGINEER_CAREER_AUDIT_ACTIONS.create,
      { id: created.id, periodFrom: row.periodFrom, periodTo: row.periodTo, source: 'MANUAL' },
      null,
    );
  }

  return readEngineerCareers(db, engineerId);
}
