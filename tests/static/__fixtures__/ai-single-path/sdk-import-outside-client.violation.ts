// 違反: @anthropic-ai/sdk の import が packages/ai/src/client.ts 以外で行われている（CLAUDE.md §3.2 ④）
import Anthropic from '@anthropic-ai/sdk';

export const client = new Anthropic();
