// apps/web/app/(main)/engineers/[id]/page.tsx
// `S-006` エンジニア詳細。docs/04 §S-006 / `F-008` / docs/05 §6.4 #17。T-05-02。
//
// 🔴 **閲覧を `AuditLog` に記録する**（`BR-27` / `F-008 AC-4`）。記録は `readEngineerDetail` の
//    業務トランザクションの内側で書かれ、**書けなければ内容が返らない**（`F-012 AC-2` と同じ規律）。
//    画面と `GET /api/engineers/{id}`（#17）が同じ関数を通るので、**経路によって記録が漏れない**
//    （`CLAUDE.md` §13.3「モバイルだけ記録が漏れる実装にしない」/ `BR-28` と同じ形）。
// 🔴 **境界外の ID は 404**（docs/05 §4.8 / `F-008 AC-3`）。母集団を絞るのは `engineers` の
//    RLS（C3）であり、この画面に `where` を足さない。ホスト所属の利用者が他パートナー所有の
//    エンジニア ID を URL 直打ちしても、実名・所属会社名に到達できない。
// 🔴 `VIEWER` は**到達できる**（閲覧のみ。`F-012 AC-3` / `BR-31`）。編集への導線だけを出さない。
//
// 🔴 T2（モバイル閲覧可）。稼働状況・稼働可能時期・単価レンジは**折りたたみの外**に置く
//    （`CLAUDE.md` §13.3 / docs/04 §S-006「移動中に見る値」）。セクションは `<details open>` で
//    既定は開いた状態にする —— 折りたためるだけで、既定で隠す項目は 1 つも無い。
//
// ============================================================================
// 🔴 SP-22 段④ で何が変わったか（**見せ方だけ**。人間のワイヤーフレーム
//    「SES Hub人材プロフィール画面.png」）
// ============================================================================
// | 変えたもの | 一次資料 | 🔴 変えていないもの |
// |---|---|---|
// | `max-w-5xl` + 2 カラムの grid → **`PageBody widthClass="split"`**（クラス B） | `docs/04` §7.1 / `U-23` | 🔴 **セクションの集合・順序・testid** |
// | 見出し直下の操作行とスキルシートのセクション → **右レール** | ワイヤーフレームの右レール / §S-006 デバイス別「右にスキルシート」 | 🔴 **testid**（`engineer-detail-skill-sheets{,-lead,-link}` / `…-share-link` / `…-view-recorded`） |
// | `編集` → **帯の primary**（`engineerDetailPrimaryAction`） | ワイヤーフレーム見出し右の `[編集]` / §7.6 / §3.4 | 🔴 **testid `engineer-detail-edit-link`** / `VIEWER` には描かない |
// | 折りたたみの外の 3 値を **`Card`（白い面）**に入れた | §7.9（ページ地は `--color-bg-subtle`） | 🔴 **`engineer-detail-headline` の 3 行と値の出所** |
// | 色・文字サイズ → §7.9 の semantic トークン / 6 トークン | §7.9 | — |
//
// 🔴 **API / 取得経路 / 監査記録 / 権限判定 / URL は 1 つも変えていない。**
// 🔴 **ワイヤーフレームから意図して落としたもの**:
//    - **スキルレーダー（チャート）** —— ①チャートライブラリが依存に無く、追加は `CLAUDE.md` §2 の
//      技術スタックの変更 ②`docs/04` §7.2 がグラフを禁じている ③**「市場需要」のデータ源が存在しない**。
//      代わりに**スキル表（経験年数・レベル）をそのまま出す**（セクション 2）。
//    - **AI 生成の人材サマリ** —— `CLAUDE.md` §12.2 の 6 ロールに「人材サマリ生成」は無い
//      （ロールの追加は人間の承認事項。§8.6）。🔴 **枠だけ置くこともしない。**
//    - **メモ（社内メモ / 公開メモ）** —— 実体が無い。🔴 **「社内」と「公開」の区別は情報境界
//      そのもの**であり、実体の無い枠を置くと「社内メモが公開された」と誤解される経路になる。
//    - **ID・性別・年齢** —— `BR-52` が収集しないと定めた項目であり、DB にも列が無い（`F-008 AC-1`）。
//    - **カテゴリのタグ** —— 概念が DB にも API にも無い（`S-010` と同じ判断）。
//    - **タブ 7 本**（基本情報 / 職務経歴 / スキル / 対応履歴 / 提案履歴 / ファイル / メモ）——
//      🔴 `docs/04` §10.3 が「タブを 5 つ以上に増やさない」と定めており、`@ses/ui` の `Tabs` は
//      **型で 4 本に制限**されている（`TABS_MAX_ITEMS`）。加えてタブは**既定で 6 面を隠す**ため、
//      `CLAUDE.md` §13.3「判断材料を隠さない」と `<details open>` の現行（既定で全開）に反する。
//      セクションの縦積みのままにした。
//    - **状態バッジ** —— `Engineer.availability`（稼働中 / 待機中 / 待機予定）は `docs/04` §5-1 の
//      36 状態に無く、`STATUS_BADGE_APPEARANCES` に `engineer` の表が無い。🔴 **色の割り当ては
//      §7.4 / §5-1 の改訂（人間の判断。§8.6）**であり実装で決めない（`S-010` と同じ結論）。
//      折りたたみの外の `稼働状況` は素のテキストのままである。
// ⚠️ **`docs/04` §S-006「デバイス別」は「右にスキルシート・提案履歴・差分」と書いているが、
//    クラス B の副カラムは 360 / 400 / 480px の固定**であり（§7.1）、**提案履歴（5 列）と凍結差分
//    （項目 4 列 + 経歴の左右並置）は入らない**。副カラムに置いたのは**スキルシート（セクション 3）
//    と操作**で、**提案履歴（4）と差分（5）は主カラムに縦積みした**（完了報告で上流へ申し送る）。
// ⚠️ **副カラムの中身はロールで変わる**（`S-015` が存在しないホスト / `VIEWER` には操作のカードを
//    描かない）。🔴 **グレーアウトで残さない**（`HANDOFF.md` §3.3 / `BR-44`）。
//
// ✅ T-12-16: セクション 4（提案履歴）・5（凍結情報との差分）を実装した（docs/04 §S-006 / §5-6 / `F-019 AC-2` /
//    docs/05 §6.5 #46b「#46b の境界と記録の確定」）。
//    - セクション 4 は `listProposals(ctx, { engineerId })`（#45 と同じ関数・同じ射影）。`AuditLog` は #45 と同じく書かない。
//    - セクション 5 は `?diff=<proposalId>` で選んだ提案を `readProposalSnapshotDiff`（#46b と**同じ関数**）で読む。
//      🔴 この読み取りは同一トランザクションで `engineer.view`（`via='SNAPSHOT_DIFF'`, `proposalId`）を記録し、記録できなければ
//      返らない。`S-006` を開いた `DETAIL` と合わせて 2 行残るが、別々の閲覧である（docs/05 §6.5）。
//    - 🔴 選べるのはセクション 4 の行にある提案だけ（`?diff=` が行に無ければ未選択として扱う。他の人材の提案をこの画面で
//      描かない）。404（現在値を参照できない）は理由を語らない文言だけを出す（docs/05 §4.8）。
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { z } from 'zod';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageBody,
  SECONDARY_LINK_STACKED_CLASSES,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ses/ui';
