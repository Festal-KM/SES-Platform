import { HOSTS } from './common.mjs';
// デモの合成アカウントだけでDB接続と認証を確認する。本番のアカウントやキーは使わない。
export async function verifyDemoSignIn(request = globalThis.fetch) {
  const base = `https://${HOSTS.demo}`;
  const response = await request(`${base}/api/auth/test-signin`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ accountId: 'f0000000-0000-4000-8000-000000000001' }), signal: globalThis.AbortSignal.timeout(30_000),
  });
  if (response.status !== 200 || (await response.json()).next !== 'home') throw new Error('デモの合成アカウントで認証できません');
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('デモの認証セッションが発行されていません');
  const projects = await request(`${base}/api/projects`, { redirect: 'manual', headers: { cookie }, signal: globalThis.AbortSignal.timeout(30_000) });
  if (projects.status !== 200 || !projects.headers.get('content-type')?.includes('application/json')) throw new Error('デモの認証後APIが正常応答しません');
}
