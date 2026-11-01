#!/usr/bin/env node
import { emailTemplate } from '../infra/aws/email.mjs';
import { assertAccount, deployStack, stackOutputs, ROOT_DOMAIN, REGION, aws } from './aws/common.mjs';
try {
  if (process.argv.length !== 2) throw new Error('引数は不要です');
  assertAccount();
  deployStack('ses-platform-production-email', emailTemplate(ROOT_DOMAIN));
  const outputs = stackOutputs('ses-platform-production-email');
  const records = [1, 2, 3].map((index) => ({ type: 'CNAME', name: outputs[`DkimName${index}`].replace(`.${ROOT_DOMAIN}`, ''), target: outputs[`DkimValue${index}`], proxy: 'DNS only', ttl: 'Auto' }));
  records.push({ type: 'MX', name: 'mail', target: `feedback-smtp.${REGION}.amazonses.com`, priority: 10, ttl: 'Auto' });
  records.push({ type: 'TXT', name: 'mail', content: 'v=spf1 include:amazonses.com ~all', ttl: 'Auto' });
  console.log(JSON.stringify({ cloudflareRecords: records, sendingAccount: aws(['sesv2', 'get-account']).ProductionAccessEnabled ? 'production enabled' : 'sandbox (本番アクセス申請が必要)' }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
