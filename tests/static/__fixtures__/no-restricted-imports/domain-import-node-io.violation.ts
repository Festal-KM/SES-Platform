// 違反: packages/domain が Node の I/O (fs) に依存している（CLAUDE.md §2.1 ②）
import fs from 'node:fs';

export const readSomething = () => fs.readFileSync('/tmp/x');
