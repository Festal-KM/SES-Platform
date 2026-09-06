// apps/worker/src/jobs/operational-mail-params.test.ts
// 🔴 T-05-08: `email.dispatch` の差し込み値（docs/05 §9.4 の `resolveTemplateParams`）。
//
// 固定するのは 2 つ:
//   ① 🔴 **未登録のテンプレートは例外**（空欄のメールが黙って届く経路を作らない）
//   ② 🔴 **本文に業務の内容を載せない**（差し込みはアプリへのリンク 1 つだけ）
import { describe, expect, it } from 'vitest';
import {
  createOperationalMailParamsResolver,
  UnknownOperationalMailTemplateError,
} from './operational-mail-params.js';
import { SKILL_SHEET_QUARANTINE_TEMPLATE_KEY } from './scan-quarantine-notice.js';

const resolve = createOperationalMailParamsResolver({ appUrl: 'https://app.example.test' });

describe('🔴 ① 未登録のテンプレートは例外にする', () => {
  it('定義の無い templateKey で throw する（`{}` を既定にしない）', async () => {
    await expect(
      resolve({ templateKey: 'NOT_REGISTERED', dispatchId: 'd1' }),
    ).rejects.toThrow(UnknownOperationalMailTemplateError);
  });

  it('例外メッセージに追記先のファイルを書く（実装漏れを直せる形で落とす）', async () => {
    await expect(resolve({ templateKey: 'NOT_REGISTERED', dispatchId: 'd1' })).rejects.toThrow(
      /operational-mail-params/,
    );
  });
});

describe('🔴 ② 隔離の周知はリンク 1 つだけを差し込む', () => {
  it('`link` のみを返す（氏名・版・ファイル名を持たない）', async () => {
    const params = await resolve({
      templateKey: SKILL_SHEET_QUARANTINE_TEMPLATE_KEY,
      dispatchId: 'd1',
    });
    expect(params).toEqual({ link: 'https://app.example.test/' });
    expect(Object.keys(params)).toEqual(['link']);
  });

  it('🔴 `APP_URL` を組み立てで受け取る（ハンドラでハードコードしない）', async () => {
    const other = createOperationalMailParamsResolver({ appUrl: 'https://sandbox.example.test' });
    await expect(
      other({ templateKey: SKILL_SHEET_QUARANTINE_TEMPLATE_KEY, dispatchId: 'd1' }),
    ).resolves.toEqual({ link: 'https://sandbox.example.test/' });
  });

  it('🔴 `dispatchId` を差し込み値に混ぜない（メールから DB の行を辿らせない）', async () => {
    const params = await resolve({
      templateKey: SKILL_SHEET_QUARANTINE_TEMPLATE_KEY,
      dispatchId: '01930000-0000-7000-8000-0000000000e1',
    });
    expect(JSON.stringify(params)).not.toContain('01930000');
  });
});
