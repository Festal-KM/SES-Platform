#!/usr/bin/env node
// 開発 VM の候補 AI 専用シークレット権限だけを更新する。
import { randomUUID } from 'node:crypto';
import { assertAccount, aws, withJsonFile } from './aws/common.mjs';
import { developmentTemplate } from '../infra/aws/development.mjs';
const stackName = 'ses-platform-development-workspace';
const changeName = `candidate-ai-${randomUUID()}`;
let created = false;
let executed = false;
try {
  const [mode, ...rest] = process.argv.slice(2);
  if (!['plan', 'apply'].includes(mode) || rest.length) throw new Error('使い方: node scripts/aws-candidate-ai-policy.mjs plan|apply');
  assertAccount();
  const stack = aws(['cloudformation', 'describe-stacks', '--stack-name', stackName]).Stacks[0];
  if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)) throw new Error('開発スタックの状態を確認してください');
  const input = {
    StackName: stackName, ChangeSetName: changeName, ChangeSetType: 'UPDATE',
    TemplateBody: JSON.stringify(developmentTemplate()), Capabilities: ['CAPABILITY_NAMED_IAM'],
    Parameters: stack.Parameters.map((item) => ({ ParameterKey: item.ParameterKey, UsePreviousValue: true })),
  };
  withJsonFile(input, (file) => aws(['cloudformation', 'create-change-set', '--cli-input-json', `file://${file.replaceAll('\\', '/')}`]));
  created = true;
  try { aws(['cloudformation', 'wait', 'change-set-create-complete', '--stack-name', stackName, '--change-set-name', changeName], { json: false }); }
  catch { /* 変更なしも describe で判別する */ }
  const change = aws(['cloudformation', 'describe-change-set', '--stack-name', stackName, '--change-set-name', changeName]);
  if (change.Status === 'FAILED' && /didn.t contain changes|No updates are to be performed/i.test(change.StatusReason ?? '')) {
    console.log('候補 AI の権限は既に反映されています');
  } else {
    if (change.Status !== 'CREATE_COMPLETE') throw new Error('開発スタックの変更案を作成できません');
    const resources = (change.Changes ?? []).map((item) => item.ResourceChange);
    if (resources.length !== 1 || resources[0].LogicalResourceId !== 'WorkspaceRole' || resources[0].Action !== 'Modify' || resources[0].Replacement !== 'False') {
      throw new Error('候補 AI 専用ロール以外の変更があるため適用しません');
    }
    if (mode === 'plan') console.log('候補 AI 専用の WorkspaceRole のみ更新対象です');
    else {
      aws(['cloudformation', 'execute-change-set', '--stack-name', stackName, '--change-set-name', changeName]);
      executed = true;
      console.log('開発 VM の候補 AI 専用権限を更新しています');
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created && !executed) {
    try { aws(['cloudformation', 'delete-change-set', '--stack-name', stackName, '--change-set-name', changeName]); }
    catch { console.error('作成した変更案を削除できませんでした'); process.exitCode = 1; }
  }
}
