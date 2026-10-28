import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDemoSignIn } from './smoke-demo.mjs';
test('合成ユーザーのセッションを同じデモ環境のAPIだけに渡して確認する', async () => {
  const calls = [];
  await verifyDemoSignIn(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response(JSON.stringify({ next: 'home' }), { headers: { 'content-type': 'application/json', 'set-cookie': 'ses.session-token=fixture; HttpOnly; Secure' } })
      : new Response('{}', { headers: { 'content-type': 'application/json' } });
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://demo-es.bizorch.com/api/projects');
  assert.equal(calls[1].options.headers.cookie, 'ses.session-token=fixture');
});
test('認証失敗・想定外の2FA・セッション欠落はAPI確認へ進まない', async () => {
  for (const response of [new Response('{}', { status: 401 }), new Response('{"next":"two-factor"}'), new Response('{"next":"home"}')]) {
    let calls = 0;
    await assert.rejects(() => verifyDemoSignIn(async () => { calls++; return response; }));
    assert.equal(calls, 1);
  }
});
