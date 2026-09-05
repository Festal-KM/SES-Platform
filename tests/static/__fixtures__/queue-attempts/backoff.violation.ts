// 違反 fixture: 送信系キューに backoff（再試行の間隔）が設定されている。
export const EXTERNAL_SEND_JOB_NAMES = ['send.proposal'] as const;
export const INTERNAL_JOB_NAMES = [] as const;

export function externalSendQueue(name: string) {
  return { name, defaultJobOptions: { attempts: 1, backoff: { type: 'fixed', delay: 5000 } } };
}

export const QUEUE_DEFINITIONS = {
  'send.proposal': externalSendQueue('send.proposal'),
} as const;
