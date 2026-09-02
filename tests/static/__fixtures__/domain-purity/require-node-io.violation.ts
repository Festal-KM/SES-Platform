// 違反: require() 経由の Node I/O import も検出対象（動的 import と同様の迂回経路）。
// @ts-nocheck — CommonJS の require() を模した fixture であり型チェック対象外（検査対象は AST のみ）。
export function loadCrypto() {
  const crypto = require('node:crypto');
  return crypto;
}
