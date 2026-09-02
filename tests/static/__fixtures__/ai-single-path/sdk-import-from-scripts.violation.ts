// 違反: scripts/** から @anthropic-ai/sdk を直接 import している（CLAUDE.md §3.2 ④）
// scripts/** は以前 lint 対象から丸ごと除外されていたため、この形が素通りしていた。
import Anthropic from '@anthropic-ai/sdk';

export const client = new Anthropic();
