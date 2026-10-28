#!/usr/bin/env node
// デモで正常配備したdigestをコピーする。本番向けの再ビルドは行わない。
import { spawnSync } from 'node:child_process';
import { releaseRecord } from './aws/release.mjs';
import { assertAccount, aws, withJsonFile, ACCOUNT_ID, REGION } from './aws/common.mjs';
try {
  const [commit, ...rest] = process.argv.slice(2);
  if (rest.length || !/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('デモで確認した完全なコミットSHAを指定してください');
  assertAccount();
  const value = aws(['s3', 'cp', `s3://ses-platform-demo-files-${ACCOUNT_ID}-${REGION}/releases/${commit}.json`, '-', '--only-show-errors'], { json: false });
  const record = releaseRecord(JSON.parse(value));
  if (record.commit !== commit || !record.verifiedAt || Number.isNaN(Date.parse(record.verifiedAt))) throw new Error('デモで確認済みの成果物ではありません');
  const registry = `${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com`;
  let exists = false;
  try {
    const existing = aws(['ecr', 'describe-images', '--repository-name', 'ses-platform-production', '--image-ids', `imageTag=${commit}`]).imageDetails[0];
    if (existing.imageDigest !== record.digest) throw new Error('本番の同名タグが別の成果物を指しています');
    exists = true;
  } catch (error) { if (error.code !== 'ImageNotFoundException') throw error; }
  if (!exists) {
    const token = aws(['ecr', 'get-authorization-token']).authorizationData[0].authorizationToken;
    withJsonFile({ auths: { [registry]: { auth: token } } }, (file) => {
      const result = spawnSync('skopeo', ['copy', '--all', '--preserve-digests', '--authfile', file,
        `docker://${registry}/ses-platform-demo@${record.digest}`, `docker://${registry}/ses-platform-production:${commit}`], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) throw new Error('固定イメージのコピーに失敗しました');
    });
  }
  const actual = aws(['ecr', 'describe-images', '--repository-name', 'ses-platform-production', '--image-ids', `imageTag=${commit}`]).imageDetails[0].imageDigest;
  if (actual !== record.digest) throw new Error('本番とデモのdigestが一致しません');
  const { appendFileSync } = await import('node:fs');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `digest=${record.digest}\nbuild_id=${record.buildId}\n`);
  console.log(`デモと同一の成果物を確認しました: ${commit} / ${record.digest}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
