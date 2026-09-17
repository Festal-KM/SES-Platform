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
import type { AuthenticatedTenantCtx } from '@ses/db';
import { readQuarantinedSkillSheets } from '../skill-sheets/service';
import { readActionQueueBlock } from './action-queue-read';
import { DEFAULT_HOME_SCOPE, type HomeScope } from './schemas';
import type { HomeBlock } from './types';

export type HomeBlocksOptions = {
  /** 「自分の担当のみ」（既定）/ 組織全体。要対応キューだけが使う（隔離の周知は担当で絞らない）。 */
  readonly scope?: HomeScope;
  /**
   * 60 秒ポーリングの差分応答（前回応答の `changedSince`）。`null` / 未指定なら全行。
   * 🔴 T-12-15 指摘 4: 前回応答の `changedSince` は読み取り時刻から安全マージン分だけ過去に丸められている
   *    （`apps/web/lib/home/service.ts` の `getHomeView` / `CHANGED_SINCE_SAFETY_MARGIN_MS`）。ここでの比較は
   *    その丸めた値をそのまま使うだけでよい（`>=` の重複は `targetId` 上書きで無害。`action-queue.ts` の注記）。
   */
  readonly changedSince?: Date | null;
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
  options: HomeBlocksOptions = {},
): Promise<readonly HomeBlock[]> {
  const [quarantined, actionQueue] = await Promise.all([
    readQuarantinedSkillSheets(ctx),
    readActionQueueBlock(ctx, { scope: options.scope ?? DEFAULT_HOME_SCOPE, changedSince: options.changedSince ?? null }),
  ]);
  const blocks: HomeBlock[] = [];
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
