// apps/web/app/(main)/_home/home-sections.tsx
// `S-003`（ホスト）/ `S-004`（取引先）のセクション（docs/04 §S-003 / §S-004 / §7.2 / `F-006`）。
//
// ============================================================================
// 🔴 T-22-09 で何を変えたか（`docs/04` 改訂 16 / `SP-22` §5 の `T-22-09`）
// ============================================================================
// 実利用者の指摘は 3 つだった: ①**開いた人が「いま何をすべきか」を数秒で把握できない**
// ②**要対応が Task Inbox になっていない** ③**`EmptyState` の下に大量のテキストリンクが並ぶ**。
//
// 🔴 ③ への対処が本ファイルの主眼である。移行前は `Card` の中に
// **`人材台帳を開く` / `案件一覧を開く` / `提案依頼の一覧を開く` / `提案の一覧を開く` /
// `利用量と上限を確認`（+ 取引先は `匿名共有の設定を開く`）の 5〜6 本のテキストリンクが横に並ぶ**
// だけのブロックが常時あった。これは**サイドバー（`AppShell`）の写し**であり、
// `docs/04` §S-003 が「🔴 独立したナビゲーションリンクの塊をホームに置かない ——
// ホームの縦幅を『サイドバーをもう一度読む』ことに使わせる」と名指ししたものである。
//
// 🔴 **撤去ではなく「値に紐づけ直し」である**（`docs/04` §S-003 改訂 16 / `U-22`。**testid の
//    改名・削除は 0 件**）:
//
// | 移行前（独立したリンクの塊） | 移行後の置き場所 | 根拠 |
// |---|---|---|
// | `案件一覧を開く`（`home-host-project-list` / `home-partner-project-list`） | 🔴 **`SummaryStrip` の `案件` の値** | §S-003「ストリップの各指標はリンクにしてよい。これは**値に紐づく文脈のあるリンク**であり、ナビの重複とは別物である」 |
// | `人材台帳を開く`（`home-*-engineer-ledger`） | 🔴 **同 `人材` の値** | 同（§S-003 改訂 16 は `S-005` への入口を「ストリップの `人材` の値」と明示する。`T-05-09` の決定はこの形で維持される） |
// | `提案の一覧を開く`（`home-*-proposals`） | 🔴 **同 `進行中の提案` の値** | 同 |
// | `匿名共有の設定を開く`（`home-partner-engineer-shares`） | 🔴 **同 `共有中` の値** | 同（到達できないロールでは `href` が `null` で値は文字のまま = **指標そのものは消さない**） |
// | `提案依頼の一覧を開く`（`home-*-proposal-requests`） | 🔴 **要対応キューのヘッダ右のテキストリンク**（`action-queue-section.tsx`） | §S-003「セクションのヘッダ右のテキストリンクは可」。キューには `提案依頼の返答待ち` の行が載るので、その全体（辞退・期限切れを含む）への入口は**そのセクションの文脈**である |
// | `利用量と上限を確認`（`home-host-usage`） | 🔴 **ストリップ直下の 1 行**（ホストのみ） | 残量は**件数**であり（`F-027 AC-6` / `CLAUDE.md` §2 課金）、件数の要約の直下が文脈になる。取引先側の同じ位置は §5-10 の「見える範囲の説明」である（§S-004「ストリップの直下に 1 行置く」） |
// | `案件を登録` / `人材を登録`（`home-host-register-*`） | 🔴 **`PageHeader` のアクション 2 つ**（primary + secondary） | §S-003 改訂 16「`PageHeader` のアクションは 2 つ（`案件を登録`〔primary〕+ `人材を登録`〔secondary〕）」 |
//
// 🔴 `S-003` / `S-004` は T1（モバイル完結）。Tailwind の既定ブレークポイントのみを使う
//    （独自定義しない。`CLAUDE.md` §13.3）。
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PRIMARY_LINK_CLASSES,
  SECONDARY_LINK_CLASSES,
  SummaryStrip,
  type SummaryStripItem,
  type SummaryStripLinkProps,
} from '@ses/ui';
import { t } from '@ses/i18n';
import { ENGINEER_LIST_PATH } from '../../../lib/engineers/list-rows';
import { ENGINEER_SHARE_PATH } from '../../../lib/engineer-shares/screen-query';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import { PROJECT_LIST_PATH } from '../../../lib/projects/list-rows';
import { USAGE_SETTINGS_HREF } from '../../../lib/proposals/hrefs';
import type { HomeBlock, ScanQuarantineHomeBlock } from '../../../lib/home/types';

