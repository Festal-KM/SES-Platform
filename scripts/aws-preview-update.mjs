#!/usr/bin/env node
// AWS の独立した画面プレビューへ、指定した画面ファイルを 1 件だけ送る。
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertAccount, aws, stackOutputs, withJsonFile } from './aws/common.mjs';

try {
  const [name, ...extra] = process.argv.slice(2);
  if (!name || extra.length) throw new Error('使い方: node scripts/aws-preview-update.mjs <画面ファイル>');
  const root = resolve(import.meta.dirname, '..');
  const absolute = resolve(root, name);
  const file = relative(root, absolute).split(sep).join('/');
  if (!file.startsWith('apps/web/app/') || file.includes('/api/') || file.split('/').includes('..') || !/\.(tsx|css)$/.test(file)) {
    throw new Error('apps/web/app 配下の画面の tsx または css だけを送れます');
  }
  if (!lstatSync(absolute).isFile()) throw new Error('通常のファイルを指定してください');
  if (!realpathSync(absolute).startsWith(`${realpathSync(root)}${sep}`)) throw new Error('リポジトリ外のファイルは送れません');
  // 誤って大きなファイルやバイナリを送らない。
  const content = readFileSync(absolute);
  if (content.length > 1024 * 1024 || content.includes(0)) throw new Error('1 MiB 以下のテキストファイルを指定してください');
  assertAccount();
  const foundation = stackOutputs('ses-platform-development-foundation');
  const workspace = stackOutputs('ses-platform-development-workspace');
  const id = randomUUID();
  const uri = `s3://${foundation.FilesBucket}/bootstrap/preview/${id}`;
  aws(['s3', 'cp', absolute, uri, '--sse', 'aws:kms', '--sse-kms-key-id', foundation.StorageKeyArn, '--only-show-errors'], { json: false });
  const encoded = Buffer.from(file).toString('base64');
  const commands = [
    'set -euo pipefail',
    `aws s3 cp '${uri}' '/tmp/ses-preview-${id}' --region ap-northeast-1 --only-show-errors`,
    `PREVIEW_PATH_B64='${encoded}' PREVIEW_TMP='/tmp/ses-preview-${id}' python3 - <<'PY'\nimport base64, os, pathlib\nroot = pathlib.Path('/workspaces/ses-ui-preview').resolve()\nname = base64.b64decode(os.environ['PREVIEW_PATH_B64']).decode()\npath = root / name\nif not name.startswith('apps/web/app/') or '/api/' in name or not name.endswith(('.tsx', '.css')) or '..' in pathlib.PurePosixPath(name).parts:\n    raise ValueError('invalid path')\nif path.is_symlink() or not path.is_file() or root not in path.resolve().parents:\n    raise ValueError('invalid target')\ntmp = path.with_name(path.name + '.preview-tmp')\nif tmp.exists() or tmp.is_symlink():\n    raise ValueError('temporary file exists')\nwith open(os.environ['PREVIEW_TMP'], 'rb') as src, open(tmp, 'xb') as dst:\n    dst.write(src.read().replace(b'\\r\\n', b'\\n'))\nos.chown(tmp, 1000, 1000)\nos.replace(tmp, path)\nos.unlink(os.environ['PREVIEW_TMP'])\nPY`,
  ];
  const response = withJsonFile({ DocumentName: 'AWS-RunShellScript', InstanceIds: [workspace.InstanceId], Parameters: { commands, executionTimeout: ['120'] }, TimeoutSeconds: 120 },
    (input) => aws(['ssm', 'send-command', '--cli-input-json', `file://${input.replaceAll('\\', '/')}`]));
  console.log(`送信しました。完了確認: aws ssm get-command-invocation --region ap-northeast-1 --command-id ${response.Command.CommandId} --instance-id ${workspace.InstanceId} --query Status --output text`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
