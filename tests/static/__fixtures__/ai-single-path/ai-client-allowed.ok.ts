// 対照: packages/ai/src/client.ts だけが @anthropic-ai/sdk を import できる（CLAUDE.md §3.2 ④ の例外経路）
import Anthropic from '@anthropic-ai/sdk';

export const client = new Anthropic({ apiKey: 'placeholder' });
