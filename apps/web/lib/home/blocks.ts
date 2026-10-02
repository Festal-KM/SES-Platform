// apps/web/lib/home/blocks.ts
// 🔴 ホーム（`S-003` / `S-004`）に載せるブロックの組み立て。T-05-08。✅ T-12-15 で要対応キュー（`ACTION_QUEUE`）を足した。
//
// ============================================================================
// 🔴 なぜ `getHomeView` から切り離すのか
// ============================================================================
// `getHomeView` は「ロールと所属だけで応答の**型**を決める」純粋関数のままにしておきたい
// （`F-006 AC-1` / `AC-2` の境界は DB を立てずにテストできるべきである）。DB を読む必要が
// あるのは中身（`blocks`）だけなので、そちらをこのファイルに寄せる。
//
// 🔴 **ブロックが空でもセクションを消さない**判断は画面側（`home-sections.tsx` / `action-queue-section.tsx`）が持つ。
//    ここは「何があるか」だけを返す。
//
// ============================================================================
// 🔴 ホームが 1 リクエストに足すトランザクションの本数（T-22-09。`tests/isolation/shell-header.test.ts` ⑤ と同じ作法）
// ============================================================================
// 🔴 **この数が増えたら、60 秒ごとのポーリングがその分だけ重くなる**（`CLAUDE.md` §7 の p95）。
//    増やすときはこの表と `./blocks.transactions.test.ts` の期待値を必ず一緒に直すこと。
//
// | ブロック | 読み取り | トランザクション | Phase |
// |---|---|---|---|
// | `SCAN_QUARANTINE` | `readQuarantinedSkillSheets` | **1 本** | 1 |
// | `ACTION_QUEUE` | `readActionQueueWithSummary` | **1 本** | 1 |
// | `SUMMARY` | 🔴 **同じ `withTenant` に相乗り**（`readSummaryCounts`。✅ 改訂 23 で KPI 4 枚になったが**本数は +0 本のまま**。`今日やること` は要対応キューの行数そのものでクエリ 0 本） | **+0 本** | 1 |
// | 送信ドメインの事実（`actionAvailability` の条件 ④） | 🔴 **同じ `withTenant` に相乗り** | **+0 本** | 1 |
// | 合計 | | 🔴 **2 本**（ホスト / 取引先とも） | 1 |
//
// 🔴 Phase 2 は **ホスト +0 本**（`ASSIGNMENTS_ACTIVE` はセクション 2〔満了が近い稼働〕の
//    `withHostTenant` に相乗りする）/ **取引先 +1 本**（`partner_assignment_v` 越しでしか読めず避けられない。
//    docs/05 §6.11.1 の表）。
// 🔴 `apps/web/app/(main)/layout.tsx` の**外枠**の表（ホスト 4 / 取引先 3）は変わらない ——
//    ストリップは外枠ではなく**画面**の読み取りである。
import type { AuthenticatedTenantCtx } from '@ses/db';
import { readQuarantinedSkillSheets } from '../skill-sheets/service';
import { readActionQueueWithSummary } from './action-queue-read';
import { DEFAULT_HOME_SCOPE, type HomeScope } from './schemas';
import type { HomeBlock } from './types';

export type HomeBlocksOptions = {
  /** 「自分の担当のみ」（既定）/ 組織全体。要対応キューだけが使う（隔離の周知は担当で絞らない）。 */
  readonly scope?: HomeScope;
  /**
   * 🔴 T-22-09: 送信ドメインの検証が要る環境か（`sendingDomainRuntime().verificationRequired`）。
   *    **必須にする** —— 既定値を置くと、渡し忘れた経路だけが `RESEND` の可否を別の前提で決める。
   */
  readonly sendingDomainVerificationRequired: boolean;
  /**
   * 60 秒ポーリングの差分応答（前回応答の `changedSince`）。`null` / 未指定なら全行。
   * 🔴 T-12-15 指摘 4: 前回応答の `changedSince` は読み取り時刻から安全マージン分だけ過去に丸められている
   *    （`apps/web/lib/home/service.ts` の `getHomeView` / `CHANGED_SINCE_SAFETY_MARGIN_MS`）。ここでの比較は
   *    その丸めた値をそのまま使うだけでよい（`>=` の重複は `targetId` 上書きで無害。`action-queue.ts` の注記）。
   */
  readonly changedSince?: Date | null;
  /**
   * 🔴 ✅ 2026-10-02（改訂 23）: KPI カードの差分の基準時刻。**必須**（`./periods.ts` の 🔴 ——
   *    応答の `changedSince`（挨拶行の「◯時◯分 時点」）と**同じインスタンス**を渡す）。
   */
  readonly now: Date;
};

/**
 * 🔴 ホームのブロックを読む（`GET /api/home` / `S-003` / `S-004` の共通経路）。
 *
 * 🔴 **ホストとパートナーで分岐しない。** 中身の境界は RLS（`skill_sheets` = C3 / `proposals` `proposal_requests` = C5）が
 *    決めており、アプリ側で `audience` を見て絞り直すと、境界の担保が条件式に移る（`F-011` 処理④ は「アプリ内表示は
 *    分類によらず必ず行う」）。要対応キューが所属で分けるのは**工程と「担当」の定義**だけである（`action-queue-read.ts` 冒頭）。
 * 🔴 隔離の周知は 0 件ならブロックを出さない（気づくべき事象が無い）。要対応キューは 0 件でも出す（「空である」ことを画面が明示する）。
 * 🔴 隔離の周知は `scope` で絞らない（T-05-08 の判断: 隔離は「誰の担当か」より先に片付けるべき事象であり、絞ると気づけない人が生まれる）。
 */
export async function readHomeBlocks(
  ctx: AuthenticatedTenantCtx,
  options: HomeBlocksOptions,
): Promise<readonly HomeBlock[]> {
  const [quarantined, { actionQueue, summary }] = await Promise.all([
    readQuarantinedSkillSheets(ctx),
    readActionQueueWithSummary(ctx, {
      scope: options.scope ?? DEFAULT_HOME_SCOPE,
      changedSince: options.changedSince ?? null,
      sendingDomainVerificationRequired: options.sendingDomainVerificationRequired,
      now: options.now,
    }),
  ]);
  // 🔴 T-22-09: `SUMMARY` は**常に**返す（0 件でも `count: 0`。描かない判断は画面側の 1 箇所）。
  const blocks: HomeBlock[] = [summary];
  if (quarantined.length > 0) {
    blocks.push({
      kind: 'SCAN_QUARANTINE',
      items: quarantined.map((sheet) => ({
        skillSheetId: sheet.id,
        engineerId: sheet.engineerId,
        version: sheet.version,
        scanStatus: sheet.scanStatus,
        detectedAt: sheet.detectedAt,
      })),
    });
  }
  blocks.push(actionQueue);
  return blocks;
}
