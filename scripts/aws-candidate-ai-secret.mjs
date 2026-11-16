#!/usr/bin/env node
// 開発用候補検索専用のシークレットを用意する。既存の値は更新しない。
import { assertAccount, aws, readSecret, stackOutputs, withJsonFile } from './aws/common.mjs';
try {
  assertAccount();
  const external = readSecret('/ses-platform-development/external');
  const key = external.ANTHROPIC_API_KEY;
  if (typeof key !== 'string' || !key.startsWith('sk-ant-')) throw new Error('開発用 Claude キーがありません');
  const name = '/ses-platform-development/candidate-ai';
  const keyArn = stackOutputs('ses-platform-development-foundation').StorageKeyArn;
  let arn;
  try {
    const existing = aws(['secretsmanager', 'describe-secret', '--secret-id', name]);
    if (existing.KmsKeyId !== keyArn) throw new Error('既存の候補 AI シークレットの暗号鍵が一致しません');
    arn = existing.ARN;
  }
  catch (error) {
    if (error.code !== 'ResourceNotFoundException') throw error;
    arn = withJsonFile({ Name: name, KmsKeyId: keyArn, SecretString: JSON.stringify({ ANTHROPIC_API_KEY: key }),
      Tags: [{ Key: 'Project', Value: 'ses-platform' }, { Key: 'Environment', Value: 'development' }] },
    (file) => aws(['secretsmanager', 'create-secret', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`]).ARN);
  }
  const candidate = readSecret(arn);
  if (candidate.ANTHROPIC_API_KEY !== key) throw new Error('既存の候補 AI キーが異なるため自動更新しません');
  console.log('開発用候補検索の専用シークレットを確認しました');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
