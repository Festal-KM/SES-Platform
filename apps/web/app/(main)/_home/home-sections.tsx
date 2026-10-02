// apps/web/app/(main)/_home/home-sections.tsx
// `S-003`（ホスト）/ `S-004`（取引先）の**サーバ描画の部分**（docs/04 §4.1 / §7.2 / `F-006`）。
//
// ============================================================================
// 🔴 2026-10-02（改訂 23）で何を変えたか
// ============================================================================
// 改訂 16 の `SummaryStrip`（台帳の総数 5 件）は **KPI カード 4 枚**に置き換わった（`U-24`）。
// したがって本ファイルの役割は次の 4 つになった（**器は `./home-screen.tsx` が持つ**）:
//
//   ① **KPI カード直下の 1 行** … ホスト = 利用量（件数）/ 取引先 = 見える範囲の説明（`F-006 AC-2`）
//   ② **`案件` / `人材` タブの面** … Phase 1 は**行を持たない**（下の 🔴）。一覧への 1 本だけを置く
//   ③ **初回空の `EmptyState`**（3 段構造）
//   ④ **セクション ✅ 0（共有できないスキルシート）** … 位置はタブより上（`./home-screen.tsx`）
//
// 🔴 **`案件` / `人材` タブに行を置かなかった理由**（`docs/04` §4.1 の割り振り表に対する差分。
//    **実装上の都合ではなく、守るべき規律がそう要求している**）:
//   - `人材` の 2 セクション（`稼働可能時期が近い人材` / `待機予定に戻った人材`）は**氏名を出す行**に
//     なる。🔴 **ホームに氏名を出さない**（`BR-27`。ホームは 60 秒ポーリングであり、氏名を出すと
//     `engineer.view` の監査ログが**毎分積まれて**「誰の経歴を誰がいつ見たか」が読めなくなる）。
//     加えて `tests/static/home-drawer-no-ledger.test.ts` (l) は `lib/home/**` と `_home/**` から
//     台帳のデリゲート（`engineer` 等）への到達を**例外 2 系統以外すべて禁じている**。
//   - `案件` の 2 セクション（`公開範囲が未設定の案件` / `後任募集の案件`）のうち、後者は
//     `Assignment`（Phase 2）に依る。前者は Phase 1 でも描けるが、🔴 **`docs/04` §4.1 は「0 件の
//     セクションは見出しごと描かない」とも定めており、片方だけ入れると `案件` タブと `人材` タブで
//     密度が揃わない**（`CLAUDE.md` §1.2 の「取引先を簡易版にしない」と同じ理由で、面ごとの
//     密度差も作らない）。
//   🔴 したがって 2 つの面には **①何を出す面なのか ②いまどこで見られるか** を 1 行で置く
//     （`EmptyState` の 3 段構造）。**「0 件」と書かない**（案件も人材も在るのに「ありません」は嘘になる）。
//   ⚠️ 行を入れるには `docs/04` §4.1 に「ホームで氏名を出さずに人材の行をどう出すか」が要る
//     （`CLAUDE.md` §8.7。実装側で決めない）。
//
// 🔴 **凍結済みの `data-testid` を 1 つも落としていない**（`U-22`）。改訂 16 で `SummaryStrip` の
//    値に紐づいていた 4 本の導線は、**タブの面の `EmptyState` の導線**へ移した:
//
// | 凍結値 | 改訂 16 の置き場所 | 改訂 23 の置き場所 |
// |---|---|---|
// | `home-host-project-list` / `home-partner-project-list` | ストリップの `案件` の値 | 🔴 `案件` タブの導線 |
// | `home-host-engineer-ledger` / `home-partner-engineer-ledger` | 同 `人材` | 🔴 `人材` タブの導線 |
// | `home-partner-engineer-shares` | 同 `共有中` | 🔴 `人材` タブの 2 本目（`S-015`。到達できるロールのみ） |
// | `home-host-proposals` / `home-partner-proposals` | 同 `進行中の提案` | 🔴 要対応セクションの `すべて見る`（`page.tsx` が渡す） |
// | `home-host-usage` | ストリップ直下の 1 行 | 🔴 **KPI カード直下の 1 行**（同じ位置） |
import type { ReactNode } from 'react';
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
 * 🔴 `PageHeader` の **secondary アクション**（`docs/04` §4.1「アクションは 2 つだが primary は 1 つ」）。
 *
 * ⚠️ `@ses/ui` の `PageHeader` は **primary を 1 つしか受け取らない**（§7.6 の「primary は 1 つ」を
 * 型で守っている）。secondary はその直下の 1 行として置く —— **部品の API を変えない**。
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
 * 🔴 KPI カード直下の 1 行（ホスト = 利用量）。
 * 残量は**件数**であり金額を出さない（`F-027 AC-6` / `CLAUDE.md` §2 課金）。
 * 🔴 ホスト所属の 4 ロールすべてに出す（`VIEWER` も残量を閲覧できる。`F-027 AC-1`）。
 */
