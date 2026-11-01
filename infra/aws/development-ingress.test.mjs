import test from 'node:test';
import assert from 'node:assert/strict';
import { developmentIngressTemplate } from './development-ingress.mjs';
test('AWS開発画面の入口はHTTPSで、アプリへの接続はALBだけに限定する', () => {
  const { Resources: r } = developmentIngressTemplate();
  assert.deepEqual(r.Network.Properties.SecurityGroupIngress.map((rule) => rule.FromPort), [80, 443]);
  assert.equal(r.ApplicationIngress.Properties.FromPort, 3000);
  assert.deepEqual(r.ApplicationIngress.Properties.SourceSecurityGroupId, { Ref: 'Network' });
  assert.equal(r.ApplicationIngress.Properties.CidrIp, undefined);
  assert.equal(r.Redirect.Properties.DefaultActions[0].RedirectConfig.Protocol, 'HTTPS');
  assert.deepEqual(r.Target.Properties.Targets[0].Id, { Ref: 'InstanceId' });
});
