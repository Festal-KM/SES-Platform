// apps/web/lib/engineers/labels.ts
// エンジニア台帳の値集合 → 文言キーの写像（`S-007` / `S-005` / `S-006`）。T-05-01。
//
// 🔴 文言そのものは `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。ここは写像だけを持つ。
// 🔴 テンプレートリテラルでキーを組み立てない（`lib/tenants/labels.ts` と同じ規律）。
//    `Record<値集合, MessageKey>` にすることで、**値が増えたら文言の割り当てをコンパイラが強制する**
//    （割り当て漏れが「コードがそのまま画面に出る」形で表に出るのを防ぐ）。
import type { EngineerAvailability, RemoteMode } from '@ses/db';
import { t, type MessageKey } from '@ses/i18n';

/**
 * 🔴 所属区分の表示（`F-008 AC-2`）。**値は認証コンテキストから来る**（行の値でも入力でもない）。
 *    パートナー所属の利用者には「取引先（自社）」と出す —— 他社の名前は出さない
 *    （`CLAUDE.md` §3.1 の 🔴「パートナー同士が相互に参照できる経路を 1 つも作らない」）。
 * 🔴 `S-006`（詳細）と `S-007`（登録・編集）の共通の出所。2 画面に書き写さない。
 */
export function engineerOwnershipLabel(partnerCompanyId: string | null): string {
  return partnerCompanyId === null
    ? t('engineers.ownership.host')
    : t('engineers.ownership.partner');
}

/** `EngineerSkill.level`（1..5）。`null` は「未設定」。 */
export const ENGINEER_SKILL_LEVELS = [1, 2, 3, 4, 5] as const;

export type EngineerSkillLevel = (typeof ENGINEER_SKILL_LEVELS)[number];

export const ENGINEER_AVAILABILITY_MESSAGE_KEYS: Readonly<
  Record<EngineerAvailability, MessageKey>
> = {
  WORKING: 'engineers.availability.WORKING',
  STANDBY_SCHEDULED: 'engineers.availability.STANDBY_SCHEDULED',
  STANDBY: 'engineers.availability.STANDBY',
  INACTIVE: 'engineers.availability.INACTIVE',
};

export const REMOTE_MODE_MESSAGE_KEYS: Readonly<Record<RemoteMode, MessageKey>> = {
  FULL_REMOTE: 'engineers.remoteMode.FULL_REMOTE',
  PARTIAL_REMOTE: 'engineers.remoteMode.PARTIAL_REMOTE',
  ONSITE_ONLY: 'engineers.remoteMode.ONSITE_ONLY',
};

export const ENGINEER_SKILL_LEVEL_MESSAGE_KEYS: Readonly<
  Record<EngineerSkillLevel, MessageKey>
> = {
  1: 'engineers.skills.level.1',
  2: 'engineers.skills.level.2',
  3: 'engineers.skills.level.3',
  4: 'engineers.skills.level.4',
  5: 'engineers.skills.level.5',
};

// 🔴 T-06-01: 都道府県（JIS X 0401）の写像は `lib/format/prefectures.ts` へ移した。
//    案件（`S-012` の勤務地）も同じ写像を使うため、機能モジュールに置いたままだと
//    「案件の画面がエンジニアの labels を import する」形になる（`lib/format/db-values.ts` と同じ判断）。
//    re-export は置かない —— 入口が 2 つあると片方だけが残る。