export function HostUsageLine() {
  return (
    <p className="mt-2">
      <Link className={SECONDARY_LINK_CLASSES} href={USAGE_SETTINGS_HREF} data-testid="home-host-usage">
        {t('usage.open')}
      </Link>
    </p>
  );
}

/**
 * 🔴 KPI カード直下の 1 行（取引先 = 見える範囲の説明）。`F-006 AC-2` の常設ブロックである。
 * 🔴 **件数の隣に母集団の説明が無いと、数がテナント全体のものに読める**（§5-10。位置は改訂 23 で
 *    ストリップ直下 → KPI カード直下に移ったが、**常設であることは変えていない**）。
 */
export function PartnerVisibilityNoticeLine({ noticeText }: { readonly noticeText: string }) {
  return (
    <p className="mt-2 text-xs text-fg-muted" data-testid="home-partner-visibility-notice">
      {noticeText}
    </p>
  );
}

/**
 * `案件` タブの面（🔴 **行を持たない**。ファイル冒頭の 🔴）。
 *
 * 🔴 `EmptyState` の 3 段構造（①説明 → ②Primary → ③Secondary）。ここでの Primary は
 *    **一覧への遷移**であり、作成系ではない（押せる相手を選ばない導線にする）。
 */
export function ProjectsTabPanel({ audience }: { readonly audience: 'HOST' | 'PARTNER' }) {
  return (
    <div data-testid="home-projects-panel">
      <EmptyState
        testIdPrefix="home-projects-panel-"
        description={
          audience === 'HOST'
            ? t('home.tab.projects.pending.host')
            : t('home.tab.projects.pending.partner')
        }
        primary={
          <Link
            className={PRIMARY_LINK_CLASSES}
            href={PROJECT_LIST_PATH}
            // 🔴 凍結済みの値（`U-22`）。三項の各枝に**文字列リテラル**で書く（`testid-inventory` が枝ごとに凍結する）。
            data-testid={audience === 'HOST' ? 'home-host-project-list' : 'home-partner-project-list'}
          >
            {t('home.tab.projects.open')}
          </Link>
        }
        linkComponent={Link}
      />
    </div>
  );
}

/**
 * `人材` タブの面（🔴 **行を持たない**。ファイル冒頭の 🔴 —— 氏名をホームに出さない）。
 *
 * 🔴 取引先には `共有の設定`（`S-015`）への 2 本目を置く（**到達できるロールだけ**。
 *    `PARTNER_ADMIN` / `PARTNER_SALES`。`docs/04` §S-015 権限差分 / docs/05 §6.4 #29）。
 */
export function EngineersTabPanel({
  audience,
  canManageShares,
}: {
  readonly audience: 'HOST' | 'PARTNER';
  readonly canManageShares: boolean;
}) {
  return (
    <div data-testid="home-engineers-panel">
      <EmptyState
        testIdPrefix="home-engineers-panel-"
        description={
          audience === 'HOST'
            ? t('home.tab.engineers.pending.host')
            : t('home.tab.engineers.pending.partner')
        }
        primary={
          <Link
            className={PRIMARY_LINK_CLASSES}
            href={ENGINEER_LIST_PATH}
            data-testid={
              audience === 'HOST' ? 'home-host-engineer-ledger' : 'home-partner-engineer-ledger'
            }
          >
            {t('home.tab.engineers.open')}
          </Link>
        }
        secondary={
          audience === 'PARTNER' && canManageShares
            ? { href: ENGINEER_SHARE_PATH, label: t('engineerShares.open') }
            : undefined
        }
        linkComponent={PartnerShareLink}
      />
    </div>
  );
}