import { PAGE_SIZE_MAX } from '@ses/config';
import { t } from '@ses/i18n';
import { NotFoundError } from '../../../../lib/api/errors';
import { readRequestMeta, resolveTenantCtxOutcome } from '../../../../lib/auth/session';
import {
  engineerBasicRows,
  engineerDetailCareerRows,
  engineerDetailPrimaryAction,
  engineerDetailSkillRows,
  engineerHeadlineRows,
} from '../../../../lib/engineers/detail';
import { isEngineerShareRole } from '../../../../lib/engineer-shares/policy';
import { engineerOwnershipLabel } from '../../../../lib/engineers/labels';
import {
  ENGINEER_DETAIL_DIFF_PARAM,
  engineerProposalHistoryRows,
  snapshotDiffRows,
} from '../../../../lib/engineers/proposal-sections-rows';
import { readEngineerDetail } from '../../../../lib/engineers/service';
import { listProposals } from '../../../../lib/proposals/list';
import { proposalListQuerySchema } from '../../../../lib/proposals/schemas';
import { readProposalSnapshotDiff } from '../../../../lib/proposals/snapshot-diff';
import { DetailSection } from './detail-section';
import { EngineerProposalSections, type EngineerSnapshotDiffState } from './engineer-proposal-sections';
import { engineerProposalSectionsMessages } from './proposal-sections-props';
import { PageHeading } from '../../_shell/page-heading';
import { isPageActionRole, ENGINEER_DETAIL_TRAIL } from '../../../../lib/shell/page-trail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 🔴 タイトルに氏名を入れない（ブラウザの履歴・タブ・共有時のプレビューに PII が残るため）。
 *    氏名は本文の見出しにだけ出す。
 */
