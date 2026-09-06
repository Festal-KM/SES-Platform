// packages/connectors/src/scan/guardduty.test.ts
// 🔴 T-05-05 の完了判定「重複配信・順序逆転・4 種のステータスのフィクスチャテストが green」の
//    正規化側。フィクスチャは `tests/fixtures/guardduty/*.json`（実データ由来のものは置かない）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { decideScanStatusTransition, type ScanStatus } from '../types.js';
import {
  buildGuardDutySignatureHeader,
  GUARDDUTY_SIGNATURE_TOLERANCE_SECONDS,
  GuardDutyEventParseError,
  guardDutyWebhookDedupeKey,
  normalizeScanStatus,
  parseGuardDutyScanEvent,
  parseSerializedScanResult,
  serializeScanResult,
  verifyGuardDutySignature,
} from './guardduty.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', '..', '..', '..', 'tests', 'fixtures', 'guardduty');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8')) as unknown;
}

const SECRET = 'aFEbwtLtjA7iVuwT7yE4ZbEqmuUYJDRPXFwbSCzsO2A=';
const SECRET_ROTATED = 'Wnzk9uY9j0FhVj6Xh2Q0V8/9OZ5mHYyPPtVUD5+PtVc=';
const NOW = new Date('2026-09-06T01:05:00.000Z');

describe('🔴 生ステータスの正規化（docs/03 §3.4.3-3。判定不能を CLEAN に寄せない）', () => {
  it.each([
    ['NO_THREATS_FOUND', 'CLEAN'],
    ['THREATS_FOUND', 'INFECTED'],
    ['UNSUPPORTED', 'UNSCANNABLE'],
    ['ACCESS_DENIED', 'FAILED'],
    ['FAILED', 'FAILED'],
    ['SKIPPED', 'UNSCANNABLE'],
  ] as const)('%s → %s', (raw, expected) => {
    expect(normalizeScanStatus(raw)).toBe(expected);
  });

  it('🔴 CLEAN になる生ステータスは NO_THREATS_FOUND だけである', () => {
    const rawStatuses = [
      'NO_THREATS_FOUND',
      'THREATS_FOUND',
      'UNSUPPORTED',
      'ACCESS_DENIED',
      'FAILED',
      'SKIPPED',
      'COMPLETED',
      'SOMETHING_NEW',
      '',
    ];
    const clean = rawStatuses.filter((raw) => normalizeScanStatus(raw) === 'CLEAN');
    expect(clean).toEqual(['NO_THREATS_FOUND']);
  });

  it('🔴 未知の生ステータスは null（CLEAN にも FAILED にも推測で寄せない）', () => {
    expect(normalizeScanStatus('SOMETHING_NEW')).toBeNull();
    // `COMPLETED` は「scanResultDetails を見よ」の意味であり、それ自体は判定ではない。
    expect(normalizeScanStatus('COMPLETED')).toBeNull();
  });
});

