// 違反 fixture: 送信系ジョブを internalQueue として定義し直し、attempts: 3 を与える。
// 🔴 型（ExternalSendQueueOptions）はすり抜けるが、AST 走査で落とす。
export const EXTERNAL_SEND_JOB_NAMES = ['send.proposal'] as const;
export const INTERNAL_JOB_NAMES = ['send.hold-release'] as const;

export function externalSendQueue(name: string) {
  return { name, defaultJobOptions: { attempts: 1 } };
}

export function internalQueue(name: string, defaultJobOptions: { attempts: number }) {
  return { name, defaultJobOptions };
}

export const QUEUE_DEFINITIONS = {
  'send.proposal': internalQueue('send.proposal', { attempts: 3 }),
  'send.hold-release': internalQueue('send.hold-release', { attempts: 3 }),
} as const;
