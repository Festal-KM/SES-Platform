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
  // ✅ T-12-15: `S-003` / `S-004` の要対応キューの種別は、その状態（`GATE_FAILED` / `SUBMIT_FAILED`）そのものを指す。
  GATE_FAILED: ['home.actionQueue.kind.GATE_FAILED', 'proposals.state.GATE_FAILED'],
  SUBMIT_FAILED: ['home.actionQueue.kind.SEND_FAILED', 'proposals.detail.timeline.kind.sendFailure', 'proposals.state.SUBMIT_FAILED'],
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

  // 🔴 T-12-18 ⑯（`docs/04` §7.8 用語の統一）: 「同じ概念に別の語」を 1 語に寄せた結果を固定する。
  //    キーは変えていない（値だけ）。ここが落ちるのは、別の画面が同じ概念を別の語で呼び始めたときである。
  describe('③ docs/04 §7.8 用語の統一（T-12-18 ⑯）', () => {
    it('🔴 寄せる前の語（やめる / 戻る〔取消〕/ 再試行 / （不明） / （なし））が値として 1 つも残っていない', () => {
      const retired = new Set(['やめる', '戻る', '再試行', '再試行する', '（不明）', '（なし）', '却下をやめる']);
      const remaining = Object.entries(ja).filter(([, value]) => retired.has(value)).map(([key]) => key);
      expect(remaining).toEqual([]);
      // 文中の「再試行してください」も動詞形（「もう一度お試しください」）に寄せた（§7.3）。
      expect(Object.entries(ja).filter(([, value]) => value.includes('再試行してください')).map(([key]) => key)).toEqual([]);
    });

    it('確認ダイアログ・フォームの取消は「キャンセル」1 語（統一前: やめる 9 / キャンセル 5 / 戻る 3）', () => {
      const keys = duplicateValueGroups(ja).get('キャンセル') ?? [];
      expect(keys).toEqual(
        [
          'admin.demo.reset.confirm.back',
          'admin.demo.seed.confirm.back',
          'candidates.request.cancel',
          'engineerShares.revoke.confirmCancel',
          'engineerShares.share.confirmCancel',
          'engineers.cancel',
          'members.revoke.cancel',
          'members.roleChange.cancel',
          'partnerCompanies.suspend.cancel',
          'projects.cancel',
          'projects.visibilitySettings.revoke.confirm.cancel',
          'proposalRequests.respond.accept.confirmCancel',
          'proposalRequests.respond.decline.cancel',
          'proposalRequests.withdraw.confirmCancel',
          'proposals.approval.action.rejectCancel',
          'proposals.interview.cancel',
          'proposals.interview.confirm.cancel',
          'sendFailures.resend.confirmCancel',
        ].sort(),
      );
    });

    it('🔴 失敗後の再試行は「もう一度試す」1 語。外部送信の再送（S-022 の「再送する」）はこの語を使わない', () => {
      const keys = duplicateValueGroups(ja).get('もう一度試す') ?? [];
      expect(keys).toEqual(
        [
          'admin.demo.reset.retry',
          'admin.demo.seed.retry',
          'engineerShares.loadMore.retry',
          'engineers.list.error.retry',
          'projects.list.error.retry',
          'proposals.list.error.retry',
          'retention.export.retry',
          'sendFailures.error.retry',
        ].sort(),
      );
      // 再送の語は別（「先方に届いている可能性がある」確認を伴う操作。§7.6）。
      const resendKeys = Object.entries(ja).filter(([key, value]) => key.startsWith('sendFailures.resend') && value === 'もう一度試す');
      expect(resendKeys).toEqual([]);
    });

    it('🔴 「却下」は承認の却下（提案の差し戻し）に限る。新語候補の不採用は「採用しない」', () => {
      const rejectKeys = Object.entries(ja).filter(([, value]) => value === '却下').map(([key]) => key);
      expect(rejectKeys).toEqual(['auditLogs.detail.enum.operation.REJECT']);
      const notAdoptKeys = Object.entries(ja).filter(([, value]) => value === '採用しない').map(([key]) => key).sort();
      expect(notAdoptKeys).toEqual(['auditLogs.detail.enum.decision.REJECT', 'skillDictionary.candidates.reject']);
      expect(ja['skillDictionary.candidates.accept']).toBe('採用する');
      // 新語候補の文言に「却下」が無い（承認の語を辞書整備に持ち込まない）。
      const dictionaryWithReject = Object.entries(ja).filter(([key, value]) => key.startsWith('skillDictionary.') && value.includes('却下'));
      expect(dictionaryWithReject).toEqual([]);
    });

    it('不明値は表のセル「—」と文中「不明」の 2 用法（括弧付きは使わない）', () => {
      const dash = duplicateValueGroups(ja).get('—') ?? [];
      for (const key of ['admin.auditLogs.tenant.unresolved', 'auditLogs.detail.emptyList', 'proposals.approval.createdByUnknown', 'sendFailures.valueNone', 'proposals.list.createdBy.unknown']) {
        expect(dash, key).toContain(key);
      }
      expect(ja['auditLogs.detail.boolean.unknown']).toBe('不明');
      const parenthesized = Object.entries(ja).filter(([, value]) => /^（(不明|なし)）$/.test(value)).map(([key]) => key);
      expect(parenthesized).toEqual([]);
    });
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
