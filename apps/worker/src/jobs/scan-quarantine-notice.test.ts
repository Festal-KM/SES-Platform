// apps/worker/src/jobs/scan-quarantine-notice.test.ts
// 🔴 T-05-08: 隔離の周知（`docs/02` `F-011` 処理④ / `A-22`）。
//
// ここで固定するのは 4 つである:
//   ① 隔離のときだけ積む（`CLEAN` / `SCANNING` では 1 通も積まない）
//   ② 🔴 **分類 1 / 2 のどちらでも同じ経路で積む**（周知が片側だけにならない）
//   ③ 🔴 **分類を自分で組み立てない**（`packages/db` が導いた値をそのまま運ぶ）
//   ④ 🔴 **同じ版・同じ状態への重複配信は 1 通に収束する**（`dedupeKey`）
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readScanQuarantineNotice = vi.fn();
const reserveEmailDispatch = vi.fn();

vi.mock('@ses/db', () => ({
  readScanQuarantineNotice,
  reserveEmailDispatch,
  emailDispatchDedupeKey: (input: {
    templateKey: string;
    targetId: string;
    recipientEmail: string;
  }) => `${input.templateKey}:${input.targetId}:${input.recipientEmail}`,
}));

const {
  notifyScanQuarantine,
  scanQuarantineTargetId,
  SKILL_SHEET_QUARANTINE_TEMPLATE_KEY,
} = await import('./scan-quarantine-notice.js');

const TENANT_ID = '01930000-0000-7000-8000-0000000000a1';
const PARTNER_ID = '01930000-0000-7000-8000-0000000000f1';
const SHEET_ID = '01930000-0000-7000-8000-0000000000d1';
const OBJECT_KEY = `t/${TENANT_ID}/skill-sheets/01930000-0000-7000-8000-0000000000b1/1/x.xlsx`;
const NOW = new Date('2026-09-06T02:00:00.000Z');

const ctx = {
  tenantId: TENANT_ID,
  partnerCompanyId: null,
  userId: '',
  role: 'ADMIN',
  lifecycleState: 'ACTIVE',
  job: { queue: 'scan.apply-result', jobId: 'job-1' },
} as never;

let enqueued: unknown[];
let dispatchSeq: number;

function deps() {
  return {
    enqueueEmailDispatch: async (job: unknown) => {
      enqueued.push(job);
    },
  };
}

function noticeOf(
  scanStatus: string,
  recipients: readonly { userId: string; email: string; recipientClass: string }[],
  ownerPartnerCompanyId: string | null = null,
) {
  return {
    target: { skillSheetId: SHEET_ID, ownerPartnerCompanyId, scanStatus },
    recipients,
  };
}

beforeEach(() => {
  enqueued = [];
  dispatchSeq = 0;
  readScanQuarantineNotice.mockReset();
  reserveEmailDispatch.mockReset();
  reserveEmailDispatch.mockImplementation(async (_ctx: unknown, input: Record<string, unknown>) => {
    dispatchSeq += 1;
    return {
      dispatchId: `01930000-0000-7000-8000-00000000e00${dispatchSeq}`,
      dedupeKey: input.dedupeKey,
      created: true,
      status: 'QUEUED',
      recipientClass: input.recipientClass,
      recipientEmail: input.recipientEmail,
      templateKey: input.templateKey,
    };
  });
});

