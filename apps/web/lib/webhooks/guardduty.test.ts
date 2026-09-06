// apps/web/lib/webhooks/guardduty.test.ts
// 🔴 docs/05 §8.5 / §6.10: 受信は「検証 → `WebhookDelivery` に INSERT → 200 → enqueue」で固定される。
//
// ここで固定するのは 6 点である:
//   ① 🔴 **HMAC 検証失敗だけが 401**。それ以外は成功・失敗にかかわらず 200
//   ② 🔴 **重複配信（処理済み）では enqueue しない / 未処理なら再 enqueue する**
//   ③ 🔴 **4 種のステータスがそれぞれ正しい内部型で保存される**（`CLEAN` に寄せない）
//   ④ 🔴 **未知のステータスでも 200 を返し、未処理として記録する**（`A-005` が拾う）
//   ⑤ 🔴 **バケット違い / テナントプレフィックス外は enqueue しない**（401 にもしない）
//   ⑥ 🔴 保存する payload が**正規化済み**の形だけである（生イベントを保存しない）
//
// 🔴 実 AWS / 実 GuardDuty を叩かない（フィクスチャ + 自前の署名）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildGuardDutySignatureHeader,
  GUARDDUTY_SIGNATURE_HEADER,
  type ScanApplyResultJob,
} from '@ses/connectors';

const recordWebhookDelivery = vi.fn();
const markWebhookDeliveryFailed = vi.fn();

vi.mock('@ses/db', () => ({ recordWebhookDelivery, markWebhookDeliveryFailed }));

const { receiveGuardDutyWebhook } = await import('./guardduty');

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', '..', '..', '..', 'tests', 'fixtures', 'guardduty');

const SECRET = 'aFEbwtLtjA7iVuwT7yE4ZbEqmuUYJDRPXFwbSCzsO2A=';
const BUCKET = 'ses-platform-test';
const NOW = new Date('2026-09-06T01:05:00.000Z');
const DELIVERY_ID = '01930000-0000-7000-8000-000000000901';

function body(name: string, mutate: (raw: Record<string, unknown>) => void = () => undefined): string {
  const raw = JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8')) as Record<string, unknown>;
  mutate(raw);
  return JSON.stringify(raw);
}

function signedHeaders(rawBody: string, secret = SECRET, now = NOW): Headers {
  return new Headers({
    [GUARDDUTY_SIGNATURE_HEADER]: buildGuardDutySignatureHeader({ rawBody, secret, now }),
  });
}

function deps(overrides: Partial<Parameters<typeof receiveGuardDutyWebhook>[2]> = {}) {
  return {
    secrets: [SECRET],
    bucket: BUCKET,
    queue: { enqueue: vi.fn(async (job: ScanApplyResultJob) => void job) },
    now: () => NOW,
    ...overrides,
  };
}

beforeEach(() => {
  recordWebhookDelivery.mockReset();
  markWebhookDeliveryFailed.mockReset();
  recordWebhookDelivery.mockResolvedValue({
    deliveryId: DELIVERY_ID,
    duplicate: false,
    processed: false,
  });
});

