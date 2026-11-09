// AI に渡す候補情報を、表示用データから明示的に抜き出す。
// 利用者の名前・所属・単価・候補参照をモデルへ渡さない。
import type { CandidateRowView } from './list-rows';

export type AiCandidateFacts = {
  readonly token: string;
  readonly skills: readonly string[];
};

export type AiCandidateInput = {
  readonly candidates: readonly AiCandidateFacts[];
};

/** 会話文そのものは送らず、登録済みのスキルだけを追加条件として抽出する。 */
export function findRequestedSkills(message: string, allowedSkills: readonly string[]): readonly string[] {
  const text = message.normalize('NFKC').toLocaleLowerCase('ja');
  return [...new Set(allowedSkills.filter((skill) => {
    const normalized = skill.normalize('NFKC').trim().toLocaleLowerCase('ja');
    return normalized.length >= 2 && text.includes(normalized);
  }))];
}

export function prepareCandidateFacts(
  candidates: readonly CandidateRowView[],
  createToken: () => string,
): { readonly input: AiCandidateInput; readonly byToken: ReadonlyMap<string, CandidateRowView> } {
  const byToken = new Map<string, CandidateRowView>();
  const facts = candidates.map((candidate) => {
    const token = createToken();
    if (!token || byToken.has(token)) throw new Error('候補の一時識別子が不正です');
    byToken.set(token, candidate);
    const skills = candidate.kind === 'ANONYMOUS' ? candidate.allSkills : candidate.skills;
    return { token, skills: [...skills] };
  });
  return { input: { candidates: facts }, byToken };
}

/** AI の応答は必ず今回渡した候補に対応するものだけを受け付ける。 */
export function resolveCandidateTokens(
  tokens: readonly string[],
  byToken: ReadonlyMap<string, CandidateRowView>,
): readonly CandidateRowView[] {
  const seen = new Set<string>();
  return tokens.map((token) => {
    const candidate = byToken.get(token);
    if (!candidate || seen.has(token)) throw new Error('候補の応答が不正です');
    seen.add(token);
    return candidate;
  });
}
