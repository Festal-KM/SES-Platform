// 違反: packages/* から apps/* を相対パス（NodeNext の .js specifier）で import している（CLAUDE.md §2.1 ①）
// パッケージ名の禁止だけでは、この形の import を素通りさせてしまう。
import { placeholder } from '../../../apps/web/src/index.js';

export const use = () => placeholder;