describe('① 隔離のときだけ周知する', () => {
  it.each(['CLEAN', 'SCANNING'])('%s では 1 通も積まない', async (scanStatus) => {
    readScanQuarantineNotice.mockResolvedValue(
      noticeOf(scanStatus, [{ userId: 'u1', email: 'a@example.test', recipientClass: 'HOST_MEMBER' }]),
    );
    await expect(notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW })).resolves.toEqual(
      { kind: 'NOT_QUARANTINED' },
    );
    expect(reserveEmailDispatch).not.toHaveBeenCalled();
    expect(enqueued).toEqual([]);
  });

  it.each(['INFECTED', 'UNSCANNABLE', 'FAILED'])('%s では積む', async (scanStatus) => {
    readScanQuarantineNotice.mockResolvedValue(
      noticeOf(scanStatus, [{ userId: 'u1', email: 'a@example.test', recipientClass: 'HOST_MEMBER' }]),
    );
    const outcome = await notifyScanQuarantine(deps(), ctx, {
      objectKey: OBJECT_KEY,
      observedAt: NOW,
    });
    expect(outcome).toEqual({ kind: 'NOTIFIED', recipients: 1, queued: 1 });
  });

  it('対象が無ければ TARGET_NOT_FOUND（0 件を成功に畳まない）', async () => {
    readScanQuarantineNotice.mockResolvedValue(null);
    await expect(
      notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW }),
    ).resolves.toEqual({ kind: 'TARGET_NOT_FOUND' });
  });
});

describe('🔴 ② 分類 1 / 2 のどちらでも成立する（F-011 処理④ の 🔴）', () => {
  it('ホスト所有 → 分類 1 で積む', async () => {
    readScanQuarantineNotice.mockResolvedValue(
      noticeOf('INFECTED', [
        { userId: 'u1', email: 'owner@host.test', recipientClass: 'HOST_MEMBER' },
      ]),
    );
    await notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW });
    expect(enqueued).toEqual([
      {
        dispatchId: '01930000-0000-7000-8000-00000000e001',
        tenantId: TENANT_ID,
        recipientClass: 'HOST_MEMBER',
      },
    ]);
  });

  it('🔴 パートナー所有 → 分類 2 で積む（sandbox ではこの 1 通がモックになる）', async () => {
    readScanQuarantineNotice.mockResolvedValue(
      noticeOf(
        'INFECTED',
        [{ userId: 'u2', email: 'admin@partner.test', recipientClass: 'PARTNER_MEMBER' }],
        PARTNER_ID,
      ),
    );
    await notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW });
    expect(enqueued).toEqual([
      {
        dispatchId: '01930000-0000-7000-8000-00000000e001',
        tenantId: TENANT_ID,
        recipientClass: 'PARTNER_MEMBER',
      },
    ]);
  });

  it('🔴 ③ 分類は所有側から組み立て直さず、DB が導いた値をそのまま運ぶ', async () => {
    // ありえない組み合わせ（パートナー所有だが分類 1）を渡しても、こちらで「直さない」。
    // 判定の出所を 1 つに保つことが目的であり、ここで補正すると 2 実装になる。
    readScanQuarantineNotice.mockResolvedValue(
      noticeOf(
        'FAILED',
        [{ userId: 'u3', email: 'x@example.test', recipientClass: 'HOST_MEMBER' }],
        PARTNER_ID,
      ),
    );
    await notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW });
    expect((enqueued[0] as { recipientClass: string }).recipientClass).toBe('HOST_MEMBER');
    expect(reserveEmailDispatch.mock.calls[0]?.[1].recipientClass).toBe('HOST_MEMBER');
  });

  it('宛先が 0 人でもエラーにしない（アプリ内表示は別経路で必ず出る）', async () => {
    readScanQuarantineNotice.mockResolvedValue(noticeOf('INFECTED', [], PARTNER_ID));
    await expect(
      notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW }),
    ).resolves.toEqual({ kind: 'NOTIFIED', recipients: 0, queued: 0 });
  });
});

