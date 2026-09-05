// 違反 fixture: attempts が変数（リテラルでない）。設定ファイル経由で 1 以外にできてしまう。
const configuredAttempts = 1;

export const EXTERNAL_SEND_JOB_NAMES = ['send.proposal'] as const;
export const INTERNAL_JOB_NAMES = [] as const;

export function externalSendQueue(name: string) {
  return { name, defaultJobOptions: { attempts: configuredAttempts } };
}

export const QUEUE_DEFINITIONS = {
  'send.proposal': externalSendQueue('send.proposal'),
} as const;
