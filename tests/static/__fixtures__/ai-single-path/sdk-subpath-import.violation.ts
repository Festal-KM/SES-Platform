// 違反: @anthropic-ai/sdk のサブパスを packages/ai/src/client.ts 以外で import している（CLAUDE.md §3.2 ④）
import Core from '@anthropic-ai/sdk/core';

export const use = () => Core;
