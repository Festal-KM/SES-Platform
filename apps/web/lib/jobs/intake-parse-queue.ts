import type { IntakeParseJobQueue } from '@ses/connectors';
let queue: IntakeParseJobQueue | null = null;
export function configureIntakeParseQueue(value: IntakeParseJobQueue): void { queue = value; }
export function requireIntakeParseQueue(): IntakeParseJobQueue {
  if (!queue) throw new Error('登録文の AI キューが利用できません');
  return queue;
}
