// 違反: packages/domain が Node I/O のサブパス（`*/promises` 等）に依存している（CLAUDE.md §2.1 ②）。
// nodeIoPaths() が完全一致（paths）のみだった旧実装では、このサブパスの形が素通りしていた。
import { readFile } from 'node:fs/promises';
import { readFile as readFileNoPrefix } from 'fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { finished } from 'node:stream/promises';

export const readSomething = async () => {
  await delay(0);
  await finished(readFileNoPrefix('/tmp/y'));
  return readFile('/tmp/x');
};
