// 違反 fixture: パッケージ名を避けて相対パスで製品プロンプトへ到達しようとする（docs/05 §7.7）。
import { ROLE_PROMPTS } from '../../prompts/roles/index.js';

export const use = ROLE_PROMPTS;
