// apps/worker/src/jobs/operational-mail-params.test.ts
// 🔴 T-05-08: `email.dispatch` の差し込み値（docs/05 §9.4 の `resolveTemplateParams`）。
//
// 固定するのは 2 つ:
//   ① 🔴 **未登録のテンプレートは例外**（空欄のメールが黙って届く経路を作らない）
//   ② 🔴 **本文に業務の内容を載せない**（差し込みはアプリへのリンク 1 つだけ）
// ✅ T-10-12 で 1 つ足した:
//   ③ 🔴 削除予告（`TENANT_CLOSING_NOTICE`）は**テナント名・削除予定日・返却画面の URL**だけを載せ、段は `dedupeKey` から復元する。
//      削除予定日は `closing_entered_at`（JST 暦日）+ `purgeGraceDays`。復元できない行・材料の無いテナントは例外（黙って送らない）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemTenantCtx } from '@ses/db';

const readTenantClosingSchedule = vi.fn();

vi.mock('@ses/db', () => ({
  readTenantClosingSchedule: (...args: unknown[]) => readTenantClosingSchedule(...args),
}));

const {
  ClosingNoticeScheduleUnavailableError,
  createOperationalMailParamsResolver,
  InvalidClosingNoticeDispatchError,
  UnknownOperationalMailTemplateError,
} = await import('./operational-mail-params.js');
const { SKILL_SHEET_QUARANTINE_TEMPLATE_KEY } = await import('./scan-quarantine-notice.js');
const { TENANT_CLOSING_NOTICE_TEMPLATE_KEY, closingNoticeTargetId } = await import('@ses/domain');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const OTHER_TENANT_ID = '01930000-0000-7000-8000-0000000000b1';
const ctx = { tenantId: TENANT_ID, partnerCompanyId: null, userId: '00000000-0000-0000-0000-000000000000' } as unknown as SystemTenantCtx;

const resolve = createOperationalMailParamsResolver({ appUrl: 'https://app.example.test', purgeGraceDays: 30 });

function closingDedupeKey(phase: 'ENTERED' | 'D7', dayKey: string, tenantId: string = TENANT_ID): string {
  return `${TENANT_CLOSING_NOTICE_TEMPLATE_KEY}:${closingNoticeTargetId({ tenantId, phase, dayKey })}:0123456789abcdef`;
}

beforeEach(() => {
  readTenantClosingSchedule.mockReset();
});

describe('🔴 ① 未登録のテンプレートは例外にする', () => {
  it('定義の無い templateKey で throw する（`{}` を既定にしない）', async () => {
    await expect(resolve({ templateKey: 'NOT_REGISTERED', dispatchId: 'd1', dedupeKey: 'NOT_REGISTERED:x:y' }, ctx)).rejects.toThrow(
      UnknownOperationalMailTemplateError,
    );
  });

  it('例外メッセージに追記先のファイルを書く（実装漏れを直せる形で落とす）', async () => {
    await expect(resolve({ templateKey: 'NOT_REGISTERED', dispatchId: 'd1', dedupeKey: 'NOT_REGISTERED:x:y' }, ctx)).rejects.toThrow(
      /operational-mail-params/,
    );
  });
});

describe('🔴 ② 隔離の周知はリンク 1 つだけを差し込む', () => {
  const quarantine = { templateKey: SKILL_SHEET_QUARANTINE_TEMPLATE_KEY, dispatchId: 'd1', dedupeKey: 'SKILL_SHEET_QUARANTINE:s#INFECTED:h' };

  it('`link` のみを返す（氏名・版・ファイル名を持たない）', async () => {
    const params = await resolve(quarantine, ctx);
    expect(params).toEqual({ link: 'https://app.example.test/' });
    expect(Object.keys(params)).toEqual(['link']);
  });

  it('🔴 `APP_URL` を組み立てで受け取る（ハンドラでハードコードしない）', async () => {
    const other = createOperationalMailParamsResolver({ appUrl: 'https://sandbox.example.test', purgeGraceDays: 30 });
    await expect(other(quarantine, ctx)).resolves.toEqual({ link: 'https://sandbox.example.test/' });
  });

  it('🔴 `dispatchId` を差し込み値に混ぜない（メールから DB の行を辿らせない）', async () => {
    const params = await resolve({ ...quarantine, dispatchId: '01930000-0000-7000-8000-0000000000e1' }, ctx);
    expect(JSON.stringify(params)).not.toContain('01930000');
  });

  it('既存のテンプレートはテナント文脈を読まない（`tenants` に触れない）', async () => {
    await resolve(quarantine, ctx);
    expect(readTenantClosingSchedule).not.toHaveBeenCalled();
  });
});

