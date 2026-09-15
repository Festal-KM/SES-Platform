// 違反: 名前空間 import は実行系を含む @ses/ai の全メンバーに到達できる（許可リストで判定できない）。
import * as ai from '@ses/ai';

export const violation = ai.createAiClient;
