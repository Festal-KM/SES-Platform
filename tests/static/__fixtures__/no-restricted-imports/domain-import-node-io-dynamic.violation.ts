// 違反: packages/domain が Node I/O を動的 import している（CLAUDE.md §2.1 ②）。
// buildDynamicImportSelectors() に forbidNodeIo が渡っていなかった旧実装では素通りしていた。
export const loadFs = async () => import('node:fs');
