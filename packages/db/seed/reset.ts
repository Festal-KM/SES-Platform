// packages/db/seed/reset.ts
// 🔴 `reset()` = 対象プリセットのテナントの業務データ削除（docs/05 §13.6 / F-053 AC-2）。
//
// 🔴 環境ガードの**後**にしか呼ばれてはならない（docs/05 §13.6 の図の注記。F-053 AC-6）。
//    それを規約ではなく構造で守るため、この関数は `runSeed()`（seed/index.ts）からのみ
//    呼ばれ、`runSeed()` は先頭で `assertSeedableAppEnv()` を通す。
import type { PrismaClient } from '@prisma/client';
import { deleteTenantData } from '../src/seed-sql.js';
import type { SeedPreset } from './types.js';

/**
 * プリセットが作るテナントの業務データを削除する。
 *
 * 🔴 消す範囲は**そのプリセットのテナント ID だけ**である（テーブル全体を空にしない）。
 *    同じ DB に他のプリセットや手動で作ったテナントがあっても巻き添えにしない。
 * 🔴 `reset()` → `seed()` の 2 段階で冪等になる（F-053 AC-2）。`seed()` 側は固定 ID で
 *    投入するため、reset を挟まずに 2 回実行すると一意制約で失敗する（= 気づける）。
 */
export async function resetPreset(db: PrismaClient, preset: SeedPreset): Promise<void> {
  await deleteTenantData(db, preset.tenantIds);
}
