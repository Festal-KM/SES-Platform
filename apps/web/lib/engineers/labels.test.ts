// apps/web/lib/engineers/labels.test.ts
// 値集合 → 文言キーの写像に穴が無いことを固定する。T-05-01。
//
// 🔴 `Record<値集合, MessageKey>` は「キーの網羅」をコンパイル時に強制するが、
//    **その先の文言が実在するか**は `t()` を呼ばないと分からない（`MessageKey` は
//    `packages/i18n` の型なので実在しないキーは型エラーになるが、ビルド済み `dist` を
//    参照する構成では取りこぼしうる）。ここで実際に引いて空文字でないことを確かめる。
import { describe, expect, it } from 'vitest';
import { ENGINEER_AVAILABILITIES, REMOTE_MODES } from '@ses/db';
import { PREFECTURE_CODES } from '@ses/domain';
import { t } from '@ses/i18n';
// 🔴 T-06-01: 都道府県の写像は `lib/format/prefectures.ts` へ移した（案件も同じ写像を使うため）。
//    網羅の検証は引き続きここが持つ（テストを分けると、どちらかだけが更新される）。
import { PREFECTURE_MESSAGE_KEYS } from '../format/prefectures';
import {
  ENGINEER_AVAILABILITY_MESSAGE_KEYS,
  ENGINEER_SKILL_LEVELS,
  ENGINEER_SKILL_LEVEL_MESSAGE_KEYS,
  REMOTE_MODE_MESSAGE_KEYS,
} from './labels';

describe('都道府県（JIS X 0401）', () => {
  it('47 件ある（コードの出所は @ses/domain）', () => {
    expect(PREFECTURE_CODES).toHaveLength(47);
    expect(new Set(PREFECTURE_CODES).size).toBe(47);
  });

  it.each(PREFECTURE_CODES)('%s に空でない表示名がある', (code) => {
    expect(t(PREFECTURE_MESSAGE_KEYS[code]).length).toBeGreaterThan(0);
  });

  it('表示名が重複しない（別の県が同じ名前にならない）', () => {
    const labels = PREFECTURE_CODES.map((code) => t(PREFECTURE_MESSAGE_KEYS[code]));
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('台帳の値集合', () => {
  it.each(ENGINEER_AVAILABILITIES)('稼働状況 %s に表示名がある', (value) => {
    expect(t(ENGINEER_AVAILABILITY_MESSAGE_KEYS[value]).length).toBeGreaterThan(0);
  });

  it.each(REMOTE_MODES)('リモート可否 %s に表示名がある', (value) => {
    expect(t(REMOTE_MODE_MESSAGE_KEYS[value]).length).toBeGreaterThan(0);
  });

  it.each(ENGINEER_SKILL_LEVELS)('スキルレベル %s に表示名がある', (value) => {
    expect(t(ENGINEER_SKILL_LEVEL_MESSAGE_KEYS[value]).length).toBeGreaterThan(0);
  });
});
