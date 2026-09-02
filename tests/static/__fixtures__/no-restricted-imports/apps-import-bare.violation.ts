// 違反: packages/* から apps/* をパッケージ名で import している（CLAUDE.md §2.1 ①）
import { placeholder } from '@ses/web';

export const use = () => placeholder;
