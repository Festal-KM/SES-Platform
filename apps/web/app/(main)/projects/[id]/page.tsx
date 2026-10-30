// apps/web/app/(main)/projects/[id]/page.tsx
// `S-011` 案件詳細。docs/04 §S-011 / `F-013` / `F-014` / docs/05 §6.4 #27。T-06-02。
//
// 🔴 **閲覧を `AuditLog` に記録する**（`BR-27` / `F-013 AC-3`）。記録は `readProjectDetail` の
//    業務トランザクションの内側で書かれ、**書けなければ内容が返らない**。画面と
//    `GET /api/projects/{id}`（#27）が同じ関数を通るので、**経路によって記録が漏れない**
//    （`CLAUDE.md` §13.3「モバイルだけ記録が漏れる実装にしない」/ `BR-28` と同じ形）。
// 🔴 **境界外の ID は 404**（docs/05 §4.8）。母集団を絞るのは `projects` の RLS（C4）であり、
//    この画面に `where` を足さない。
// 🔴 **公開が解除された案件を取引先が開いた場合だけは 404 ページにしない**
//    （docs/04 §10.1 `S-011`「この案件は現在御社に公開されていません」。理由は「存在は既に
//    知っているため、404 は不正確」）。HTTP の状態としては 404 のままである
//    （`ProjectNotSharedError`。`lib/api/errors.ts` の注記）。
// 🔴 `VIEWER` は**到達できる**（閲覧のみ。`F-004 AC-6` / `BR-31`）。編集への導線だけを出さない。
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { PageBody, CONTENT_PADDING_Y_CLASS, cn } from "@ses/ui";
import { PROJECT_DEVELOPMENT_PHASES } from "@ses/domain";
import { REQUIREMENT_KINDS } from "@ses/db";
import { t, type MessageKey } from "@ses/i18n";
import {
  NotFoundError,
  ProjectNotSharedError,
} from "../../../../lib/api/errors";
import {
  readRequestMeta,
  resolveTenantCtxOutcome,
} from "../../../../lib/auth/session";
import { isProjectEditorRole } from "../../../../lib/projects/policy";
import {
  readProjectDetail,
  projectAssigneeOptions,
} from "../../../../lib/projects/service";
import { readHostProjectCards } from "../../../../lib/projects/card-data";
import { listSkills } from "../../../../lib/skills/service";
import {
  projectStatusOptions,
  projectCategoryOptions,
  projectSourceKindOptions,
  projectRemoteModeOptions,
  projectPrefectureOptions,
  projectParallelOkOptions,
} from "../_form/form-props";
import {
  ProjectCardEditor,
  type ProjectCardOptions,
} from "./project-card-editor";
import { projectDetailScreenMessages } from "./detail-props";
// 🔴 公開解除の告知は**別ファイル**である（検査 (k) の「1 画面 1 幅クラス」。
//    理由は `not-shared-notice.tsx` 冒頭）。
import { NotSharedNotice } from "./not-shared-notice";
import { ProjectDetailScreen } from "./project-detail-screen";
import { PageHeading } from "../../_shell/page-heading";
import {
  isPageActionRole,
  PROJECT_DETAIL_TRAIL,
} from "../../../../lib/shell/page-trail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 🔴 タイトルに案件名を入れない（ブラウザの履歴・タブ・共有時のプレビューに残るため。
 *    `S-006` と同じ規律。案件名は取引先にも見える値だが、**どの案件を見たか**は
 *    端末側の履歴に残す必要が無い）。
 */