describe('🔴 ④ 冪等性（dedupeKey）', () => {
  it('同じ版・同じ状態・同じ宛先なら鍵が一致する（UNIQUE で 1 通に収束）', async () => {
    readScanQuarantineNotice.mockResolvedValue(
      noticeOf('INFECTED', [{ userId: 'u1', email: 'a@example.test', recipientClass: 'HOST_MEMBER' }]),
    );
    await notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW });
    await notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW });
    const [first, second] = reserveEmailDispatch.mock.calls.map((call) => call[1].dedupeKey);
    expect(first).toBe(second);
    expect(first).toBe(
      `${SKILL_SHEET_QUARANTINE_TEMPLATE_KEY}:${SHEET_ID}#INFECTED:a@example.test`,
    );
  });

  it('🔴 状態が悪化したら別の鍵になる（検査不能の通知は感染の周知になっていない）', async () => {
    expect(scanQuarantineTargetId({ skillSheetId: SHEET_ID, scanStatus: 'UNSCANNABLE' })).not.toBe(
      scanQuarantineTargetId({ skillSheetId: SHEET_ID, scanStatus: 'INFECTED' }),
    );
  });

  it('🔴 `dedupeKey` の形（{templateKey}:{targetId}:{recipientHash}）を壊さない', async () => {
    // targetId に `:` を使うと 3 分割の前提（docs/05 §3.9）が崩れる。
    expect(scanQuarantineTargetId({ skillSheetId: SHEET_ID, scanStatus: 'INFECTED' })).not.toContain(':');
  });

  it('🔴 既に確定済み（SENT 等）の行は積み直さない（空撃ちしない）', async () => {
    readScanQuarantineNotice.mockResolvedValue(
      noticeOf('INFECTED', [{ userId: 'u1', email: 'a@example.test', recipientClass: 'HOST_MEMBER' }]),
    );
    reserveEmailDispatch.mockResolvedValue({
      dispatchId: '01930000-0000-7000-8000-00000000e009',
      dedupeKey: 'k',
      created: false,
      status: 'SENT',
      recipientClass: 'HOST_MEMBER',
      recipientEmail: 'a@example.test',
      templateKey: SKILL_SHEET_QUARANTINE_TEMPLATE_KEY,
    });
    await expect(
      notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW }),
    ).resolves.toEqual({ kind: 'NOTIFIED', recipients: 1, queued: 0 });
    expect(enqueued).toEqual([]);
  });

  it('🔴 QUEUED のまま残っている行は積み直す（予約の後に落ちた実行の回収）', async () => {
    readScanQuarantineNotice.mockResolvedValue(
      noticeOf('INFECTED', [{ userId: 'u1', email: 'a@example.test', recipientClass: 'HOST_MEMBER' }]),
    );
    reserveEmailDispatch.mockResolvedValue({
      dispatchId: '01930000-0000-7000-8000-00000000e00a',
      dedupeKey: 'k',
      created: false,
      status: 'QUEUED',
      recipientClass: 'HOST_MEMBER',
      recipientEmail: 'a@example.test',
      templateKey: SKILL_SHEET_QUARANTINE_TEMPLATE_KEY,
    });
    await notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW });
    expect(enqueued).toHaveLength(1);
  });
});

describe('🔴 メールに業務の内容を載せない（CLAUDE.md §3.5 / docs/05 §16.2）', () => {
  it('予約に渡すのは分類・宛先・テンプレート・鍵だけである（本文も氏名も無い）', async () => {
    readScanQuarantineNotice.mockResolvedValue(
      noticeOf('INFECTED', [{ userId: 'u1', email: 'a@example.test', recipientClass: 'HOST_MEMBER' }]),
    );
    await notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW });
    expect(Object.keys(reserveEmailDispatch.mock.calls[0]?.[1] ?? {}).sort()).toEqual([
      'dedupeKey',
      'observedAt',
      'recipientClass',
      'recipientEmail',
      'templateKey',
    ]);
  });

  it('🔴 積む payload にオブジェクトキー（PII を含みうる場所）を載せない', async () => {
    readScanQuarantineNotice.mockResolvedValue(
      noticeOf('INFECTED', [{ userId: 'u1', email: 'a@example.test', recipientClass: 'HOST_MEMBER' }]),
    );
    await notifyScanQuarantine(deps(), ctx, { objectKey: OBJECT_KEY, observedAt: NOW });
    expect(JSON.stringify(enqueued)).not.toContain('skill-sheets');
    expect(JSON.stringify(enqueued)).not.toContain('a@example.test');
  });
});
