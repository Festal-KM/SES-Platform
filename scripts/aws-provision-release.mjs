#!/usr/bin/env node
import { releaseDeliveryTemplate } from '../infra/aws/release-delivery.mjs';
import { assertAccount, stackOutputs, deployStack } from './aws/common.mjs';
try {
  assertAccount();
  deployStack('ses-platform-release-delivery', releaseDeliveryTemplate(), [
    `DemoKeyArn=${stackOutputs('ses-platform-demo-foundation').StorageKeyArn}`,
    `ProductionKeyArn=${stackOutputs('ses-platform-production-foundation').StorageKeyArn}`,
  ]);
} catch (error) { console.error(error.message); process.exitCode = 1; }