describe('🔴 HMAC 検証（401 は例外中の例外。docs/05 §6.10）', () => {
  it('正しい署名は 200 で受理され、enqueue される（対照）', async () => {
    const raw = body('no-threats-found.json');
    const d = deps();
    const outcome = await receiveGuardDutyWebhook(raw, signedHeaders(raw), d);
    expect(outcome).toEqual({ status: 200, kind: 'ACCEPTED' });
    expect(d.queue.enqueue).toHaveBeenCalledWith({ deliveryId: DELIVERY_ID });
  });

  it('🔴 署名が無ければ 401 で、DB に 1 行も書かない', async () => {
    const raw = body('no-threats-found.json');
    const d = deps();
    const outcome = await receiveGuardDutyWebhook(raw, new Headers(), d);
    expect(outcome).toEqual({ status: 401 });
    expect(recordWebhookDelivery).not.toHaveBeenCalled();
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it('🔴 本文を差し替えた署名は 401（生ボディで検証している）', async () => {
    const original = body('no-threats-found.json');
    const tampered = body('threats-found.json');
    const d = deps();
    const outcome = await receiveGuardDutyWebhook(tampered, signedHeaders(original), d);
    expect(outcome).toEqual({ status: 401 });
    expect(recordWebhookDelivery).not.toHaveBeenCalled();
  });

  it('🔴 鍵が 1 つも無ければ 401（fail-closed。「未設定なら検証しない」を作らない）', async () => {
    const raw = body('no-threats-found.json');
    const outcome = await receiveGuardDutyWebhook(raw, signedHeaders(raw), deps({ secrets: [] }));
    expect(outcome).toEqual({ status: 401 });
  });

  it('ローテーション中の旧鍵で署名されたものも受理する', async () => {
    const previous = 'Wnzk9uY9j0FhVj6Xh2Q0V8/9OZ5mHYyPPtVUD5+PtVc=';
    const raw = body('no-threats-found.json');
    const outcome = await receiveGuardDutyWebhook(
      raw,
      signedHeaders(raw, previous),
      deps({ secrets: [SECRET, previous] }),
    );
    expect(outcome).toEqual({ status: 200, kind: 'ACCEPTED' });
  });
});

describe('🔴 4 種のステータスが正規化されて保存される（docs/03 §3.4.3-3）', () => {
  it.each([
    ['no-threats-found.json', 'CLEAN', 'NO_THREATS_FOUND'],
    ['threats-found.json', 'INFECTED', 'THREATS_FOUND'],
    ['unsupported.json', 'UNSCANNABLE', 'UNSUPPORTED'],
    ['access-denied.json', 'FAILED', 'ACCESS_DENIED'],
    ['scan-failed.json', 'FAILED', 'FAILED'],
  ] as const)('%s → %s', async (name, status, rawStatus) => {
    const raw = body(name);
    await receiveGuardDutyWebhook(raw, signedHeaders(raw), deps());
    expect(recordWebhookDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'guardduty',
        payload: expect.objectContaining({ status, rawStatus }),
      }),
    );
  });

  it('🔴 保存する payload は正規化済みの形だけである（生イベントを保存しない）', async () => {
    const raw = body('threats-found.json');
    await receiveGuardDutyWebhook(raw, signedHeaders(raw), deps());
    const { payload } = recordWebhookDelivery.mock.calls[0]?.[0] as { payload: Record<string, unknown> };
    expect(Object.keys(payload).sort()).toEqual(
      ['bucketName', 'objectKey', 'objectVersionId', 'occurredAt', 'rawStatus', 'status'].sort(),
    );
    // 生イベントのフィールド（`detail` / `detail-type` / `account`）は 1 つも残らない。
    expect(payload).not.toHaveProperty('detail');
    expect(payload).not.toHaveProperty('account');
  });
});

