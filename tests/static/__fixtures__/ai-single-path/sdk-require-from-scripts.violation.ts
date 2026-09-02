// 違反: scripts/**（CommonJS の .cjs）から @anthropic-ai/sdk を require() している（CLAUDE.md §3.2 ④）。
// no-restricted-imports は require() を検出しないため、no-restricted-syntax 側で塞ぐ。
const Anthropic = require('@anthropic-ai/sdk');

export const client = new Anthropic();
