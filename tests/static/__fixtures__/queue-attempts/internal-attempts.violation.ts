// 違反 fixture: 内部ジョブの attempts が 4（上限 3 を超える）。
export const EXTERNAL_SEND_JOB_NAMES = ['send.proposal'] as const;
export const INTERNAL_JOB_NAMES = ['send.hold-release'] as const;

export function externalSendQueue(name: string) {
  return { name, defaultJobOptions: { attempts: 1 } };
}

export function internalQueue(name: string, defaultJobOptions: { attempts: number }) {
  return { name, defaultJobOptions };
}

export const QUEUE_DEFINITIONS = {
  'send.proposal': externalSendQueue('send.proposal'),
  'send.hold-release': internalQueue('send.hold-release', { attempts: 4 }),
} as const;