/** `S-007`（人材の登録）/ `S-012`（案件の登録）。値の出所はここ 1 箇所。 */
export const ENGINEER_NEW_HREF = '/engineers/new';
export const PROJECT_NEW_HREF = '/projects/new';

/**
 * 🔴 ストリップの値リンク（ホスト）。**testid は三項演算子の各枝に文字列リテラルで書く**
 *    （`action-queue-section.tsx` の `ScopeLink` と同じ作法。`tests/static/testid-inventory.test.ts` が
 *    枝ごとに凍結する）。値は移行前の独立したリンクが持っていたものをそのまま引き継ぐ。
 */
function HostSummaryLink({ href, className, children }: SummaryStripLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      data-testid={
        href === PROJECT_LIST_PATH
          ? 'home-host-project-list'
          : href === ENGINEER_LIST_PATH
            ? 'home-host-engineer-ledger'
            : 'home-host-proposals'
      }
    >
      {children}
    </Link>
  );
}

/** 🔴 同（取引先）。`共有中` は `S-015` へ（到達できないロールでは `href` が `null` なので描かれない）。 */
function PartnerSummaryLink({ href, className, children }: SummaryStripLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      data-testid={
        href === PROJECT_LIST_PATH
          ? 'home-partner-project-list'
          : href === ENGINEER_LIST_PATH
            ? 'home-partner-engineer-ledger'
            : href === ENGINEER_SHARE_PATH
              ? 'home-partner-engineer-shares'
              : 'home-partner-proposals'
      }
    >
      {children}
    </Link>
  );
}

export type HomeSummaryProps = {
  /** `summaryStripItems(block)` の結果（3〜5 件。**0 の項目も含む**）。 */
  readonly items: readonly SummaryStripItem[];
  /**
   * 🔴 `isSummaryInitialEmpty(block)` の結果（**全 metric が 0** = 初回空）。判定は
   *    `lib/home/summary-view.ts` の 1 関数だけが持つ（docs/05 §6.11.1）。
   *    `true` のときストリップを描かず `EmptyState` に倒す（`docs/04` §S-003
   *    「`0` が 5 個並ぶ画面は『何も無い』ことだけを 5 回言う」）。
   */
  readonly initialEmpty: boolean;
};

/**
 * 🔴 `PageHeader` の **secondary アクション**（`docs/04` §S-003「アクションは 2 つだが primary は 1 つ」）。
 *
 * ⚠️ `@ses/ui` の `PageHeader` は **primary を 1 つしか受け取らない**（§7.6 の「primary は 1 つ」を
 *    型で守っている）。secondary はその直下の 1 行として置く —— **部品の API を変えない**
 *    （`T-22-05` の受け入れ基準）。
 * 🔴 `canRegisterEngineer` が `false`（`VIEWER`）なら**描かない**（`docs/04` §S-007 権限差分）。
 */
export function HostHeaderSecondaryAction({
  canRegisterEngineer,
}: {
  readonly canRegisterEngineer: boolean;
}) {
  if (!canRegisterEngineer) return null;
  return (
    <p className="mb-4">
      <Link
        className={SECONDARY_LINK_CLASSES}
        href={ENGINEER_NEW_HREF}
        data-testid="home-host-register-engineer"
      >
        {t('home.host.empty.registerEngineer')}
      </Link>
    </p>
  );
}

/**
 * `S-003` のストリップと初回空（docs/04 §S-003 改訂 16）。
 *
 * 🔴 **`EmptyState` の 3 段構造**（①説明 → ②Primary → ③Secondary）。初回空の語は
 *    `docs/04` §S-003 の文言をそのまま使う。🔴 **ナビゲーションの重複リンクを置かない**
 *    （`案件一覧を開く` / `提案一覧を開く` を `EmptyState` にも置かない）。
 * 🔴 導線が `false` のときは**描かない**（`docs/04` §S-007 / §S-012 権限差分「到達できない」）。
 *    ⚠️ これは UI の配慮であって境界の担保ではない（本体は `#16` / `#26` の `requireRole` と
 *    各画面のリダイレクト）。
 * 🔴 **2 つのフラグを 1 つにまとめない**（案件の登録はホストの 3 ロール、人材の登録は
 *    パートナーロールも含む。畳むとどちらかの画面で権限差分が実際とずれる）。
 */
