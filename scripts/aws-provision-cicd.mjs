#!/usr/bin/env node
import { cicdTemplate } from '../infra/aws/cicd.mjs';
import { assertAccount, stackOutputs, deployStack } from './aws/common.mjs';
try {
  if (process.argv.length !== 2) throw new Error('使い方: node scripts/aws-provision-cicd.mjs');
  assertAccount();
  const foundation = stackOutputs('ses-platform-development-foundation');
  deployStack('ses-platform-cicd', cicdTemplate(), [`StorageKeyArn=${foundation.StorageKeyArn}`]);
} catch (error) { console.error(error.message); process.exitCode = 1; }
