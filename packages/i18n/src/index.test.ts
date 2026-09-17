// packages/i18n/src/index.test.ts
// カタログの構造の検査（T-10-01）。
//
// 🔴 「同じ概念に別の語」を機械で見つけることはできない。ここで見るのは逆向きの **「同じ語が別のキーにある」** であり、
//    それ自体は違反ではない（「案件名」が画面ごとのキーに繰り返されるのは、同じ概念を同じ語で呼んでいる正常な状態）。
//    一覧は `GLOSSARY` への寄せ候補として `docs/sprints/SP-10` T-10-01 の申し送りに載せる（`duplicateValueGroups`）。
//    固定するのは次の 2 点だけ:
//      ① 4 つの「うまくいかなかった」の語が現れるキーは列挙どおり（別の画面が同じ語を別の概念に使い始めたら落ちる）
//      ② 値が空 / 空白だけのキーが無い（キーを置いて値を忘れた状態を作らない）
import { describe, expect, it } from 'vitest';

import { OUTCOME_LABELS } from './glossary.js';
import { catalog, DEFAULT_LOCALE, LOCALES, type MessageKey } from './index.js';

/** 同じ値を持つキーの一覧（値 → キー配列。2 キー以上のものだけ）。 */
export function duplicateValueGroups(entries: Readonly<Record<string, string>>): ReadonlyMap<string, readonly string[]> {
  const byValue = new Map<string, string[]>();
  for (const [key, value] of Object.entries(entries)) {
    const keys = byValue.get(value);
    if (keys === undefined) byValue.set(value, [key]);
    else keys.push(key);
  }
  return new Map([...byValue.entries()].filter(([, keys]) => keys.length >= 2).map(([value, keys]) => [value, [...keys].sort()]));
}

/**
 * 🔴 ① 4 つの「うまくいかなかった」の語が**値として丸ごと**現れるキーの列挙。
 *    足すときは、その画面がその状態そのものを指していることを確認してから列挙に加える。
 */
const OUTCOME_LABEL_KEYS: Readonly<Record<keyof typeof OUTCOME_LABELS, readonly MessageKey[]>> = {
  GATE_FAILED: ['proposals.state.GATE_FAILED'],
  SUBMIT_FAILED: ['proposals.detail.timeline.kind.sendFailure', 'proposals.state.SUBMIT_FAILED'],
  LOST: ['proposals.state.LOST'],
  DECLINED: ['proposalRequests.state.DECLINED', 'proposals.list.requestState.DECLINED'],
};

describe('カタログの構造', () => {
  const ja = catalog(DEFAULT_LOCALE);

  it('ロケールは ja のみ', () => {
    expect(LOCALES).toEqual(['ja']);
  });

  it('② 値が空・空白だけのキーが無い', () => {
    const empty = Object.entries(ja)
      .filter(([, value]) => value.trim().length === 0)
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('① 4 つの「うまくいかなかった」の語を値に持つキーは列挙どおり', () => {
    for (const [kind, label] of Object.entries(OUTCOME_LABELS) as [keyof typeof OUTCOME_LABELS, string][]) {
      const keys = Object.entries(ja)
        .filter(([, value]) => value === label)
        .map(([key]) => key)
        .sort();
      expect(keys, `${kind}「${label}」`).toEqual([...OUTCOME_LABEL_KEYS[kind]].sort());
    }
  });

  it('同じ値を持つキーの一覧（GLOSSARY への寄せ候補。docs/sprints/SP-10 T-10-01 の申し送りに転記）', () => {
    const groups = duplicateValueGroups(ja);
    // 構造の健全性だけを見る（件数を固定しない —— 同じ概念を同じ語で呼ぶキーが増えるのは正常）。
    expect(groups.size).toBeGreaterThan(0);
    for (const [value, keys] of groups) {
      expect(keys.length).toBeGreaterThanOrEqual(2);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) expect(ja[key as MessageKey]).toBe(value);
    }
  });

  it('同じ語が別の概念を指す既知の組は、少なくとも語幹の共有にとどまる（「辞退」= 操作の語 / `WITHDRAWN` の状態語）', () => {
    // 🔴 `auditLogs.detail.enum.operation.DECLINE`（提案依頼を辞退する**操作**）と `proposals.state.WITHDRAWN`（提案の**状態**）が
    //    同じ「辞退」を持つのは意図した重複である（`GLOSSARY.decline` の語幹）。同じ画面に並ばない。
    const declineKeys = duplicateValueGroups(ja).get(ja['proposals.state.WITHDRAWN']) ?? [];
    expect(declineKeys).toContain('proposals.state.WITHDRAWN');
    expect(declineKeys).not.toContain('proposalRequests.state.DECLINED');
    expect(declineKeys).not.toContain('proposals.list.requestState.DECLINED');
  });
});
