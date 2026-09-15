// apps/web/app/api/(main)/engineers/route.ts
// docs/05 §6.4 #15 `GET /api/engineers`（`F-009` / `S-005`。T-05-09）と
// #16 `POST /api/engineers`（`F-008` / `S-007`。T-05-01）。
//
// 🔴 認可は docs/05 §6.4 #16 のとおり `OWNER` / `ADMIN` / `SALES` / `PARTNER_ADMIN` /
//    `PARTNER_SALES`。`VIEWER` は `requireRole` と `requireNotViewer` の**両方**で落ちる
//    （`BR-31` / `F-004 AC-6`。片方だけにしないのは、ロール一覧を書き換えたときに
//    `VIEWER` が紛れ込んでも `requireNotViewer` が残るため）。
// 🔴 停止中の取引先の配下アカウントは `requireExecutable` が拒否する（`F-007 AC-2`）。
// 🔴 **`ownerPartnerCompanyId` は body に無い**（`F-008 AC-2`）。スキーマに存在しないため
//    `withApiRoute` の構築時検査（`assertNoIsolationKeys`）も、Zod の strip も、
//    RLS の C3 も、すべて同じ結論（＝ 登録者の所属だけが所有者を決める）に収束する。
import { ValidationError } from '../../../../lib/api/errors';
import { requireExecutable, requireNotViewer, requireRole } from '../../../../lib/api/guards';
import { withApiRoute } from '../../../../lib/api/withApiRoute';
import { readRequestMeta } from '../../../../lib/auth/session';
import { listProjectCandidates } from '../../../../lib/candidates/list';
import { engineerListApiQuerySchema, isUuidCursor } from '../../../../lib/candidates/schemas';
import { candidateReference } from '../../../../lib/db/bootstrap';
import { listEngineers } from '../../../../lib/engineers/list';
import { createEngineer, ENGINEER_AUDIT_ACTIONS } from '../../../../lib/engineers/service';
import { createEngineerBodySchema } from '../../../../lib/engineers/schemas';

// 🔴 Node ランタイム固定（Prisma は Edge で動かない）。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/engineers`（docs/05 §6.4 #15 / `F-009` / `S-005`）。T-05-09（骨格）。
 *
 * 🔴 **認可は `guards: []`（全ロール）**。docs/05 §6.4 #15 の「全ロール（母集団は所属で決まる）」
 *    そのものである。読み取り専用なので `requireExecutable` / `requireNotViewer` を掛けない
 *    —— `VIEWER` は閲覧のみ可（`F-012 AC-3` / `BR-31`）、`CLOSING` でも閲覧できる（`F-004 AC-8`）。
 *    **`guards: []` は「掛け忘れ」ではない**（`#17` と同じ判断）。
 * 🔴 **母集団を絞るのは `engineers` の RLS（C3 OWNER_SCOPED）だけ**である。ここにも
 *    `listEngineers` にも `tenantId` / `partnerCompanyId` の条件を書かない ——
 *    パートナーが API を直接叩いても他社のエンジニアは 1 件も返らず、`total` にも現れない
 *    （`F-004 AC-3` / `F-009 AC-3`）。
 * 🔴 **`audit` オプションを使わない。** `BR-27` / `F-008 AC-4` の記録対象は「エンジニア**詳細**の
 *    閲覧」であり、一覧の記録は `docs/04` §S-005 のとおり**行クリック（→ `S-006`）**が持つ
 *    （docs/05 §16.1 / `lib/engineers/list.ts` 冒頭に理由を書いた）。
 * 🔴 **不正なカーソルは 400** である。案件なしは行の UUID（Prisma の `cursor: { id }` に届かせない。
 *    `lib/api/pagination.ts` の注記）、案件ありは並びのキー（docs/05 §4.6）であり、**組み合わせが
 *    合わないカーソルも 400** にする（黙って先頭ページに戻さない）。
 *
 * ⚠️ **暫定。[Issue #50](https://github.com/Festal-KM/SES-Platform/issues/50) で確認中（T-08-05。既定 A）**:
 *    匿名候補（`AnonymousCandidateView`）が混ざるのは **`?projectId=` が渡されたときだけ**であり、
 *    `S-005` は渡さない（参照子が案件スコープで、案件が無いと定義できない。docs/05 §6.4
 *    「#15 の実装の決着（T-08-05）」）。案件ありは `#30` と**同じ関数**（`listProjectCandidates`）を通り、
 *    応答の形（`{ items, total, nextCursor }`）は案件なしと同じ（`project` / `phase` は載せない）。
 *    パートナーが `projectId` を渡しても匿名候補は 1 件も含まれない（`F-017 AC-5`）。
 */
export const GET = withApiRoute(
  { label: 'GET /api/engineers', guards: [], query: engineerListApiQuerySchema },
  async ({ ctx, query }) => {
    const { projectId, ...rest } = query;
    if (projectId === undefined) {
      if (rest.cursor !== undefined && !isUuidCursor(rest.cursor)) {
        throw new ValidationError(['cursor']);
      }
      return Response.json(await listEngineers(ctx, rest));
    }
    if (rest.cursor !== undefined && isUuidCursor(rest.cursor)) {
      throw new ValidationError(['cursor']);
    }
    const meta = await readRequestMeta();
    const view = await listProjectCandidates(ctx, projectId, { kind: 'CRITERIA', query: rest }, {
      candidateRef: candidateReference(),
      now: () => new Date(),
      meta: { ipAddress: meta.ipAddress },
    });
    // 🔴 `#15` の契約は `{ items, total, nextCursor }`。案件の共通部分は `#30` だけが返す。
    return Response.json({ items: view.items, total: view.total, nextCursor: view.nextCursor });
  },
);

export const POST = withApiRoute(
  {
    label: 'POST /api/engineers',
    guards: [
      requireRole(['OWNER', 'ADMIN', 'SALES', 'PARTNER_ADMIN', 'PARTNER_SALES']),
      requireExecutable(),
      requireNotViewer(),
    ],
    body: createEngineerBodySchema,
    // 🔴 `F-008` 処理④「作成・更新・削除を監査ログに記録する」。`withApiRoute` が
    //    ハンドラ本体の**前**に書き、記録に失敗したらハンドラを呼ばない（docs/05 §6.1 / §16.1）。
    // 🔴 `targetId` は採番前なので `null`（`partner_company.create` と同じ扱い）。
    // 🔴 **`displayName` を `summary` に載せない。** エンジニアの氏名は PII であり、
    //    運営者にも見せない値である（`CLAUDE.md` §10.5 / `AuditSummary` の規約）。
    //    残すのは「何件のスキルを付けたか」「新語候補を何件起票したか」「経歴を何行付けたか」だけにする。
    // 🔴 T-09-12: 経歴の**行ごと**の記録（`engineer_career.create`）は `replaceEngineerCareers` が
    //    業務トランザクションの内側で書く（docs/05 §16.1）。ここは件数だけ。
    audit: {
      action: ENGINEER_AUDIT_ACTIONS.create,
      resolve: ({ body }) => ({
        targetType: 'Engineer',
        targetId: null,
        summary: {
          skillCount: body.skills.length,
          newSkillLabelCount: body.newSkillLabels.length,
          careerCount: body.careers.length,
        },
      }),
    },
  },
  async ({ ctx, body }) => {
    const meta = await readRequestMeta();
    return Response.json(await createEngineer(ctx, body, { ipAddress: meta.ipAddress }), {
      status: 201,
    });
  },
);
