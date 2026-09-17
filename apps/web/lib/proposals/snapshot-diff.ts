// apps/web/lib/proposals/snapshot-diff.ts
// #46b `GET /api/proposals/{id}/snapshot-diff`（docs/05 §6.5「#46b の境界と記録の確定」/ `F-019 AC-2` / `docs/04` §S-006
// セクション 5 / §5-6 / `CLAUDE.md` §3.1 経路 2 / §3.5）。T-12-16。
//
// ============================================================================
// 🔴 ここが守るもの
// ============================================================================
//   ① 🔴 **経路 2 の範囲を超えない。** `withTenant` の 1 トランザクションで ①`proposals`（C5）②`engineer_snapshots`（凍結側）
//      ③`engineers`（**C3 OWNER_SCOPED**。現在値）④`engineer_careers` / `engineer_skills`（C3）を読み、🔴 **③ が読めなければ 404**
//      （docs/05 §4.8「見えない ＝ 存在しない」。① の 404 と本文まで同じ）。**凍結側だけを返す形にしない** —— 返すと #46 と
//      二重になり、「現在値が無い = 他社所有」を応答の形で示唆する。したがってホストが取引先所有エンジニアの提案（経路 2）で
//      叩いても 404、取引先は自社提案 × 自社エンジニアでのみ 200。
//   ② 🔴 **アプリの `if` で所有を判定しない。** 母集団は RLS（C5 / C3）が決め、③ が `null` を返すことに依拠する（#33 と同じ規律）。
//      `where` に `tenantId` / `ownerPartnerCompanyId` を書かない。
//   ③ 🔴 **`engineer.view`（`via='SNAPSHOT_DIFF'`, `summary.proposalId`）を同一トランザクションで記録し、記録に失敗したら返さない**
//      （`recordEngineerView` の 1 実装。§16.1 / K-7 / `BR-27`）。**現在値の再読は「エンジニア詳細の閲覧」である。** 404 のときは
//      見えない行の「閲覧」は無いので記録も残さない（`readEngineerDetail` と同じ）。
//   ④ 🔴 **`frozen` と `current` を別のキーで返す**（`snapshot-diff-fields.ts`）。凍結側の直列化は #46 と同じ（`toSnapshotSkills` /
//      `toFrozenCareers`）。現在値のスキルは凍結の形に写す（`toFrozenSkillShape`）。
//   ⑤ 🔴 応答に `engineerId` / `ownerPartnerCompanyId` / 提案先 / 本文 / `offeredUnitPrice` / `affiliationLabel` / `skillSheetId` を
//      載せない。列を選んで写す（`row` を spread しない）。
//
// 🔴 主平面の API である。`HumanTenantCtx` の `withTenant` からしか呼ばない（管理平面・代理閲覧から呼べる経路を作らない。
//    `EngineerSnapshot.careers` は `app_platform` に `GRANT` されていない）。
// 🔴 本モジュールは Next.js / Auth.js に依存しない（結合テストがサーバを立てずに同じ経路を実行できる。`detail.ts` と同方針）。
//    `S-006`（サーバコンポーネント）と Route Handler が**同じ関数**を通るので、経路によって記録が漏れない。
import { withTenant, type AuthenticatedTenantCtx } from '@ses/db';
import { InternalError, NotFoundError } from '../api/errors';
import { readEngineerCareers } from '../engineers/careers';
import { ENGINEER_VIEW_VIA, readEngineerSkills, recordEngineerView, type EngineerViewMeta } from '../engineers/service';
import { decimalToNumber, toDateOnlyString } from '../format/db-values';
import { buildSnapshotDiffFields, toFrozenSkillShape, type ProposalSnapshotDiffView, type SnapshotComparable } from './snapshot-diff-fields';
import { toFrozenCareers, toSnapshotSkills } from './views';

