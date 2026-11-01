#!/usr/bin/env node
import { developmentIngressTemplate } from '../infra/aws/development-ingress.mjs';
import { assertAccount, aws, deployStack, stackOutputs, HOSTS } from './aws/common.mjs';
try {
  if (process.argv.length !== 2) throw new Error('使い方: node scripts/aws-development-ingress.mjs');
  assertAccount();
  const foundation = stackOutputs('ses-platform-development-foundation');
  const workspace = stackOutputs('ses-platform-development-workspace');
  const instance = aws(['ec2', 'describe-instances', '--instance-ids', workspace.InstanceId]).Reservations[0].Instances[0];
  const certificateArn = aws(['ssm', 'get-parameter', '--name', '/ses-platform/development/certificate-arn']).Parameter.Value;
  const cert = aws(['acm', 'describe-certificate', '--certificate-arn', certificateArn]).Certificate;
  if (cert.Status !== 'ISSUED' || cert.DomainName !== HOSTS.development) throw new Error('開発URLの証明書が未認証です');
  deployStack('ses-platform-development-ingress', developmentIngressTemplate(), [`VpcId=${foundation.VpcId}`, `PublicSubnets=${foundation.PublicSubnetA},${foundation.PublicSubnetC}`, `CertificateArn=${certificateArn}`, `InstanceId=${workspace.InstanceId}`, `WorkspaceSecurityGroup=${instance.SecurityGroups[0].GroupId}`]);
  console.log(JSON.stringify({ url: `https://${HOSTS.development}`, cname: stackOutputs('ses-platform-development-ingress').Hostname }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
