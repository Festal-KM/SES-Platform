// 違反 fixture: packages/ai 以外が製品プロンプト（@ses/prompts）を import する（docs/05 §7.7）。
import { ROLE_PROMPTS } from '@ses/prompts';

export const use = ROLE_PROMPTS;