/** 凍結側で読む列（比較可能列 7 つ + `careers` + `frozenAt`）。`affiliationLabel` / `skillSheetId` は読まない。 */
const SNAPSHOT_DIFF_SELECT = {
  frozenAt: true,
  displayName: true,
  skills: true,
  careers: true,
  unitPriceMin: true,
  unitPriceMax: true,
  availableFrom: true,
  prefecture: true,
  remoteMode: true,
} as const;

/** 現在値で読む列（`OwnEngineerDetailView` のうち凍結と比較できるもの）。連絡先・所属ラベル・生年月日は読まない。 */
const ENGINEER_DIFF_SELECT = {
  id: true,
  displayName: true,
  unitPriceMin: true,
  unitPriceMax: true,
  availableFrom: true,
  prefecture: true,
  remoteMode: true,
} as const;

/** 凍結側 / 現在値の行の共通の形（Prisma の生成型を import しない）。 */
type ComparableRow = {
  readonly displayName: string;
  readonly unitPriceMin: { toString(): string } | null;
  readonly unitPriceMax: { toString(): string } | null;
  readonly availableFrom: Date | null;
  readonly prefecture: string | null;
  readonly remoteMode: string | null;
};

function toComparable(row: ComparableRow, skills: SnapshotComparable['skills']): SnapshotComparable {
  return {
    displayName: row.displayName,
    skills,
    unitPriceMin: decimalToNumber(row.unitPriceMin),
    unitPriceMax: decimalToNumber(row.unitPriceMax),
    availableFrom: toDateOnlyString(row.availableFrom),
    prefecture: row.prefecture,
    remoteMode: row.remoteMode,
  };
}

/**
 * `GET /api/proposals/{id}/snapshot-diff`（#46b）と `S-006` セクション 5 が読む経路。
 *
 * @throws NotFoundError 提案が見えない / 現在値（`engineers`）が見えない / 不存在（どれも同じ 404）。
 */
export async function readProposalSnapshotDiff(
  ctx: AuthenticatedTenantCtx,
  proposalId: string,
  meta: EngineerViewMeta,
): Promise<ProposalSnapshotDiffView> {
  return withTenant(ctx, async (db) => {
    // ① proposals（C5）。取引先は自社が作成した行だけが見える。
    const proposal = await db.proposal.findUnique({ where: { id: proposalId }, select: { id: true, engineerId: true } });
    if (proposal === null) throw new NotFoundError();

    // ② engineer_snapshots（凍結側。C5 継承）。無いのは不変条件違反（`readProposalViewInTx` と同じ扱い）。
    const snapshot = await db.engineerSnapshot.findUnique({ where: { proposalId: proposal.id }, select: SNAPSHOT_DIFF_SELECT });
    if (snapshot === null) {
      throw new InternalError(`engineer_snapshots が見つかりません（proposalId=${proposal.id}）。`);
    }

    // ③ engineers（C3 OWNER_SCOPED）。🔴 見えなければ 404 —— 凍結側だけを返さない。
    const engineer = await db.engineer.findFirst({ where: { id: proposal.engineerId }, select: ENGINEER_DIFF_SELECT });
    if (engineer === null) throw new NotFoundError();

    // 🔴 記録は現在値に到達した直後・同一トランザクション。書けなければここで巻き戻り、応答は返らない。
    await recordEngineerView(db, ctx, engineer.id, ENGINEER_VIEW_VIA.snapshotDiff, meta, { proposalId: proposal.id });

    // ④ 現在値の経歴（#17 と同じ全順序）とスキル（`skillId` 昇順 → 凍結の形へ）。
    const [careers, skills] = await Promise.all([readEngineerCareers(db, engineer.id), readEngineerSkills(db, engineer.id)]);

    return {
      frozenAt: snapshot.frozenAt.toISOString(),
      fields: buildSnapshotDiffFields(
        toComparable(snapshot, toSnapshotSkills(snapshot.skills)),
        toComparable(engineer, toFrozenSkillShape(skills)),
      ),
      careers: { frozen: toFrozenCareers(snapshot.careers), current: careers },
    };
  });
}