describe('🔴 4 種のステータスのフィクスチャ（SP-05 §T-05-05 完了判定）', () => {
  it.each([
    ['no-threats-found.json', 'CLEAN', 'NO_THREATS_FOUND'],
    ['threats-found.json', 'INFECTED', 'THREATS_FOUND'],
    ['unsupported.json', 'UNSCANNABLE', 'UNSUPPORTED'],
    ['access-denied.json', 'FAILED', 'ACCESS_DENIED'],
    ['scan-failed.json', 'FAILED', 'FAILED'],
  ] as const)('%s → %s（生値 %s を保持する）', (name, status, rawStatus) => {
    const result = parseGuardDutyScanEvent(fixture(name));
    expect(result.status).toBe(status);
    expect(result.rawStatus).toBe(rawStatus);
    expect(result.bucketName).toBe('ses-platform-test');
    expect(result.objectKey).toMatch(/^t\/[0-9a-f-]{36}\/skill-sheets\//);
    expect(result.objectVersionId).not.toBe('');
  });

  it('🔴 未知のステータスは例外（200 + 未処理として記録され、A-005 が拾う）', () => {
    expect(() => parseGuardDutyScanEvent(fixture('unknown-status.json'))).toThrow(
      GuardDutyEventParseError,
    );
  });
});

describe('🔴 重複配信と順序逆転（docs/03 §3.4.3-2 / docs/05 §8.5）', () => {
  const clean = parseGuardDutyScanEvent(fixture('no-threats-found.json'));
  const infected = parseGuardDutyScanEvent(fixture('threats-found.json'));

  it('同じオブジェクト版の結果は同じ dedupeKey になる（gd:{objectKey}:{versionId}）', () => {
    expect(guardDutyWebhookDedupeKey(clean)).toBe(guardDutyWebhookDedupeKey(infected));
    expect(guardDutyWebhookDedupeKey(clean)).toBe(`gd:${clean.objectKey}:${clean.objectVersionId}`);
  });

  it('🔴 dedupeKey にステータスを含めない（含めると同じ版の再送が 2 回処理される）', () => {
    expect(guardDutyWebhookDedupeKey(clean)).not.toContain('NO_THREATS_FOUND');
    expect(guardDutyWebhookDedupeKey(infected)).not.toContain('THREATS_FOUND');
  });

  it('🔴 THREATS_FOUND の後に NO_THREATS_FOUND が来ても CLEAN に戻らない', () => {
    // 到着順: INFECTED → CLEAN
    let current: ScanStatus = 'SCANNING';
    for (const incoming of [infected.status, clean.status]) {
      if (decideScanStatusTransition({ current, incoming }) === 'APPLY') current = incoming;
    }
    expect(current).toBe('INFECTED');
  });

  it('逆順（CLEAN → INFECTED）でも最終状態は同じ', () => {
    let current: ScanStatus = 'SCANNING';
    for (const incoming of [clean.status, infected.status]) {
      if (decideScanStatusTransition({ current, incoming }) === 'APPLY') current = incoming;
    }
    expect(current).toBe('INFECTED');
  });
});

describe('パースの fail-closed', () => {
  it.each([
    ['null', null],
    ['配列', []],
    ['detail 無し', { time: '2026-09-06T01:00:00Z' }],
  ] as const)('%s は例外', (_label, raw) => {
    expect(() => parseGuardDutyScanEvent(raw)).toThrow(GuardDutyEventParseError);
  });

  it('🔴 versionId が無い結果を空文字で埋めない（UNIQUE が全件衝突する）', () => {
    const raw = fixture('no-threats-found.json') as {
      detail: { s3ObjectDetails: Record<string, unknown> };
    };
    delete raw.detail.s3ObjectDetails.versionId;
    expect(() => parseGuardDutyScanEvent(raw)).toThrow(/versionId/);
  });

  it('time が無い / 不正なら例外', () => {
    const raw = fixture('no-threats-found.json') as Record<string, unknown>;
    raw.time = 'not-a-date';
    expect(() => parseGuardDutyScanEvent(raw)).toThrow(/time/);
  });
});

describe('WebhookDelivery.payload の往復（正規化済みの形しか保存しない）', () => {
  it('serialize → parse で同じ内部型に戻る', () => {
    const original = parseGuardDutyScanEvent(fixture('threats-found.json'));
    const restored = parseSerializedScanResult(serializeScanResult(original));
    expect(restored).toEqual(original);
  });

  it('保存形は JSON 化できる（Date を残さない）', () => {
    const serialized = serializeScanResult(parseGuardDutyScanEvent(fixture('unsupported.json')));
    expect(typeof serialized.occurredAt).toBe('string');
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
  });

  it('未知の status を保存形から読み戻せない（DB に入っていても CLEAN に寄せない）', () => {
    expect(() =>
      parseSerializedScanResult({
        bucketName: 'b',
        objectKey: 'k',
        objectVersionId: 'v',
        status: 'PROBABLY_OK',
        rawStatus: 'x',
        occurredAt: '2026-09-06T01:00:00.000Z',
      }),
    ).toThrow(GuardDutyEventParseError);
  });
});

describe('🔴 HMAC 署名の検証（docs/05 §8.5 ①。失敗は 401）', () => {
  const rawBody = JSON.stringify(fixture('no-threats-found.json'));

  function verify(overrides: Partial<Parameters<typeof verifyGuardDutySignature>[0]> = {}): boolean {
    return verifyGuardDutySignature({
      rawBody,
      signatureHeader: buildGuardDutySignatureHeader({ rawBody, secret: SECRET, now: NOW }),
      secrets: [SECRET],
      now: NOW,
      ...overrides,
    });
  }

  it('正しい署名は通る（対照）', () => {
    expect(verify()).toBe(true);
  });

  it('🔴 鍵が 1 つも無ければ通さない（fail-closed。「未設定なら検証しない」を作らない）', () => {
    expect(verify({ secrets: [] })).toBe(false);
  });

  it('🔴 署名ヘッダが無ければ通さない', () => {
    expect(verify({ signatureHeader: null })).toBe(false);
    expect(verify({ signatureHeader: '' })).toBe(false);
  });

  it('🔴 本文が 1 バイトでも違えば通らない', () => {
    expect(
      verifyGuardDutySignature({
        rawBody: `${rawBody} `,
        signatureHeader: buildGuardDutySignatureHeader({ rawBody, secret: SECRET, now: NOW }),
        secrets: [SECRET],
        now: NOW,
      }),
    ).toBe(false);
  });

  it('🔴 別の鍵で署名されたものは通らない', () => {
    expect(
      verify({
        signatureHeader: buildGuardDutySignatureHeader({ rawBody, secret: SECRET_ROTATED, now: NOW }),
      }),
    ).toBe(false);
  });

  it('🔴 鍵のローテーション中は「いずれか 1 つ一致」で通る', () => {
    expect(
      verify({
        signatureHeader: buildGuardDutySignatureHeader({ rawBody, secret: SECRET_ROTATED, now: NOW }),
        secrets: [SECRET, SECRET_ROTATED],
      }),
    ).toBe(true);
  });

  it('🔴 許容時間を超えた署名は通らない（再送攻撃を無期限に許さない）', () => {
    const old = new Date(NOW.getTime() - (GUARDDUTY_SIGNATURE_TOLERANCE_SECONDS + 1) * 1000);
    expect(
      verify({ signatureHeader: buildGuardDutySignatureHeader({ rawBody, secret: SECRET, now: old }) }),
    ).toBe(false);
  });

  it('🔴 未来方向のずれも切る（時計をずらした署名を無期限に使わせない）', () => {
    const future = new Date(NOW.getTime() + (GUARDDUTY_SIGNATURE_TOLERANCE_SECONDS + 1) * 1000);
    expect(
      verify({
        signatureHeader: buildGuardDutySignatureHeader({ rawBody, secret: SECRET, now: future }),
      }),
    ).toBe(false);
  });

  it('形の壊れたヘッダは通らない（部分一致で通さない）', () => {
    for (const header of ['', 't=', 'v1=abc', 't=abc,v1=def', 'garbage']) {
      expect(verify({ signatureHeader: header })).toBe(false);
    }
  });
});
