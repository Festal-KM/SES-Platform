// 違反 fixture: 表のキーと実際のジョブ名がずれている（別のキューに積まれる）。
export const EXTERNAL_SEND_JOB_NAMES = ['send.proposal', 'send.contract'] as const;
export const INTERNAL_JOB_NAMES = [] as const;

export function externalSendQueue(name: string) {
  return { name, defaultJobOptions: { attempts: 1 } };
}

export const QUEUE_DEFINITIONS = {
  'send.proposal': externalSendQueue('send.contract'),
} as const;
