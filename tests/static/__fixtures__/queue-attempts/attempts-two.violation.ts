// 違反 fixture: 送信系キューのファクトリが attempts: 2 を返す（自動リトライ = 二重送信）。
export const EXTERNAL_SEND_JOB_NAMES = ['send.proposal'] as const;
export const INTERNAL_JOB_NAMES = [] as const;

export function externalSendQueue(name: string) {
  return { name, defaultJobOptions: { attempts: 2 } };
}

export const QUEUE_DEFINITIONS = {
  'send.proposal': externalSendQueue('send.proposal'),
} as const;