export const metadata: Metadata = { title: t("projects.detail.title") };

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === "UNAUTHENTICATED") redirect("/signin");
  if (outcome.status === "TWO_FACTOR_REQUIRED") redirect("/signin?step=2fa");

  const { id } = await params;
  const meta = await readRequestMeta();

  // 🔴 T-12-10: 公開の状態（保留の再開時刻）のために現在時刻を渡す（既定値を持たない）。
  const result = await (
    outcome.ctx.partnerCompanyId === null
      ? readHostProjectCards(outcome.ctx, id, {
          ipAddress: meta.ipAddress,
          now: new Date(),
        })
      : readProjectDetail(outcome.ctx, id, {
          ipAddress: meta.ipAddress,
          now: new Date(),
        }).then((view) => ({ view, data: null }))
  ).catch((error: unknown) => {
    // 🔴 判定の順序が重要: `ProjectNotSharedError` は `NotFoundError` の派生なので先に見る。
    if (error instanceof ProjectNotSharedError) return null;
    // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (result === null) return <NotSharedNotice />;
  const { view, data } = result;
  let options: ProjectCardOptions = {};
  if (data && view.audience === "HOST") {
    const [skills, assignees] = await Promise.all([
      listSkills(outcome.ctx, {}),
      projectAssigneeOptions(outcome.ctx),
    ]);
    const unset = { value: "", label: t("projects.detail.valueNone") };
    const currentAssignee = String(data.values.assigneeUserId ?? "");
    options = {
      status: projectStatusOptions,
      category: [unset, ...projectCategoryOptions],
      sourceKind: projectSourceKindOptions,
      remoteMode: [unset, ...projectRemoteModeOptions],
      prefecture: [unset, ...projectPrefectureOptions],
      parallelOk: [unset, ...projectParallelOkOptions],
      developmentPhases: PROJECT_DEVELOPMENT_PHASES.map((value) => ({
        value,
        label: t(`projects.search.phaseShort.${value}` as MessageKey),
      })),
      developmentMethod: [
        { value: "", label: t("projects.search.all") },
        ...["WATERFALL", "AGILE"].map((value) => ({
          value,
          label: t(`projects.search.method.${value}` as MessageKey),
        })),
      ],
      skills: skills.items.map((skill) => ({
        value: skill.id,
        label: skill.name,
      })),
      assigneeUserId: [
        unset,
        ...assignees,
        ...(currentAssignee &&
        !assignees.some((item) => item.value === currentAssignee)
          ? [
              {
                value: currentAssignee,
                label: data.assigneeName ?? currentAssignee,
              },
            ]
          : []),
      ],
    };
  }

  return (
    // 🔴 幅は `PageBody` の 3 クラスが決める（`docs/04` §7.1 / `U-23`）。`S-011` は
    //    **クラス B = 分割**である（画面ファイルに `max-w-*` を書かない。検査 (c) / (k)）。
    // ⚠️ 副カラム（`aside`）はまだ渡していない —— 本画面の右側（提案 / 商流情報 / 公開範囲）を
    //    副カラムへ移すのは `T-22-12`（`S-011`〜`S-014` の刷新）の射程であり、
    //    いまは `ProjectDetailScreen` 内の `lg:grid-cols-2` が 2 カラムを作っている
    //    （`aside` は任意の prop である）。本タスクで変えたのは**幅の所在**だけである。
    <main className={cn(CONTENT_PADDING_Y_CLASS, "min-h-full bg-bg-subtle")}>
      <PageBody widthClass="split">
        {/* 🔴 T-12-21: 帯にタイトルを渡さない —— この画面のタイトルは案件名であり、
          `project-detail-name` が `h1` として持つ（タイトルを二重に描かない）。
          🔴 primary は `docs/04` §S-011 の「候補を探す」（→ `S-016`）1 つである。
             **`NAVIGATION` なのでロールで隠さない** —— 取引先の `S-016` は自社台帳のみ、
             `VIEWER` も閲覧でき、絞り込みの本体は `#30` の RLS である（同§の 🔴）。 */}
        <PageHeading
          trail={PROJECT_DETAIL_TRAIL}
          primaryAction={data ? null : {
            labelKey: "projects.detail.candidates.open",
            href: `/projects/${view.id}/candidates`,
            kind: "NAVIGATION",
          }}
          canAct={isPageActionRole(outcome.ctx.role)}
          testId="project-detail-candidates"
        />
        <ProjectDetailScreen
          view={view}
          compactHeader={data && view.audience === 'HOST' ? {
            categoryLabel:t('projects.cards.field.category'),sourceKindLabel:t('projects.cards.field.sourceKind'),
            category: options.category?.find(item=>item.value===data.values.category)?.label??t('projects.detail.valueNone'),
            sourceKind: options.sourceKind?.find(item=>item.value===data.values.sourceKind)?.label??t('projects.detail.valueNone'),
            updatedAt:data.updatedAt,assignee:data.assigneeName,copyText:String(data.values.copySummary||data.autoSummary),
            updatedLabel:t('projects.cards.field.updatedAt'),assigneeLabel:t('projects.cards.field.assigneeUserId'),candidatesLabel:t('projects.detail.candidates.open'),
          }:undefined}
          cards={
            data && view.audience === "HOST" ? (
              <ProjectCardEditor
                initial={data}
                options={options}
                canEdit={isProjectEditorRole(outcome.ctx.role)}
              />
            ) : undefined
          }
          requirementKinds={REQUIREMENT_KINDS}
          // 🔴 `S-012` に到達できるのはホストの 3 ロールだけである（`PROJECT_EDITOR_ROLES`）。
          //    取引先は `isProjectEditorRole` が偽になるため、導線そのものが描かれない。
          canEdit={isProjectEditorRole(outcome.ctx.role)}
          messages={projectDetailScreenMessages(view.audience)}
        />
      </PageBody>
    </main>
  );
}
