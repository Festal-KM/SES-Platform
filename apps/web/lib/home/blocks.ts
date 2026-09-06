// apps/web/lib/home/blocks.ts
// 🔴 ホーム（`S-003` / `S-004`）に載せるブロックの組み立て。T-05-08。
//
// ============================================================================
// 🔴 なぜ `getHomeView` から切り離すのか
// ============================================================================
// `getHomeView` は「ロールと所属だけで応答の**型**を決める」純粋関数のままにしておきたい
// （`F-006 AC-1` / `AC-2` の境界は DB を立てずにテストできるべきである）。DB を読む必要が
// あるのは中身（`blocks`）だけなので、そちらをこのファイルに寄せる。
//
// 🔴 **ブロックが空でもセクションを消さない**判断は画面側（`home-sections.tsx`）が持つ。
//    ここは「何があるか」だけを返す。
import type { AuthenticatedTenantCtx } from '@ses/db';
import { readQuarantinedSkillSheets } from '../skill-sheets/service';
import type { HomeBlock } from './types';

/**
 * 🔴 ホームのブロックを読む（`GET /api/home` / `S-003` / `S-004` の共通経路）。
 *
 * 🔴 **ホストとパートナーで分岐しない。** 中身の境界は `skill_sheets` の RLS
 *    （C3 OWNER_SCOPED）が決めており、アプリ側で `audience` を見て絞り直すと、
 *    境界の担保が条件式に移る（`F-011` 処理④ は「アプリ内表示は分類によらず必ず行う」）。
 */
export async function readHomeBlocks(ctx: AuthenticatedTenantCtx): Promise<readonly HomeBlock[]> {
  const quarantined = await readQuarantinedSkillSheets(ctx);
  if (quarantined.length === 0) return [];
  return [
    {
      kind: 'SCAN_QUARANTINE',
      items: quarantined.map((sheet) => ({
        skillSheetId: sheet.id,
        engineerId: sheet.engineerId,
        version: sheet.version,
        scanStatus: sheet.scanStatus,
        detectedAt: sheet.detectedAt,
      })),
    },
  ];
}