/**
 * 🔴 `EmptyState` の secondary が `S-015` を指すときの testid（凍結値 `home-partner-engineer-shares`）。
 * ⚠️ `EmptyState` は secondary をこの部品で描くので、**値はここで文字列リテラルとして持つ**
 *    （`testid-inventory` が静的に解けること）。他の href を渡した場合は素の `<a>` 相当に落とす。
 */
function PartnerShareLink({
  href,
  className,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  if (href === ENGINEER_SHARE_PATH) {
    return (
      <Link href={href} className={className} data-testid="home-partner-engineer-shares">
        {children}
      </Link>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/**
 * ホストの初回空（`docs/04` §4.1 の `EmptyState` の 3 段構造）。
 *
 * 🔴 **初回空では KPI カード・タブ・右レールを描かない**（`0` が 4 個並ぶ画面を作らない。改訂 23）。
 *    判定（`initialEmpty`）はサーバが数え、分岐は `lib/home/summary-view.ts` の 1 関数が持つ。
 * 🔴 **ナビゲーションの重複リンクを置かない**（`案件一覧を開く` を `EmptyState` にも置かない）。
 * 🔴 導線が `false` のときは**描かない**（`docs/04` §S-007 / §S-012 権限差分「到達できない」）。
 */
export function HostHomeEmptyState({
  canRegisterEngineer,
  canRegisterProject,
}: {
  readonly canRegisterEngineer: boolean;
  readonly canRegisterProject: boolean;
}) {
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

/**
 * 取引先の初回空（`docs/04` §4.1）。
 *
 * 🔴 **`S-003` の「ついで」にしない**（`CLAUDE.md` §1.2）。
 * 🔴 ①「まだ御社に公開された案件はありません…」②`人材を登録`（primary）③`共有の設定を見る`
 *    （テキストリンク。`S-015`）。🔴 **「ホストに問い合わせる」に相当する導線を置かない**。
 * 🔴 **見える範囲の説明は初回空でも出す**（`F-006 AC-2`。呼び出し側が KPI の位置に置く）。
 */
export function PartnerHomeEmptyState({
  canRegisterEngineer,
  canManageShares,
}: {
  readonly canRegisterEngineer: boolean;
  readonly canManageShares: boolean;
}) {
  return (
    <div className="mb-4" data-testid="home-partner-summary">
      <EmptyState
        testIdPrefix="home-partner-empty-state-"
        description={t('home.partner.empty.title')}
        primary={
          canRegisterEngineer ? (
            <Link
              className={PRIMARY_LINK_CLASSES}
              href={ENGINEER_NEW_HREF}
              // 🔴 帯の primary（`page.tsx` の `home-partner-register-engineer`）と**別の testid** にする。
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
 * 🔴 **位置は KPI カードの下・タブの上**（改訂 23 で確定）—— タブの内側に入れると
 *    `案件` / `人材` タブを見ている間に消える。**隔離はどのタブに居ても見えていなければならない。**
 * 🔴 **宛先分類によらず必ず描く。** `sandbox` では取引先の担当者宛のメールがモックになる
 *    （`A-22` / `CLAUDE.md` §11.1）ため、パートナーにとってはここが唯一の気づく場所である。
 * 🔴 **ロールで隠さない。** `VIEWER` も見える。
 * 🔴 氏名を出さない（`BR-27`）。誰のものかは、行から辿った `S-008` が示す。
 * 🔴 **0 件のときはセクションごと出さない**。
 * 🔴 色は **`--color-warning-*`（橙）**。**赤にしない**（§7.4 は赤を `SUBMIT_FAILED` /
 *    `SEND_FAILED` / `SUSPENDED` の 3 状態専用と定める。隔離は「別の版を上げ直せば進む」）。
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
