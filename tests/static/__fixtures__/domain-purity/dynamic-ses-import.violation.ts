// 違反: 動的 import (import()) にも同じ制限が適用される（静的 import の迂回経路）。
export async function loadDb() {
  const mod = await import('@ses/db');
  return mod;
}