export function HostHomeSections({
  summary,
  canRegisterEngineer,
  canRegisterProject,
}: {
  readonly summary: HomeSummaryProps;
  readonly canRegisterEngineer: boolean;
  readonly canRegisterProject: boolean;
}) {
  if (summary.initialEmpty) {
    return (
      <div className="mb-4" data-testid="home-host-summary">
        <EmptyState
          testIdPrefix="home-host-empty-state-"
          description={t('home.host.empty.description')}
          primary={
            canRegisterProject ? (
              <Link
                className={PRIMARY_LINK_CLASSES}
                href={PROJECT_NEW_HREF}
                data-testid="home-host-empty-register-project"
              >
                {t('home.host.empty.registerProject')}
              </Link>
            ) : undefined
          }
          secondary={
            canRegisterEngineer
              ? { href: ENGINEER_NEW_HREF, label: t('home.host.empty.registerEngineer') }
              : undefined
          }
          linkComponent={Link}
        />
      </div>
    );
  }
  return (
    <div className="mb-4" data-testid="home-host-summary">
      <SummaryStrip items={summary.items} testIdPrefix="home-host-summary-" linkComponent={HostSummaryLink} />
      {/* 🔴 ストリップ直下の 1 行（冒頭の表）。残量は**件数**であり金額を出さない（`F-027 AC-6`）。
          🔴 ホスト所属の 4 ロールすべてに出す（`VIEWER` も残量を閲覧できる。`F-027 AC-1`）。 */}
      <p className="mt-2">
        <Link className={SECONDARY_LINK_CLASSES} href={USAGE_SETTINGS_HREF} data-testid="home-host-usage">
          {t('usage.open')}
        </Link>
      </p>
    </div>
  );
}

/**
 * `S-004` のストリップと初回空（docs/04 §S-004 改訂 16）。
 *
 * 🔴 **`S-003` の「ついで」にしない**（`CLAUDE.md` §1.2。取引先は 1 日 4〜5 時間滞在する主利用者であり、
 *    同じ部品・同じ密度・同じ改訂を同時に受ける）。
 * 🔴 初回空の 3 段は ①「まだ御社に公開された案件はありません…」②`人材を登録`（primary）
 *    ③`共有の設定を見る`（テキストリンク。`S-015`）。🔴 **「ホストに問い合わせる」に相当する導線を置かない**
 *    （公開は相手の判断であり、催促の導線はホスト側の公開範囲設定を圧迫する。加えて
 *    「なぜ公開されないか」を説明できない）。
 * 🔴 **見える範囲の説明はストリップの直下に常設する**（`F-006 AC-2` / §5-10。件数の隣に母集団の説明が
 *    無いと「128 件」がテナント全体の数に読める）。**初回空でも出す。**
 */
export function PartnerHomeSections({
  summary,
  noticeText,
  canRegisterEngineer,
  canManageShares,
}: {
  readonly summary: HomeSummaryProps;
  readonly noticeText: string;
  readonly canRegisterEngineer: boolean;
  /**
   * 🔴 `S-015`（匿名共有の設定）へ到達できるか（`PARTNER_ADMIN` / `PARTNER_SALES` のみ。
   *    `docs/04` §S-015 権限差分 / docs/05 §6.4 #29）。
   */
  readonly canManageShares: boolean;
}) {
  return (
    <div className="mb-4" data-testid="home-partner-summary">
      {summary.initialEmpty ? (
        <EmptyState
          testIdPrefix="home-partner-empty-state-"
          description={t('home.partner.empty.title')}
          primary={
            canRegisterEngineer ? (
              <Link
                className={PRIMARY_LINK_CLASSES}
                href={ENGINEER_NEW_HREF}
                // 🔴 帯の primary（`page.tsx` の `home-partner-register-engineer`）と**別の testid** にする ——
                //    初回空では帯と `EmptyState` の両方に `人材を登録` が出るため、同じ値を 2 つ描かない。
                data-testid="home-partner-empty-register-engineer"
              >
                {t('home.host.empty.registerEngineer')}
              </Link>
            ) : undefined
          }
          secondary={
            canManageShares ? { href: ENGINEER_SHARE_PATH, label: t('engineerShares.open') } : undefined
          }
          linkComponent={Link}
        />
      ) : (
        <SummaryStrip
          items={summary.items}
          testIdPrefix="home-partner-summary-"
          linkComponent={PartnerSummaryLink}
        />
      )}
      {/* 🔴 F-006 AC-2: 固定文言のみ（件数・存在の示唆を一切含まない）。常時表示。 */}
      <p className="mt-2 text-xs text-fg-muted" data-testid="home-partner-visibility-notice">
        {noticeText}
      </p>
    </div>
  );
}

