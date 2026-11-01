#!/usr/bin/env node
// DNSはCloudflareで管理する。証明書用の公開CNAMEだけを出力し、メール検証は行わない。
import { assertAccount, aws, HOSTS, assertEnvironment } from './aws/common.mjs';

try {
  const [environment, ...rest] = process.argv.slice(2);
  assertEnvironment(environment);
  if (rest.length) throw new Error('使い方: node scripts/aws-certificates.mjs development|demo|production');
  assertAccount();
  const domain = HOSTS[environment];
  const certificates = aws(['acm', 'list-certificates']).CertificateSummaryList;
  let arn = certificates.find((certificate) => certificate.DomainName === domain)?.CertificateArn;
  if (!arn) {
    arn = aws(['acm', 'request-certificate', '--domain-name', domain, '--validation-method', 'DNS',
      '--idempotency-token', `ses${environment}`, '--tags', 'Key=Project,Value=ses-platform', `Key=Environment,Value=${environment}`]).CertificateArn;
  }
  const certificate = aws(['acm', 'describe-certificate', '--certificate-arn', arn]).Certificate;
  aws(['ssm', 'put-parameter', '--name', `/ses-platform/${environment}/certificate-arn`, '--type', 'String', '--value', arn, '--overwrite']);
  console.log(JSON.stringify({ environment, domain, certificateArn: arn, status: certificate.Status,
    cloudflareRecords: certificate.DomainValidationOptions.map((option) => ({ ...option.ResourceRecord, proxy: 'DNS only', ttl: 'Auto' })) }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
