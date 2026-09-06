// packages/connectors/src/scan/guardduty-scanner.test.ts
// 🔴 保険のポーリング（docs/05 §8.5「Webhook が届かない場合の保険」）。実 AWS を叩かない。
import { describe, expect, it, vi } from 'vitest';

import { GUARDDUTY_SCAN_STATUS_TAG } from './guardduty.js';
import { GuardDutyMalwareScanner } from './guardduty-scanner.js';
import type { ObjectTagApi, ObjectTagResponse } from './api.js';

const BUCKET = 'ses-platform-test';
const KEY = 't/01930000-0000-7000-8000-0000000000a1/skill-sheets/01930000-0000-7000-8000-0000000000b1/1/01930000-0000-7000-8000-0000000000c1.xlsx';
const VERSION = 'OZ9Zx0000000000000000000000000a1';

function scannerWith(response: ObjectTagResponse | null): {
  readonly scanner: GuardDutyMalwareScanner;
  readonly getObjectTagging: ReturnType<typeof vi.fn>;
} {
  const getObjectTagging = vi.fn(async () => response);
  const api: ObjectTagApi = { getObjectTagging };
  return { scanner: new GuardDutyMalwareScanner({ api, bucket: BUCKET }), getObjectTagging };
}

describe('🔴 enqueue は no-op（GuardDuty は S3 の Put が契機。docs/03 §3.4.1）', () => {
  it('外部を 1 回も呼ばず、例外も投げない', async () => {
    const { scanner, getObjectTagging } = scannerWith(null);
    await expect(scanner.enqueue(KEY)).resolves.toBeUndefined();
    expect(getObjectTagging).not.toHaveBeenCalled();
    expect(scanner.callCount()).toBe(1);
  });
});

describe('getResult（S3 のオブジェクトタグを読む）', () => {
  it.each([
    ['NO_THREATS_FOUND', 'CLEAN'],
    ['THREATS_FOUND', 'INFECTED'],
    ['UNSUPPORTED', 'UNSCANNABLE'],
    ['ACCESS_DENIED', 'FAILED'],
  ] as const)('タグ %s → %s（版も返す）', async (raw, expected) => {
    const { scanner } = scannerWith({
      Tags: { [GUARDDUTY_SCAN_STATUS_TAG]: raw },
      VersionId: VERSION,
    });
    await expect(scanner.getResult(KEY, null)).resolves.toEqual({
      status: expected,
      rawStatus: raw,
      objectVersionId: VERSION,
    });
  });

  it('🔴 タグが無ければ null（「まだ判定が付いていない」。CLEAN に寄せない）', async () => {
    const { scanner } = scannerWith({ Tags: {}, VersionId: VERSION });
    await expect(scanner.getResult(KEY, null)).resolves.toBeNull();
  });

  it('🔴 未知のタグ値も null（判定不能。CLEAN にも FAILED にも寄せない）', async () => {
    const { scanner } = scannerWith({
      Tags: { [GUARDDUTY_SCAN_STATUS_TAG]: 'SOMETHING_NEW' },
      VersionId: VERSION,
    });
    await expect(scanner.getResult(KEY, null)).resolves.toBeNull();
  });

  it('オブジェクトが無ければ null', async () => {
    const { scanner } = scannerWith(null);
    await expect(scanner.getResult(KEY, null)).resolves.toBeNull();
  });

  it('versionId を渡すとその版を照会する / null なら最新版（VersionId を送らない）', async () => {
    const { scanner, getObjectTagging } = scannerWith({
      Tags: { [GUARDDUTY_SCAN_STATUS_TAG]: 'NO_THREATS_FOUND' },
      VersionId: VERSION,
    });
    await scanner.getResult(KEY, VERSION);
    expect(getObjectTagging).toHaveBeenLastCalledWith({ Bucket: BUCKET, Key: KEY, VersionId: VERSION });
    await scanner.getResult(KEY, null);
    expect(getObjectTagging).toHaveBeenLastCalledWith({ Bucket: BUCKET, Key: KEY });
  });

  it('🔴 バケットは起動時設定の 1 つだけ（呼び出し側が指定できない。docs/05 §14.1）', async () => {
    const { scanner, getObjectTagging } = scannerWith({ Tags: {}, VersionId: VERSION });
    await scanner.getResult(KEY, null);
    expect(getObjectTagging).toHaveBeenCalledWith(expect.objectContaining({ Bucket: BUCKET }));
  });
});