describe('🔴 未知のステータス・壊れた本文（200 + 未処理として記録）', () => {
  it('未知の scanResultStatus でも 200 を返し、未処理として記録する', async () => {
    const raw = body('unknown-status.json');
    const d = deps();
    const outcome = await receiveGuardDutyWebhook(raw, signedHeaders(raw), d);
    expect(outcome).toEqual({ status: 200, kind: 'UNPARSABLE' });
    expect(markWebhookDeliveryFailed).toHaveBeenCalledWith(DELIVERY_ID, {
      failedAt: NOW,
      failureReason: 'PARSE_ERROR',
    });
    // 🔴 処理させない（未知の判定でファイルの状態を動かさない）。
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it('JSON ですらない本文でも 200（4xx を返さない）', async () => {
    const raw = 'not json at all';
    const outcome = await receiveGuardDutyWebhook(raw, signedHeaders(raw), deps());
    expect(outcome).toEqual({ status: 200, kind: 'UNPARSABLE' });
  });

  it('🔴 dedupeKey に本文（オブジェクトキー）をそのまま載せない', async () => {
    const raw = body('unknown-status.json');
    await receiveGuardDutyWebhook(raw, signedHeaders(raw), deps());
    const { dedupeKey } = recordWebhookDelivery.mock.calls[0]?.[0] as { dedupeKey: string };
    expect(dedupeKey.startsWith('gd:unparsable:')).toBe(true);
    expect(dedupeKey).not.toContain('skill-sheets');
  });
});

describe('🔴 射程外の結果（バケット違い / テナントプレフィックス外）', () => {
  it('別バケットの結果は enqueue せず、UNEXPECTED_BUCKET として記録する', async () => {
    const raw = body('no-threats-found.json', (event) => {
      const detail = event.detail as { s3ObjectDetails: Record<string, unknown> };
      detail.s3ObjectDetails.bucketName = 'someone-elses-bucket';
    });
    const d = deps();
    const outcome = await receiveGuardDutyWebhook(raw, signedHeaders(raw), d);
    expect(outcome).toEqual({ status: 200, kind: 'OUT_OF_SCOPE' });
    expect(d.queue.enqueue).not.toHaveBeenCalled();
    expect(markWebhookDeliveryFailed).toHaveBeenCalledWith(DELIVERY_ID, {
      failedAt: NOW,
      failureReason: 'UNEXPECTED_BUCKET',
    });
  });

  it('`t/{tenantId}/` 配下でないキーは UNSCOPED_OBJECT_KEY として記録する', async () => {
    const raw = body('no-threats-found.json', (event) => {
      const detail = event.detail as { s3ObjectDetails: Record<string, unknown> };
      detail.s3ObjectDetails.objectKey = 'public/leaflet.pdf';
    });
    const d = deps();
    const outcome = await receiveGuardDutyWebhook(raw, signedHeaders(raw), d);
    expect(outcome).toEqual({ status: 200, kind: 'OUT_OF_SCOPE' });
    expect(d.queue.enqueue).not.toHaveBeenCalled();
    expect(markWebhookDeliveryFailed).toHaveBeenCalledWith(DELIVERY_ID, {
      failedAt: NOW,
      failureReason: 'UNSCOPED_OBJECT_KEY',
    });
  });

  it('🔴 射程外でも 401 にしない（署名は正しく、送信元は我々自身である）', async () => {
    const raw = body('no-threats-found.json', (event) => {
      const detail = event.detail as { s3ObjectDetails: Record<string, unknown> };
      detail.s3ObjectDetails.bucketName = 'someone-elses-bucket';
    });
    const outcome = await receiveGuardDutyWebhook(raw, signedHeaders(raw), deps());
    expect(outcome.status).toBe(200);
  });

  it('🔴 射程外の payload にオブジェクトキーを残さない', async () => {
    const raw = body('no-threats-found.json', (event) => {
      const detail = event.detail as { s3ObjectDetails: Record<string, unknown> };
      detail.s3ObjectDetails.bucketName = 'someone-elses-bucket';
    });
    await receiveGuardDutyWebhook(raw, signedHeaders(raw), deps());
    const { payload } = recordWebhookDelivery.mock.calls[0]?.[0] as { payload: Record<string, unknown> };
    expect(payload).toEqual({ bucketMatched: false, tenantScopedKey: true });
  });

  /**
   * 🔴 iteration 2 の指摘: `WebhookDelivery.dedupeKey` は `A-005`（運用監視）と
   *    運営者の監査ログ横断検索（`A-006`）に露出する（`CLAUDE.md` §10.5）。
   *    射程外のキーは「何が入っているか分からない」外来の文字列であり、
   *    `payload` から落としているのと**同じ理由で** `dedupeKey` からも落とす。
   */
  it('🔴 射程外の dedupeKey に生のオブジェクトキー / バケット名が 1 文字も載らない', async () => {
    const foreignKey = 'secret/customer-list/山田太郎.xlsx';
    const raw = body('no-threats-found.json', (event) => {
      const detail = event.detail as { s3ObjectDetails: Record<string, unknown> };
      detail.s3ObjectDetails.bucketName = 'someone-elses-bucket';
      detail.s3ObjectDetails.objectKey = foreignKey;
    });
    await receiveGuardDutyWebhook(raw, signedHeaders(raw), deps());
    const { dedupeKey } = recordWebhookDelivery.mock.calls[0]?.[0] as { dedupeKey: string };
    expect(dedupeKey).toMatch(/^gd:oos:[0-9a-f]{32}$/);
    expect(dedupeKey).not.toContain(foreignKey);
    expect(dedupeKey).not.toContain('secret');
    expect(dedupeKey).not.toContain('山田');
    expect(dedupeKey).not.toContain('someone-elses-bucket');
  });

  it('🔴 射程外でも重複の畳み込みは維持される（同じキー × 版なら同じ dedupeKey）', async () => {
    const mutate = (event: Record<string, unknown>) => {
      const detail = event.detail as { s3ObjectDetails: Record<string, unknown> };
      detail.s3ObjectDetails.bucketName = 'someone-elses-bucket';
    };
    const first = body('no-threats-found.json', mutate);
    // 別のイベント（`id` / `time` / ステータスが違う）だが、同じオブジェクト版である。
    const second = body('threats-found.json', mutate);
    await receiveGuardDutyWebhook(first, signedHeaders(first), deps());
    await receiveGuardDutyWebhook(second, signedHeaders(second), deps());
    const keys = recordWebhookDelivery.mock.calls.map(
      (call) => (call[0] as { dedupeKey: string }).dedupeKey,
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it('🔴 別のオブジェクト版なら別の dedupeKey になる（畳み込みすぎない）', async () => {
    const withVersion = (versionId: string) => (event: Record<string, unknown>) => {
      const detail = event.detail as { s3ObjectDetails: Record<string, unknown> };
      detail.s3ObjectDetails.bucketName = 'someone-elses-bucket';
      detail.s3ObjectDetails.versionId = versionId;
    };
    const first = body('no-threats-found.json', withVersion('v-1'));
    const second = body('no-threats-found.json', withVersion('v-2'));
    await receiveGuardDutyWebhook(first, signedHeaders(first), deps());
    await receiveGuardDutyWebhook(second, signedHeaders(second), deps());
    const keys = recordWebhookDelivery.mock.calls.map(
      (call) => (call[0] as { dedupeKey: string }).dedupeKey,
    );
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('🔴 対照: 射程内（自バケット × テナントプレフィックス）の dedupeKey は従来どおり生キーを含む', async () => {
    const raw = body('no-threats-found.json');
    await receiveGuardDutyWebhook(raw, signedHeaders(raw), deps());
    const { dedupeKey } = recordWebhookDelivery.mock.calls[0]?.[0] as { dedupeKey: string };
    // 自分たちが `buildSkillSheetObjectKey` で組み立てたキーであり（docs/05 §14.1）、
    // 氏名・ファイル名を含まないことが設計で保証されている。畳み込みの単位でもある。
    expect(dedupeKey.startsWith('gd:t/')).toBe(true);
    expect(dedupeKey).not.toMatch(/^gd:oos:/);
  });
});

describe('🔴 重複配信（at-least-once。docs/03 §3.4.3-2）', () => {
  it('同じオブジェクト版の 2 通は同じ dedupeKey になる（gd:{objectKey}:{versionId}）', async () => {
    const clean = body('no-threats-found.json');
    const infected = body('threats-found.json');
    await receiveGuardDutyWebhook(clean, signedHeaders(clean), deps());
    await receiveGuardDutyWebhook(infected, signedHeaders(infected), deps());
    const keys = recordWebhookDelivery.mock.calls.map(
      (call) => (call[0] as { dedupeKey: string }).dedupeKey,
    );
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^gd:t\/[0-9a-f-]{36}\/skill-sheets\/.+:.+$/);
  });

  it('🔴 重複かつ処理済みなら enqueue しない', async () => {
    recordWebhookDelivery.mockResolvedValue({
      deliveryId: DELIVERY_ID,
      duplicate: true,
      processed: true,
    });
    const raw = body('no-threats-found.json');
    const d = deps();
    const outcome = await receiveGuardDutyWebhook(raw, signedHeaders(raw), d);
    expect(outcome).toEqual({ status: 200, kind: 'DUPLICATE' });
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it('🔴 重複だが未処理なら再 enqueue する（永久に処理されない状態を作らない）', async () => {
    recordWebhookDelivery.mockResolvedValue({
      deliveryId: DELIVERY_ID,
      duplicate: true,
      processed: false,
    });
    const raw = body('no-threats-found.json');
    const d = deps();
    const outcome = await receiveGuardDutyWebhook(raw, signedHeaders(raw), d);
    expect(outcome).toEqual({ status: 200, kind: 'DUPLICATE_REQUEUED' });
    expect(d.queue.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 DB / enqueue の失敗は握り潰さない（500 にして再送させる）', () => {
  it('recordWebhookDelivery の失敗はそのまま投げる', async () => {
    recordWebhookDelivery.mockRejectedValue(new Error('db down'));
    const raw = body('no-threats-found.json');
    await expect(receiveGuardDutyWebhook(raw, signedHeaders(raw), deps())).rejects.toThrow('db down');
  });

  it('enqueue の失敗はそのまま投げる', async () => {
    const raw = body('no-threats-found.json');
    const d = deps({
      queue: {
        enqueue: vi.fn(async () => {
          throw new Error('redis down');
        }),
      },
    });
    await expect(receiveGuardDutyWebhook(raw, signedHeaders(raw), d)).rejects.toThrow('redis down');
  });
});
