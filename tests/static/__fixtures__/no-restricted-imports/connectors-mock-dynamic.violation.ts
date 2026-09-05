// 違反 fixture: モック実装への動的 import。
export async function load() {
  return import('@ses/connectors/mock');
}
