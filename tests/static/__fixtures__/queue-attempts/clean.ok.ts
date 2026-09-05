// 対照 fixture: 正常なキュー定義（tests/static/queue-attempts.test.ts が検査する形）。
export const EXTERNAL_SEND_JOB_NAMES = ['send.proposal', 'send.contract'] as const;
export const INTERNAL_JOB_NAMES = ['send.hold-release'] as const;

export function externalSendQueue(name: string) {
  return { name, defaultJobOptions: { attempts: 1 } };
}

export function internalQueue(name: string, defaultJobOptions: { attempts: number }) {
  return { name, defaultJobOptions };
}

export const QUEUE_DEFINITIONS = {
  'send.proposal': externalSendQueue('send.proposal'),
  'send.contract': externalSendQueue('send.contract'),
  'send.hold-release': internalQueue('send.hold-release', { attempts: 3 }),
} as const;