export const metadata: Metadata = { title: t('engineers.detail.title') };

/** `?diff=<proposalId>`（セクション 4 の行 → セクション 5 の選択）。形が違えば未選択として扱う（探らせない）。 */
const detailSearchParamsSchema = z.object({ [ENGINEER_DETAIL_DIFF_PARAM]: z.uuid().optional() });

export default async function EngineerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = await resolveTenantCtxOutcome();
  if (outcome.status === 'UNAUTHENTICATED') redirect('/signin');
  if (outcome.status === 'TWO_FACTOR_REQUIRED') redirect('/signin?step=2fa');

  const { id } = await params;
  const meta = await readRequestMeta();

  const view = await readEngineerDetail(outcome.ctx, id, { ipAddress: meta.ipAddress }).catch(
    (error: unknown) => {
      // 🔴 境界外・不存在のどちらも 404 に畳む（区別すると存在を教えることになる）。
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );

  // --- 4. 提案履歴（T-12-16。#45 と同じ関数・同じ射影。母集団は `proposals` の RLS〔C5〕）---
  const proposals = await listProposals(
    outcome.ctx,
    proposalListQuerySchema.parse({ engineerId: view.id, limit: PAGE_SIZE_MAX }),
  );
  const parsedSearch = detailSearchParamsSchema.safeParse(await searchParams);
  const requestedDiffId = parsedSearch.success ? (parsedSearch.data[ENGINEER_DETAIL_DIFF_PARAM] ?? null) : null;
  // 🔴 選択はセクション 4 の行に限る（行に無い ID は未選択）。
  const selectedDiffId = requestedDiffId !== null && proposals.items.some((item) => item.id === requestedDiffId) ? requestedDiffId : null;
  const history = engineerProposalHistoryRows(proposals.items, view.id, selectedDiffId);

  // --- 5. 凍結情報との差分（T-12-16。#46b と同じ関数。`engineer.view`〔SNAPSHOT_DIFF〕は関数の中で記録される）---
  const diff: EngineerSnapshotDiffState =
    selectedDiffId === null
      ? { kind: 'NONE' }
      : await readProposalSnapshotDiff(outcome.ctx, selectedDiffId, { ipAddress: meta.ipAddress }).then(
          (result): EngineerSnapshotDiffState => ({ kind: 'READY', rows: snapshotDiffRows(selectedDiffId, result) }),
          (error: unknown): EngineerSnapshotDiffState => {
            // 🔴 現在値を参照できない（404）は理由を語らず「参照できません」だけ（docs/05 §4.8）。それ以外は落とす。
            if (error instanceof NotFoundError) return { kind: 'UNAVAILABLE' };
            throw error;
          },
        );

  // 🔴 所属区分は**行の値ではなく ctx** から作る（`F-008 AC-2`。`detail.ts` の注記）。
  const ownership = engineerOwnershipLabel(outcome.ctx.partnerCompanyId);
  const headline = engineerHeadlineRows(view);
  const basicRows = engineerBasicRows(view, ownership);
  const skillRows = engineerDetailSkillRows(view.skills);
  // 🔴 T-09-12: 応答の配列順 = 表示順（サーバ側で確定済み。ここでソートしない。docs/04 §S-006 セクション 8）。
  const careerRows = engineerDetailCareerRows(view.careers);
  // 🔴 `VIEWER` は `S-007` に到達できない（docs/04 §S-007 権限差分）。押しても戻されるだけの
  //    導線を描かない。⚠️ これは UI の配慮であって拒否の本体ではない（本体は #16 のガードと
  //    `S-007` のリダイレクト）。
  const canEdit = outcome.ctx.role !== 'VIEWER';
  // 🔴 T-08-02: `S-015`（匿名共有の設定）へ到達できるか。`canEdit` と**同じ値にならない**
  //    ため共有しない（共有の設定はパートナーロールに限られる。`lib/engineer-shares/policy.ts`）。
  const canManageShares = isEngineerShareRole(outcome.ctx.role);

  return (
    // 🔴 幅は `PageBody` の 3 クラスが決める（`docs/04` §7.1 / `U-23`）。`S-006` は
    //    **クラス B = 分割**である（画面ファイルに `max-w-*` を書かない。検査 (c) / (k)）。
    //    🔴 副カラムは `lg` 未満では `PageBody` が本体の下に積む（遮断しない。`CLAUDE.md` §13.3）。
    //    🔴 `Drawer` ではない（`Drawer` は `S-003` / `S-004` の要対応キュー専用。§5-13）。
    <main className="py-6">
      <PageBody
        widthClass="split"
        aside={
          // 🔴 右レール（ワイヤーフレームのクイックアクション + `docs/04` §S-006 デバイス別
          //    「デスクトップ = … 右にスキルシート」）。
          //    🔴 **新しい操作を 1 つも足していない** —— 既存の 3 つ（スキルシートの版の導線 /
          //       匿名共有の設定 / 閲覧の記録の注記）をここに集めただけである。`編集` は帯の
          //       primary へ移した（モバイルでは画面下部の固定バーになる。§3.4）。
          //    🔴 **操作のカードは「操作が 1 つでもあるロール」にしか描かない** ——
          //       見出しが `この人材への操作` なのに中身が注記だけ、という形を作らない
          //       （`VIEWER` / ホストに `S-015` は存在しない。`F-016` 関連ロール）。
          <div className="flex flex-col gap-4">
            {/* 🔴 T-05-06: 版の管理は `S-008`（docs/04 §S-006 関連画面「→ `S-008`」）。
                ⚠️ 版の一覧をこの画面に**再掲しない** —— 出すと「どちらが正か」が分かれ、
                スキャン状態の見え方が 2 実装になる（`F-011 AC-2` の担保が割れる）。 */}
            <DetailSection id="skill-sheets" title={t('engineers.detail.section.skillSheets')}>
              <p className="mb-3 text-body text-fg-muted" data-testid="engineer-detail-skill-sheets-lead">
                {t('engineers.detail.skillSheets.lead')}
              </p>
              <Link
                className={SECONDARY_LINK_STACKED_CLASSES}
                href={`/engineers/${view.id}/skill-sheets`}
                data-testid="engineer-detail-skill-sheets-link"
              >
                {t('engineers.detail.skillSheets.link')}
              </Link>
            </DetailSection>

            {canManageShares ? (
              <Card data-testid="engineer-detail-rail">
                <CardHeader>
                  {/* 🔴 `h1` にしない —— この画面の `h1` は氏名（`engineer-detail-name`）である。
                      `CardTitle` は `h2` である（`tests/static/page-heading-single.test.ts`）。 */}
                  <CardTitle>{t('engineers.detail.rail.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* 🔴 T-08-02: `S-015`（匿名共有の設定）への導線（docs/04 §S-006 関連画面「→ `S-015`」）。
                      「この人の稼働が決まった」と分かるのは詳細を開いたときであり、そこから 1 手で
                      共有を止められないと、ホストに無効な候補が出続ける（`F-016 AC-2` の実運用面）。
                      🔴 到達できるロール（`PARTNER_ADMIN` / `PARTNER_SALES`）にだけ描く ——
                      ホストと `VIEWER` には `S-015` が存在しない（`F-016` 関連ロール）。
                      ⚠️ **この画面から共有を切り替えない。** 切り替えは `S-015` の
                      開示プレビュー付きの確認ステップを必ず通す（`docs/04` §S-015「操作と結果」）。 */}
                  <Link
                    className={SECONDARY_LINK_STACKED_CLASSES}
                    href="/engineer-shares"
                    data-testid="engineer-detail-share-link"
                  >
                    {t('engineerShares.open')}
                  </Link>
                </CardContent>
              </Card>
            ) : null}

            {/* 🔴 `BR-27` / `F-008 AC-4`: 閲覧が記録されることを利用者にも明示する。
                🔴 **カードの中に入れない** —— 操作ではなく、この画面そのものの性質である。 */}
            <p className="m-0 text-xs text-fg-muted" data-testid="engineer-detail-view-recorded">
              {t('engineers.detail.viewRecorded')}
            </p>
          </div>
        }
      >
        {/* 🔴 T-05-09 / T-12-21: 「人材」は `S-005`（一覧）へのリンクである（docs/04 §S-006 関連画面
            「← `S-005`」の戻り経路。パンくずが文字だけだと一覧へ戻れない）。表は `lib/shell/page-trail.ts`。
            🔴 **帯にタイトルを渡さない** —— この画面のタイトルは氏名であり、直下の
               `engineer-detail-name` が `h1` として持つ（タイトルを二重に描かない）。
            ✅ SP-22 段④: `編集` を帯の primary へ移した（ワイヤーフレームの見出し右の `[編集]`）。
               testid（`engineer-detail-edit-link`）は移設前から凍結されている値である（`U-22`）。 */}
        <PageHeading
          trail={ENGINEER_DETAIL_TRAIL}
          linkTestId="engineer-detail-list-link"
          primaryAction={engineerDetailPrimaryAction(canEdit, view.id)}
          canAct={isPageActionRole(outcome.ctx.role)}
          testId="engineer-detail-edit-link"
        />

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-title font-semibold text-fg" data-testid="engineer-detail-name">
            {view.displayName}
          </h1>
          <Badge variant="outline" data-testid="engineer-detail-ownership">
            {ownership}
          </Badge>
        </div>

        {/* 🔴 折りたたみの外（`CLAUDE.md` §13.3）。移動中の判断に要る 3 値。
            ✅ SP-22 段④: 白い面（`Card`）に入れた —— ページ地が `--color-bg-subtle` なので、
               淡い面のままでは地に溶けて「ここが要点である」ことが読めない。 */}
        <Card className="mb-4">
          <CardContent className="pt-4">
            <dl
              className="grid grid-cols-1 gap-3 text-body sm:grid-cols-3"
              data-testid="engineer-detail-headline"
            >
              {headline.map((row) => (
                <div key={row.key}>
                  <dt className="text-fg-muted">{row.label}</dt>
                  <dd
                    className="m-0 font-semibold text-fg"
                    data-testid={`engineer-detail-headline-${row.key}`}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {/* 🔴 セクションは縦積みである（副カラムは操作だけに使う。ファイル冒頭の ⚠️）。 */}
        <div className="flex flex-col gap-4">
          <DetailSection id="basic" title={t('engineers.detail.section.basic')}>
            <dl className="text-body">
              {basicRows.map((row) => (
                <div key={row.key} className="flex gap-3 border-b border-border py-2 last:border-b-0">
                  <dt className="w-32 shrink-0 text-fg-muted">{row.label}</dt>
                  <dd className="m-0 min-w-0 text-fg" data-testid={`engineer-detail-basic-${row.key}`}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            {/* 🔴 `BR-52` / `F-008 AC-1`: 集めていない情報を明示する。 */}
            <p className="mt-3 text-xs text-fg-muted" data-testid="engineer-detail-collection-scope">
              {t('engineers.detail.collectionScope')}
            </p>
          </DetailSection>

          <DetailSection id="skills" title={t('engineers.detail.section.skills')}>
            {skillRows.length === 0 ? (
              <p className="text-body text-fg-muted" data-testid="engineer-detail-skill-empty">
                {t('engineers.skills.empty')}
              </p>
            ) : (
              <Table data-testid="engineer-detail-skill-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('engineers.skills.column.skill')}</TableHead>
                    <TableHead>{t('engineers.skills.column.years')}</TableHead>
                    <TableHead>{t('engineers.skills.column.level')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {skillRows.map((row) => (
                    <TableRow key={row.skillId}>
                      <TableCell whitespace="normal">{row.name}</TableCell>
                      <TableCell>{row.years}</TableCell>
                      <TableCell>{row.level}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DetailSection>

          {/* --- 8. 経験内容と従事期間（T-09-12。docs/04 §S-006 セクション 8。配置は基本情報〔定義リスト +
              スキル表 = docs/04 のセクション 2〕の直下、版一覧の上）---
              🔴 列ヘッダに並び替えを付けない（S-023 の凍結側と並べたときに行の入れ替わりと内容の変化を
              取り違えないため）。編集導線は S-007 への遷移 1 本（インライン編集を持たない）。
              🔴 0 行は正常な状態（F-008 AC-5）。警告色・注意アイコンを使わない。
              🔴 モバイルでも全行に到達できる（行数で打ち切らない。CLAUDE.md §13.3）。 */}
          <DetailSection id="careers" title={t('engineers.detail.section.careers')}>
            {careerRows.length === 0 ? (
              <div data-testid="engineer-detail-career-empty">
                <p className="text-body text-fg-muted">{t('engineers.careers.empty')}</p>
                {canEdit ? (
                  <p className="mt-2 text-body">
                    <Link
                      className={SECONDARY_LINK_STACKED_CLASSES}
                      href={`/engineers/${view.id}/edit`}
                      data-testid="engineer-detail-career-edit-link"
                    >
                      {t('engineers.careers.empty.editLink')}
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <p className="mb-2 text-xs text-fg-muted" data-testid="engineer-detail-career-order-note">
                  {t('engineers.careers.detailOrderNote')}
                </p>
                <Table data-testid="engineer-detail-career-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('engineers.careers.column.period')}</TableHead>
                      <TableHead>{t('engineers.careers.column.role')}</TableHead>
                      <TableHead>{t('engineers.careers.column.description')}</TableHead>
                      <TableHead>{t('engineers.careers.column.technologies')}</TableHead>
                      <TableHead>{t('engineers.careers.column.source')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {careerRows.map((row) => (
                      <TableRow
                        key={row.id}
                        align="top"
                        data-testid={`engineer-detail-career-row-${row.id}`}
                      >
                        <TableCell>{row.period}</TableCell>
                        <TableCell whitespace="normal">{row.role}</TableCell>
                        {/* 業務内容は折り返して全文（詳細なので先頭 1 行に畳まない。改行も保つ）。 */}
                        <TableCell whitespace="normal" className="whitespace-pre-wrap">
                          {row.description}
                        </TableCell>
                        <TableCell whitespace="normal">{row.technologies}</TableCell>
                        <TableCell>{row.source}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </DetailSection>

          {/* --- 4. 提案履歴 / 5. 凍結情報との差分（T-12-16）---
              ⚠️ **副カラムではなく主カラムに置く**（ファイル冒頭の ⚠️。凍結差分は
              項目 4 列 + 経歴の左右並置であり、360〜480px の副カラムに入らない）。 */}
          <EngineerProposalSections history={history} diff={diff} messages={engineerProposalSectionsMessages()} />
        </div>
      </PageBody>
    </main>
  );
}
