// apps/web/lib/engineers/detail.ts
// `S-006` エンジニア詳細の表示値の組み立て（docs/04 §S-006 セクション 1 / 2）。T-05-02。
//
// 🔴 画面（`app/(main)/engineers/[id]/page.tsx`）ではなくここに置く理由: `app/**` は
//    ユニットテストの対象外（`vitest.config.ts` の注記）であり、表示値の決まり方
//    ——「未設定は `—`」「単価は片側だけでも読める形にする」——をテストで固定できる場所が要る。
//    ここは **I/O を持たない純粋関数だけ**で、`@ses/db` にも Prisma にも触れない。
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは**日本語の語を書かない**。
//    数値の桁区切りと範囲記号（`〜`）だけが書式であり、単位・接尾辞はすべて `t()` から引く。
import { t, type MessageKey } from '@ses/i18n';
// 🔴 3 桁区切りと単価レンジの**書式**は機能に属さない共通語彙（`lib/format/number.ts`。T-06-02 で
//    案件詳細〔`S-011`〕も同じ書式を使うようになったため移した）。**語（単位・接尾辞）だけは
//    画面ごとに違う**ので、ここで `packages/i18n` から引いて渡す。
import { formatUnitPriceRange as formatRange } from '../format/number';
import { PREFECTURE_MESSAGE_KEYS } from '../format/prefectures';
import type { EngineerDetailView, EngineerSkillView } from './service';
import {
  ENGINEER_AVAILABILITY_MESSAGE_KEYS,
  ENGINEER_SKILL_LEVEL_MESSAGE_KEYS,
  REMOTE_MODE_MESSAGE_KEYS,
} from './labels';

/** 定義リストの 1 行（`docs/04` §11「1 件の属性の羅列は定義リスト」）。 */
export type EngineerDetailRow = {
  /** `data-testid` と React の `key`。文言ではない。 */
  readonly key: string;
  readonly label: string;
  readonly value: string;
};

/** スキル表の 1 行（`docs/04` §S-006 の基本情報のうちスキル）。 */
export type EngineerDetailSkillRow = {
  readonly skillId: string;
  readonly name: string;
  readonly years: string;
  readonly level: string;
};

/** 未設定（`docs/04` §S-006 の定義リストは空欄にせず `—` を置く）。 */
function none(): string {
  return t('engineers.detail.valueNone');
}

/**
 * 単価レンジ（月額・円）— **人材（`S-005` / `S-006`）の語彙で束ねたもの**。
 * 🔴 書式そのものは `lib/format/number.ts` にあり、ここが渡すのは語だけである。
 *    案件（`S-011`）は同じ書式を**別の語**（`projects.*`）で使う（`docs/04` の画面別文言の原則）。
 */
export function formatUnitPriceRange(min: number | null, max: number | null): string {
  return formatRange(min, max, {
    unit: t('engineers.unitPrice.unit'),
    orMore: t('engineers.detail.unitPrice.orMore'),
    orLess: t('engineers.detail.unitPrice.orLess'),
    none: none(),
  });
}

/** 経験年数（`Decimal(4,1)`。`8` → `8 年` / `2.5` → `2.5 年`）。 */
export function formatYears(years: number): string {
  return `${years} ${t('engineers.detail.years.unit')}`;
}

function skillLevelLabel(level: number | null): string {
  if (level === null) return t('engineers.skills.level.unset');
  // 🔴 値集合の外の値（1..5 以外。DB を直接更新された場合など）で画面を落とさない。
  //    `Record<EngineerSkillLevel, …>` の索引は型上 `undefined` にならないため、
  //    実行時の欠落を扱えるようにここだけ広い索引型で読む。
  const keys: Readonly<Record<number, MessageKey | undefined>> = ENGINEER_SKILL_LEVEL_MESSAGE_KEYS;
  const key = keys[level];
  return key === undefined ? none() : t(key);
}

export function engineerDetailSkillRows(
  skills: readonly EngineerSkillView[],
): readonly EngineerDetailSkillRow[] {
  return skills.map((skill) => ({
    skillId: skill.skillId,
    name: skill.name,
    years: formatYears(skill.yearsOfExperience),
    level: skillLevelLabel(skill.level),
  }));
}

/**
 * `docs/04` §S-006 セクション 1 の「折りたたみの外に置く値」（`CLAUDE.md` §13.3。
 * 移動中に見る値であり、モバイルでも必ず見える位置に置く）。
 */
export function engineerHeadlineRows(view: EngineerDetailView): readonly EngineerDetailRow[] {
  return [
    {
      key: 'availability',
      label: t('engineers.availability.label'),
      value: t(ENGINEER_AVAILABILITY_MESSAGE_KEYS[view.availability]),
    },
    {
      key: 'availableFrom',
      label: t('engineers.availableFrom.label'),
      value: view.availableFrom ?? none(),
    },
    {
      key: 'unitPrice',
      label: t('engineers.unitPrice.label'),
      value: formatUnitPriceRange(view.unitPriceMin, view.unitPriceMax),
    },
  ];
}

/**
 * `docs/04` §S-006 セクション 2「基本情報」の定義リスト。
 *
 * 🔴 **`BR-52` の範囲のみ**（`F-008 AC-1`）。本籍・家族構成・健康情報・信条にあたる行を持たない。
 * 🔴 **連絡先を出さない** —— `EngineerDetailView` がそもそも持たない（`service.ts` の注記）。
 * ⚠️ `docs/04` §S-006 の定義リストにある「経験年数（1 件の集約値）」は**出していない**。
 *    `docs/05` §3.4 に集約列が無く、集約の定義（最大値か、代表スキルか、実務年数か）も
 *    決まっていないためである。スキル別の経験年数はスキル表に出しているので、判断材料は
 *    隠れていない。集約値の定義は `F-009` の `yearsMin`（SP-06 T-06-04）と同時に決める。
 *
 * @param ownershipLabel 🔴 **行の値ではなく認証コンテキストから作った表示**（`F-008 AC-2`）。
 *   RLS の C3 により両者は必ず一致するが、「所属を決めるのは ctx」という規律に画面を合わせる。
 */
export function engineerBasicRows(
  view: EngineerDetailView,
  ownershipLabel: string,
): readonly EngineerDetailRow[] {
  return [
    { key: 'ownership', label: t('engineers.ownership.label'), value: ownershipLabel },
    ...engineerHeadlineRows(view),
    {
      key: 'prefecture',
      label: t('engineers.prefecture.label'),
      value: view.prefecture === null ? none() : t(PREFECTURE_MESSAGE_KEYS[view.prefecture]),
    },
    {
      key: 'remoteMode',
      label: t('engineers.remoteMode.label'),
      value: view.remoteMode === null ? none() : t(REMOTE_MODE_MESSAGE_KEYS[view.remoteMode]),
    },
    {
      key: 'preferenceNote',
      label: t('engineers.preferenceNote.label'),
      value: view.preferenceNote === null || view.preferenceNote === '' ? none() : view.preferenceNote,
    },
  ];
}
