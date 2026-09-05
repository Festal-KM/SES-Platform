// apps/web/lib/settings/sending-domain-fact.test.ts
// `resolveSendingDomainFact`（T-04-06）の状態表示ロジック。DB / API を要らない純粋関数のテスト。
import { describe, expect, it } from 'vitest';
import {
  isSendingDomainUnverified,
  resolveSendingDomainFact,
  SENDING_DOMAIN_STATE_MESSAGE_KEYS,
} from './sending-domain-fact';
import type { SendingDomainListView, SendingDomainView } from './sending-domains';

function domain(overrides: Partial<SendingDomainView> = {}): SendingDomainView {
  return {
    id: 'id-1',
    domain: 'example.co.jp',
    state: 'PENDING',
    dkimRecords: [],
    mailFromRecords: [],
    verifiedAt: null,
    lastCheckedAt: null,
    failureReasonKey: null,
    affects: [],
    ...overrides,
  };
}

describe('resolveSendingDomainFact', () => {
  it('required=false のときはドメインの有無を問わず NOT_REQUIRED を返す（sandbox / demo / development）', () => {
    const view: SendingDomainListView = { required: false, domains: [domain({ state: 'VERIFIED' })] };
    expect(resolveSendingDomainFact(view)).toEqual({ kind: 'NOT_REQUIRED' });
  });

  it('ドメインが 1 件も無ければ UNSET（未設定・初回）', () => {
    const view: SendingDomainListView = { required: true, domains: [] };
    expect(resolveSendingDomainFact(view)).toEqual({ kind: 'UNSET' });
  });

  it('VERIFIED の行があれば、登録順によらずそれを代表にする', () => {
    const view: SendingDomainListView = {
      required: true,
      domains: [
        domain({ id: 'a', domain: 'old.example.jp', state: 'FAILED' }),
        domain({ id: 'b', domain: 'new.example.jp', state: 'VERIFIED' }),
      ],
    };
    expect(resolveSendingDomainFact(view)).toEqual({
      kind: 'SET',
      domain: 'new.example.jp',
      state: 'VERIFIED',
    });
  });

  it('VERIFIED が無ければ先頭（登録順で最も古い）行を代表にする', () => {
    const view: SendingDomainListView = {
      required: true,
      domains: [domain({ domain: 'example.co.jp', state: 'REGISTERED' })],
    };
    expect(resolveSendingDomainFact(view)).toEqual({
      kind: 'SET',
      domain: 'example.co.jp',
      state: 'REGISTERED',
    });
  });

  it('状態 → 文言キーの写像が 4 値 + NOT_REQUIRED を過不足なく網羅する', () => {
    expect(Object.keys(SENDING_DOMAIN_STATE_MESSAGE_KEYS).sort()).toEqual(
      ['FAILED', 'NOT_REQUIRED', 'PENDING', 'REGISTERED', 'VERIFIED'].sort(),
    );
  });
});

describe('isSendingDomainUnverified', () => {
  it('NOT_REQUIRED では帯を出さない（sandbox / demo / development）', () => {
    expect(isSendingDomainUnverified({ kind: 'NOT_REQUIRED' })).toBe(false);
  });

  it('UNSET（未登録）では帯を出す', () => {
    expect(isSendingDomainUnverified({ kind: 'UNSET' })).toBe(true);
  });

  it('VERIFIED では帯を出さない', () => {
    expect(isSendingDomainUnverified({ kind: 'SET', domain: 'example.co.jp', state: 'VERIFIED' })).toBe(false);
  });

  it.each(['REGISTERED', 'PENDING', 'FAILED'] as const)('%s では帯を出す', (state) => {
    expect(isSendingDomainUnverified({ kind: 'SET', domain: 'example.co.jp', state })).toBe(true);
  });
});
