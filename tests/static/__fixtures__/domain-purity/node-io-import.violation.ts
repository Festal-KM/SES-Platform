// 違反: Node の I/O モジュールを import している。
import { readFileSync } from 'node:fs';

export function readSomething(path: string): string {
  return readFileSync(path, 'utf8');
}
