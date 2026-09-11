// 正常系: tests/isolation/** は分離機構そのものを検証する区画であり、
// withSharedCandidateScope を import してよい（@ses/db/testing と同じ扱い。docs/05 §4.7）。
import { withSharedCandidateScope, withTenant } from '@ses/db';

export const use = [withSharedCandidateScope, withTenant];
