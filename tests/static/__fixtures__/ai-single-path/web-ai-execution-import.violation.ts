// 違反: apps/web から @ses/ai の**実行系**（クライアントの組み立て・ロールの実行）を import している
//（docs/05 §1.2「apps/web に LLM 呼び出しを置かない」/ CLAUDE.md §3.2「記録しない呼び出し経路を作らない」）。
//   T-08-06 で apps/web が @ses/ai に依存するようになったため、依存の有無ではなく import 名で塞ぐ。
import { createAiClient, createRoleRunner } from '@ses/ai';

export const violation = [createAiClient, createRoleRunner];
