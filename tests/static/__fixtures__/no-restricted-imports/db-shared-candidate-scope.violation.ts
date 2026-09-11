// 違反: 匿名共有（CLAUDE.md §3.1 経路 4）の限定経路 withSharedCandidateScope を
// 許可されていない区画から import している（docs/05 §4.5 / P-A-14。T-08-03）。
// 🔴 この関数だけが `app.shared_scope = 'on'` を立てられる。呼び出し元を数えられる状態に保つ。
import { withSharedCandidateScope } from '@ses/db';

export const use = withSharedCandidateScope;