describe('🔴 ③ T-10-12: 削除予告はテナント名・削除予定日・返却画面の URL だけを載せる', () => {
  beforeEach(() => {
    readTenantClosingSchedule.mockResolvedValue({
      name: '架空商事',
      lifecycleState: 'CLOSING',
      // JST 2026-09-01 09:00（UTC 00:00）→ 暦日 2026-09-01。+30 日 = 2026-10-01。
      closingEnteredAt: new Date('2026-09-01T00:00:00.000Z'),
    });
  });

  it('ENTERED: 本文に削除予定日（closing_entered_at + 30 日）とテナント名と S-042 の URL が載る', async () => {
    const params = await resolve(
      { templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY, dispatchId: 'd1', dedupeKey: closingDedupeKey('ENTERED', '2026-09-01') },
      ctx,
    );
    expect(readTenantClosingSchedule).toHaveBeenCalledWith(ctx);
    expect(params.purgeScheduledOn).toBe('2026-10-01');
    expect(params.phase).toBe('ENTERED');
    expect(params.tenantName).toBe('架空商事');
    expect(params.link).toBe('https://app.example.test/settings/retention');
    expect(typeof params.subject).toBe('string');
    const body = String(params.body);
    expect(body).toContain('2026-10-01');
    expect(body).toContain('架空商事');
    expect(body).toContain('https://app.example.test/settings/retention');
    expect(body).toContain('解約手続きに入ったため');
    expect(body).not.toContain('7 日');
  });

  it('D7: 段は dedupeKey から復元され、本文の書き出しが「7 日を切りました」になる（削除予定日は同じ）', async () => {
    const params = await resolve(
      { templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY, dispatchId: 'd2', dedupeKey: closingDedupeKey('D7', '2026-09-24') },
      ctx,
    );
    expect(params.phase).toBe('D7');
    expect(params.purgeScheduledOn).toBe('2026-10-01');
    expect(String(params.body)).toContain('7 日を切りました');
    expect(String(params.body)).toContain('2026-10-01');
  });

  it('🔴 JST の日境界: closing_entered_at が UTC 16:00 なら翌日の暦日から数える', async () => {
    readTenantClosingSchedule.mockResolvedValue({
      name: '架空商事',
      lifecycleState: 'CLOSING',
      closingEnteredAt: new Date('2026-09-01T16:00:00.000Z'), // JST 2026-09-02 01:00
    });
    const params = await resolve(
      { templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY, dispatchId: 'd3', dedupeKey: closingDedupeKey('ENTERED', '2026-09-02') },
      ctx,
    );
    expect(params.purgeScheduledOn).toBe('2026-10-02');
  });

  it('🔴 猶予日数は設定から来る（ハードコードしない）', async () => {
    const other = createOperationalMailParamsResolver({ appUrl: 'https://app.example.test', purgeGraceDays: 45 });
    const params = await other(
      { templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY, dispatchId: 'd4', dedupeKey: closingDedupeKey('ENTERED', '2026-09-01') },
      ctx,
    );
    expect(params.purgeScheduledOn).toBe('2026-10-16');
  });

  it('🔴 件数・個人情報・dispatchId を載せない（キー集合を固定する）', async () => {
    const params = await resolve(
      { templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY, dispatchId: '01930000-0000-7000-8000-0000000000e1', dedupeKey: closingDedupeKey('ENTERED', '2026-09-01') },
      ctx,
    );
    expect(Object.keys(params).sort()).toEqual(['body', 'link', 'phase', 'purgeScheduledOn', 'subject', 'tenantName']);
    expect(JSON.stringify(params)).not.toContain('01930000');
  });

  it('🔴 dedupeKey から段を復元できなければ例外（黙って ENTERED の文面で送らない）', async () => {
    await expect(
      resolve({ templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY, dispatchId: 'd5', dedupeKey: 'TENANT_CLOSING_NOTICE:broken:h' }, ctx),
    ).rejects.toThrow(InvalidClosingNoticeDispatchError);
    expect(readTenantClosingSchedule).not.toHaveBeenCalled();
  });

  it('🔴 dedupeKey のテナントが文脈と食い違えば例外（他テナントの行を自テナントの材料で組み立てない）', async () => {
    await expect(
      resolve(
        { templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY, dispatchId: 'd6', dedupeKey: closingDedupeKey('ENTERED', '2026-09-01', OTHER_TENANT_ID) },
        ctx,
      ),
    ).rejects.toThrow(InvalidClosingNoticeDispatchError);
  });

  it('🔴 closing_entered_at が無ければ例外（null の日付を本文に載せない）', async () => {
    readTenantClosingSchedule.mockResolvedValue({ name: '架空商事', lifecycleState: 'ACTIVE', closingEnteredAt: null });
    await expect(
      resolve({ templateKey: TENANT_CLOSING_NOTICE_TEMPLATE_KEY, dispatchId: 'd7', dedupeKey: closingDedupeKey('ENTERED', '2026-09-01') }, ctx),
    ).rejects.toThrow(ClosingNoticeScheduleUnavailableError);
  });
});
