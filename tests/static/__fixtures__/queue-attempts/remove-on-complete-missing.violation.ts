// 違反 fixture（T-09-06）: 送信系キューのファクトリが removeOnComplete: true を持たない
// （jobId を冪等キーに使うキューで completed が残ると、保留後の再 enqueue が静かに捨てられる。docs/05 §10.4）。
export const EXTERNAL_SEND_JOB_NAMES = ['send.proposal'] as const;
export const INTERNAL_JOB_NAMES = [] as const;

export function externalSendQueue(name: string) {
  return { name, defaultJobOptions: { attempts: 1 } };
}

export const QUEUE_DEFINITIONS = {
  'send.proposal': externalSendQueue('send.proposal'),
} as const;
