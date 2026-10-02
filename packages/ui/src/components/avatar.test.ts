// packages/ui/src/components/avatar.test.ts
// 🔴 **イニシャルの長さの壁**（2026-10-02 のブリーフ）。
//
// なぜ要るか: 円の中に 3 文字以上を入れると、**内容量で寸法が変わる**。
// `HANDOFF.md` §3.3 の 1 件目（`S-016` の行の高さがスキル件数で変わり、それ自体が 6 つ目の
// 開示項目になっていた）と**同じ性質の問題**であり、「見た目の性質が情報になる」経路を作らない。
// 🔴 **切り出しは呼び出し側の責務である**（姓名の順・ミドルネーム・英字で規則が変わるため、
//    部品が勝手に切ると画面ごとに違う規則が生まれる）。壁はその分担を型の外から守る。
import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_INITIALS, Avatar } from './avatar.js';

describe('Avatar の壁', () => {
  it('🔴 上限は 2 文字である', () => {
    expect(AVATAR_MAX_INITIALS).toBe(2);
    expect(() => Avatar({ initials: '山田太', title: '山田太郎' })).toThrow(/2 文字まで/);
  });

  it('1〜2 文字は通る（日本語 1 文字 / 英字 2 文字のどちらも）', () => {
    expect(() => Avatar({ initials: '山', title: '山田太郎' })).not.toThrow();
    expect(() => Avatar({ initials: 'YT', title: 'Yamada Taro' })).not.toThrow();
  });
});
