#!/usr/bin/env node
import { ingressTemplate } from '../infra/aws/application.mjs';
import { assertAccount, assertEnvironment, aws, deployStack, stackOutputs, HOSTS } from './aws/common.mjs';
try {
  const [environment, ...rest] = process.argv.slice(2);
  assertEnvironment(environment);
  if (environment === 'development' || rest.length) throw new Error('使い方: node scripts/aws-provision-ingress.mjs demo|production');
  assertAccount();
  const prefix = `ses-platform-${environment}`;
  const foundation = stackOutputs(`${prefix}-foundation`);
  const application = stackOutputs(`${prefix}-application`);
  const certificateArn = aws(['ssm', 'get-parameter', '--name', `/ses-platform/${environment}/certificate-arn`]).Parameter.Value;
  const certificate = aws(['acm', 'describe-certificate', '--certificate-arn', certificateArn]).Certificate;
  if (certificate.Status !== 'ISSUED' || certificate.DomainName !== HOSTS[environment]) throw new Error('CloudflareのDNS検証が完了した環境専用の証明書が必要です');
  deployStack(`${prefix}-ingress`, ingressTemplate(environment), [
    `VpcId=${foundation.VpcId}`, `PublicSubnets=${foundation.PublicSubnetA},${foundation.PublicSubnetC}`,
    `CertificateArn=${certificateArn}`, `ApplicationSecurityGroup=${application.ApplicationSecurityGroup}`,
  ]);
  console.log(JSON.stringify({ environment, url: `https://${HOSTS[environment]}`, cloudflareRecord: {
    type: 'CNAME', name: HOSTS[environment].split('.')[0], target: stackOutputs(`${prefix}-ingress`).Hostname, proxy: 'DNS only', ttl: 'Auto',
  } }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
