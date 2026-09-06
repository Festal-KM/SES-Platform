// apps/web/lib/engineers/list-rows.ts
// `S-005` エンジニア台帳（一覧）の表示値の組み立て（docs/04 §S-005）。T-05-09。
//
// 🔴 画面（`app/(main)/engineers/**`）ではなくここに置く理由は `detail.ts` と同じである:
//    `app/**` はユニットテストの対象外（`vitest.config.ts` の注記）であり、
//    「上位 3 件の選び方」「`+N` の数え方」「未設定の見せ方」を固定できる場所が要る。
//    ここは **I/O を持たない純粋関数だけ**で、`@ses/db` にも Prisma にも触れない。
// 🔴 文言は `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。本ファイルは**日本語の語を書かない**。
import { t } from '@ses/i18n';
import { PREFECTURE_MESSAGE_KEYS } from '../format/prefectures';
import { formatThousands, formatUnitPriceRange } from './detail';
import { ENGINEER_AVAILABILITY_MESSAGE_KEYS, REMOTE_MODE_MESSAGE_KEYS } from './labels';
import type { OwnEngineerView } from './list';

/**
 * 🔴 一覧に出すスキルの件数（`docs/04` §S-005「主要スキル（上位 3 のみ表示、超過は `+N`）」/
 *    §「テーブルの列ごとの省略方針」）。**`S-016`（匿名候補）の 8 件とは別の値である**
 *    （あちらは `U-06` の開示上限であり、こちらは列幅の都合）。
 */
export const PRIMARY_SKILL_LIMIT = 3;

/** 上位 3 件を選ぶのに要る最小限（名前は選抜の判断に使わない）。 */
export type EngineerSkillCandidate = {
  readonly skillId: string;
  readonly yearsOfExperience: number;
};

/**
 * 🔴 **「主要スキル」の決定的な選び方**: 経験年数の降順、同順は `skillId` の昇順。
 *
 * `docs/02` `F-017` 処理②が匿名候補のスキル並びに定めている規則と**同じもの**を使う
 * （2 つの規則を持つと、同じエンジニアが自社台帳と匿名候補で違うスキルを代表として出す）。
 * 🔴 入力の配列を破壊しない（DB から読んだ配列をそのまま並べ替えると、呼び出し側の
 *    別の用途に影響する）。
 */
export function pickPrimarySkills<T extends EngineerSkillCandidate>(
  skills: readonly T[],
  limit: number = PRIMARY_SKILL_LIMIT,
): { readonly shown: readonly T[]; readonly more: number } {
  const sorted = [...skills].sort((a, b) => {
    if (a.yearsOfExperience !== b.yearsOfExperience) {
      return b.yearsOfExperience - a.yearsOfExperience;
    }
    return a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : 0;
  });
  return {
    shown: sorted.slice(0, limit),
    more: Math.max(sorted.length - limit, 0),
  };
}

/** 1 行分の表示値（すべて文字列。画面は組み立てをせず、そのまま描く）。 */
export type EngineerListRowView = {
  readonly id: string;
  readonly displayName: string;
  readonly ownership: string;
  readonly skills: readonly string[];
  /** 🔴 超過件数の表示（`+2`）。0 件なら `null`（`+0` を描かない）。 */
  readonly moreSkills: string | null;
  readonly unitPrice: string;
  readonly availableFrom: string;
  /** 勤務地・リモート可否（`docs/04` §S-005 の 1 列）。 */
  readonly location: string;
  readonly availability: string;
  readonly updatedOn: string;
};

/** 未設定（`docs/04` §S-006 と同じく、空欄にせず `—` を置く）。 */
function none(): string {
  return t('engineers.detail.valueNone');
}

/**
 * 勤務地とリモート可否を 1 列に畳む（`docs/04` §S-005 の「勤務地・リモート」列）。
 * 🔴 片方しか無い行を `—` にしない（`formatUnitPriceRange` と同じ判断。片側でも営業判断に使える）。
 */
export function formatLocation(
  prefecture: OwnEngineerView['prefecture'],
  remoteMode: OwnEngineerView['remoteMode'],
): string {
  const parts = [
    prefecture === null ? null : t(PREFECTURE_MESSAGE_KEYS[prefecture]),
    remoteMode === null ? null : t(REMOTE_MODE_MESSAGE_KEYS[remoteMode]),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? none() : parts.join('・');
}

export function engineerListRow(view: OwnEngineerView): EngineerListRowView {
  return {
    id: view.id,
    displayName: view.displayName,
    ownership:
      view.ownership === 'HOST' ? t('engineers.ownership.host') : t('engineers.ownership.partner'),
    skills: view.primarySkills.map((skill) => skill.name),
    // 🔴 `+N` は語ではなく記号 + 数値である（`formatUnitPriceRange` の `〜` と同じ扱い）。
    moreSkills: view.moreSkillCount === 0 ? null : `+${view.moreSkillCount}`,
    unitPrice: formatUnitPriceRange(view.unitPriceMin, view.unitPriceMax),
    availableFrom: view.availableFrom ?? none(),
    location: formatLocation(view.prefecture, view.remoteMode),
    availability: t(ENGINEER_AVAILABILITY_MESSAGE_KEYS[view.availability]),
    updatedOn: view.updatedOn,
  };
}

export function engineerListRows(
  items: readonly OwnEngineerView[],
): readonly EngineerListRowView[] {
  return items.map(engineerListRow);
}

/**
 * 🔴 **母集団の明示**（`docs/04` §3.2 項目 2 / §S-005「母集団の明示」）。
 *
 * ホスト:「自社台帳 1,240 件」/ 取引先:「**御社が登録した人材** 128 件」。
 * 🔴 値は API の `total`（＝ 一覧と同じ `where` の `COUNT`。境界適用後）だけを使う。
 *    クライアントで数え直さない（数え直すと、ページングした瞬間に件数が変わる）。
 * 🔴 出所は `ctx.partnerCompanyId` である（行の値ではない。`F-008 AC-2` と同じ規律）。
 */
export function engineerPopulationLabel(partnerCompanyId: string | null, total: number): string {
  const scope =
    partnerCompanyId === null
      ? t('engineers.list.population.host')
      : t('engineers.list.population.partner');
  // 🔴 3 桁区切りは `detail.ts` の `formatThousands` を使う（`toLocaleString` を使わない理由も
  //    そちらに書いてある。2 実装にすると単価と件数で桁区切りがずれる）。
  return `${scope} ${formatThousands(total)} ${t('engineers.list.population.unit')}`;
}
