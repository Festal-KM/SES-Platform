import type { MatchCandidatesJobQueue } from '@ses/connectors';

let queue: MatchCandidatesJobQueue | null = null;
export function configureMatchCandidatesQueue(value: MatchCandidatesJobQueue): void { queue = value; }
export function requireMatchCandidatesQueue(): MatchCandidatesJobQueue {
  if (!queue) throw new Error('候補選出のキューが利用できません');
  return queue;
}
