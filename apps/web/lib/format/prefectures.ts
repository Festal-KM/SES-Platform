// apps/web/lib/format/prefectures.ts
// 都道府県コード（JIS X 0401）→ 文言キーの写像。T-06-01。
//
// 🔴 **T-05-01 で `lib/engineers/labels.ts` に置いたものをここへ移した**（T-06-01）。
//    案件（`S-012` の勤務地）も同じ写像を必要とし、「案件の画面がエンジニアの labels を
//    import する」形にすると機能モジュール間に意味の無い依存が生まれる
//    （`lib/format/db-values.ts` と同じ判断）。**都道府県はどの機能にも属さない共通語彙**である。
//
// 🔴 文言そのものは `packages/i18n` が唯一の出所（`CLAUDE.md` §3.5）。ここは写像だけを持つ。
// 🔴 `Record<PrefectureCode, MessageKey>` なので、コードが増減したらここがコンパイルエラーになる。
//    網羅と「その先の文言が実在すること」は `lib/engineers/labels.test.ts` が引き続き確かめる。
import type { PrefectureCode } from '@ses/domain';
import type { MessageKey } from '@ses/i18n';

export const PREFECTURE_MESSAGE_KEYS: Readonly<Record<PrefectureCode, MessageKey>> = {
  '01': 'prefecture.01',
  '02': 'prefecture.02',
  '03': 'prefecture.03',
  '04': 'prefecture.04',
  '05': 'prefecture.05',
  '06': 'prefecture.06',
  '07': 'prefecture.07',
  '08': 'prefecture.08',
  '09': 'prefecture.09',
  '10': 'prefecture.10',
  '11': 'prefecture.11',
  '12': 'prefecture.12',
  '13': 'prefecture.13',
  '14': 'prefecture.14',
  '15': 'prefecture.15',
  '16': 'prefecture.16',
  '17': 'prefecture.17',
  '18': 'prefecture.18',
  '19': 'prefecture.19',
  '20': 'prefecture.20',
  '21': 'prefecture.21',
  '22': 'prefecture.22',
  '23': 'prefecture.23',
  '24': 'prefecture.24',
  '25': 'prefecture.25',
  '26': 'prefecture.26',
  '27': 'prefecture.27',
  '28': 'prefecture.28',
  '29': 'prefecture.29',
  '30': 'prefecture.30',
  '31': 'prefecture.31',
  '32': 'prefecture.32',
  '33': 'prefecture.33',
  '34': 'prefecture.34',
  '35': 'prefecture.35',
  '36': 'prefecture.36',
  '37': 'prefecture.37',
  '38': 'prefecture.38',
  '39': 'prefecture.39',
  '40': 'prefecture.40',
  '41': 'prefecture.41',
  '42': 'prefecture.42',
  '43': 'prefecture.43',
  '44': 'prefecture.44',
  '45': 'prefecture.45',
  '46': 'prefecture.46',
  '47': 'prefecture.47',
};