/**
 * 🔴 スキャン失敗・隔離の周知（`docs/02` `F-011` 処理④ / `docs/04` §S-008「スキャン失敗 /
 *    感染検出」）。T-05-08。
 *
 * ============================================================================
 * 🔴 なぜホームに出すのか
 * ============================================================================
 * `S-008`（スキルシートの版一覧）には既に状態バッジがあるが、**そのエンジニアの画面を開かないと
 * 見えない**。隔離は「上げ直す」までファイルが一切使えない状態であり、気づかれないまま放置されると
 * 提案の直前に発覚する。`F-011` 処理④ が「担当者に周知する」と定めているのはこのためである。
 *
 * 🔴 **位置は `SummaryStrip` の下・要対応キューの上**（`docs/04` §S-003 改訂 16。T-22-09 で明示）——
 *    ストリップは常時あり、この節は 0 件なら出ない。**出たり消えたりするものを常時あるものより
 *    上に置くと、画面の骨格が日によって変わって走査の記憶が効かなくなる。**
 * 🔴 **宛先分類によらず必ず描く。** `sandbox` では取引先の担当者宛のメールがモックになる
 *    （`A-22` / `CLAUDE.md` §11.1）ため、パートナーにとってはここが唯一の気づく場所である。
 * 🔴 **ロールで隠さない。** `VIEWER` も見える —— 見せないと「なぜダウンロードできないのか」が
 *    分からないままになる。
 * 🔴 氏名を出さない（`BR-27`。ホームは 60 秒ごとに読み直される画面であり、氏名を出すと
 *    `engineer.view` の記録が毎分積まれる）。誰のものかは、行から辿った `S-008` が示す。
 * 🔴 **0 件のときはセクションごと出さない**（`docs/04` §S-004「0 件を出すと圧に見える」と同じ判断）。
 * 🔴 T-22-09: 色は **`--color-warning-*`（橙）** である。**赤にしない** —— §7.4 は赤を
 *    `SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` の 3 状態専用と定めており、隔離は
 *    「**別の版を上げ直せば進む**」ものである（外部で事故が起きたわけではない）。
 */
export function ScanQuarantineSection({ blocks }: { readonly blocks: readonly HomeBlock[] }) {
  const block = blocks.find(
    (candidate): candidate is ScanQuarantineHomeBlock => candidate.kind === 'SCAN_QUARANTINE',
  );
  if (block === undefined || block.items.length === 0) return null;

  return (
    <Card className="mb-4 border-warning-border bg-warning-bg" data-testid="home-scan-quarantine">
      <CardHeader>
        <CardTitle>{t('home.scanQuarantine.title')}</CardTitle>
        <CardDescription className="text-fg">{t('home.scanQuarantine.lead')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {block.items.map((item) => (
            <li
              key={item.skillSheetId}
              className="flex flex-wrap items-center gap-2 text-body text-fg"
              data-testid={`home-scan-quarantine-item-${item.skillSheetId}`}
              data-scan-status={item.scanStatus}
            >
              {/* 🔴 状態は語のまま出す（`StatusBadge` を使わない）—— 隔離の 3 値（`INFECTED` /
                  `UNSCANNABLE` / `FAILED`）は §5-1 の 36 状態でも公開の 4 値でもなく、
                  表に足すには `docs/04` §5-1 の改訂が要る。 */}
              <span className="font-semibold">{t(`skillSheets.scanStatus.${item.scanStatus}`)}</span>
              <span>
                {t('skillSheets.versions.versionPrefix')}
                {item.version}
              </span>
              {item.detectedAt === null ? null : (
                <span className="text-fg-muted">{formatDateTimeJst(item.detectedAt)}</span>
              )}
              {/* 🔴 行き止まりにしない —— 次の行動（上げ直す / 削除する）は `S-008` にある。 */}
              <Link
                className={SECONDARY_LINK_CLASSES}
                href={`/engineers/${item.engineerId}/skill-sheets`}
                data-testid={`home-scan-quarantine-link-${item.skillSheetId}`}
              >
                {t('home.scanQuarantine.open')}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
