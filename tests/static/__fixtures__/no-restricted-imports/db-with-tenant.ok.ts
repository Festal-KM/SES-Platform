// 正常系: @ses/db の通常の入口（withTenant）はどの区画からでも import できる
// （withSharedCandidateScope の禁止が @ses/db 全体を塞いでいないことの対照）。
import { withTenant } from '@ses/db';

export const use = withTenant;
