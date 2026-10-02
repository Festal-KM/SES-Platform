// apps/web/lib/home/periods.ts
// 🔴 KPI カードの差分（`docs/04` §7.2 改訂 23 ②）の**期間の境界**。2026-10-02（改訂 23）。
//
// ============================================================================
// 🔴 §7.2 が条文で義務づけた基準（ここが唯一の実装である）
// ============================================================================
// > 「昨日比」は本日 0:00（`Asia/Tokyo`）を起点とした当日の値と、前日 0:00〜24:00 の同時刻までの
// > 値の差 / 「先週比」は当週の月曜 0:00 起点と前週の同曜日・同時刻までの差
//
// 🔴 **差分は「同じ長さの窓」の件数差である**（率ではない。§7.2 は % を禁じている）。したがって
//    必要なのは次の 2 つの窓だけで、どちらも**開始時刻と経過時間**で決まる:
//      - 当期 … `[periodStart, now)`
//      - 前期 … `[previousPeriodStart, previousPeriodStart + (now - periodStart))`
//    🔴 **前期の窓を「前日 0:00〜24:00 の全体」にしない** —— 1 日ぶんと半日ぶんを比べることになり、
//    朝に見ると必ず減って見える（§7.2 が「検算できること」を差分を許した条件にしている）。
//
// 🔴 **`Asia/Tokyo` は固定オフセット（+09:00）である。** 日本は 1951 年以降 DST を持たないため、
//    暦日の境界は `UTC + 9h` の切り下げで厳密に求まる（`Intl` を使う必要が無く、純粋計算で足りる）。
//    ⚠️ **他のタイムゾーンに一般化しない** —— `packages/domain/src/usage/period-key.ts` が
//    「暦は `Asia/Tokyo` 固定。テナントの `timezone` 列で切り替えない」と定めており（横断集計が
//    突き合わせられなくなるため）、本ファイルもその定めに従う。
//
// 🔴 **現在時刻を関数の中で取得しない**（引数で受ける）。`GET /api/home` の `readAt` と同じ
//    インスタンスを渡すことで、**応答に出る基準時刻（挨拶行の「◯時◯分 時点」）と差分の窓が
//    必ず一致する**（1 リクエストの中で 2 つの「いま」を作らない）。
// 🔴 **I/O を持たない純粋関数**（`./summary.ts` から呼ばれ、テストは `./periods.test.ts`）。

/** 🔴 `Asia/Tokyo` の固定オフセット（分）。上の 🔴 のとおり DST を持たない。 */
export const JST_OFFSET_MINUTES = 9 * 60;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * 差分の基準（`docs/04` §7.2 ②）。
 * 🔴 **2 つだけ**（前月比・前年比を作らない。§7.2 は前月比を全画面で禁じている）。
 */
export const DELTA_BASES = ['PREVIOUS_DAY', 'PREVIOUS_WEEK'] as const;
export type DeltaBasis = (typeof DELTA_BASES)[number];

/**
 * 差分を取るための 2 つの窓。
 * 🔴 `currentFrom` と `previousFrom` の**長さは等しい**（どちらも `now - currentFrom`）。
 */
export type DeltaWindow = {
  readonly basis: DeltaBasis;
  /** 当期の開始（JST の暦日 / 週の 0:00）。 */
  readonly currentFrom: Date;
  /** 前期の開始。 */
  readonly previousFrom: Date;
  /** 🔴 前期の終わり（= `previousFrom + (now - currentFrom)`）。**同時刻で切る。** */
  readonly previousTo: Date;
};

/** JST の暦日の 0:00（`now` を含む日）。 */
export function startOfJstDay(now: Date): Date {
  const shifted = now.getTime() + JST_OFFSET_MINUTES * MINUTE_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - JST_OFFSET_MINUTES * MINUTE_MS);
}

/**
 * JST の**月曜** 0:00（`now` を含む週）。
 * 🔴 週の起点を月曜にするのは §7.2 の「当週の月曜 0:00 起点」である（日曜起点にしない ——
 *    SES の交渉は営業日で動き、週の見え方が土日で変わると「今週の提案」が週末に跳ねる）。
 */
export function startOfJstWeek(now: Date): Date {
  const day = startOfJstDay(now);
  // JST での曜日（0 = 日曜）。`getUTCDay` を JST にずらした値で読む（ローカル TZ に依存させない）。
  const jstWeekday = new Date(day.getTime() + JST_OFFSET_MINUTES * MINUTE_MS).getUTCDay();
  // 月曜を 0 とした戻し日数（日曜は 6 日戻す）。
  const back = (jstWeekday + 6) % 7;
  return new Date(day.getTime() - back * DAY_MS);
}

/**
 * 基準に対応する 2 つの窓を作る。
 * 🔴 **`now` が窓の開始より前になる入力を黙って受けない**（`previousTo` が `previousFrom` より
 *    手前になり、件数が常に 0 になる = 差分が静かに嘘になる）。
 */
export function deltaWindowOf(basis: DeltaBasis, now: Date): DeltaWindow {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('deltaWindowOf: 不正な日時が渡されました。');
  }
  const currentFrom = basis === 'PREVIOUS_DAY' ? startOfJstDay(now) : startOfJstWeek(now);
  const span = basis === 'PREVIOUS_DAY' ? DAY_MS : 7 * DAY_MS;
  const elapsed = now.getTime() - currentFrom.getTime();
  if (elapsed < 0) {
    throw new RangeError('deltaWindowOf: now が期間の開始より前です（期間の計算が壊れています）。');
  }
  const previousFrom = new Date(currentFrom.getTime() - span);
  return {
    basis,
    currentFrom,
    previousFrom,
    previousTo: new Date(previousFrom.getTime() + elapsed),
  };
}

/**
 * 基準時刻の表示用の `HH:MM`（JST）。
 * 🔴 挨拶行の右端（「10:42 時点」）であり、**一括更新の時刻**である（`docs/04` §4.1 改訂 23:
 *    更新したことが画面から読める唯一の場所であり省略できない）。
 * 🔴 秒を出さない（ポーリングは 60 秒間隔であり、秒の精度は無い）。
 */
export function formatJstHourMinute(at: Date): string {
  if (Number.isNaN(at.getTime())) throw new RangeError('formatJstHourMinute: 不正な日時が渡されました。');
  const shifted = new Date(at.getTime() + JST_OFFSET_MINUTES * MINUTE_MS);
  const hour = String(shifted.getUTCHours()).padStart(2, '0');
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

/**
 * 挨拶行の日付（`2026/10/02（木）`）。
 *
 * 🔴 **曜日を出す**（`docs/04` §4.1: 満了日・返答期限が「あと何営業日か」の読みに効く。
 *    SES の交渉は営業日で動く）。
 * 🔴 **曜日の語を自前で持たない** —— `Intl` の `ja-JP` が出す語をそのまま使う（`packages/i18n` に
 *    7 語を持つと、同じものを 2 箇所で決めることになる。`lib/format/datetime.ts` と同じ判断）。
 * 🔴 タイムゾーンを明示する（実行環境のローカル TZ に依存させない。同ファイルの 🔴）。
 */
export function formatJstDateWithWeekday(at: Date): string {
  if (Number.isNaN(at.getTime())) throw new RangeError('formatJstDateWithWeekday: 不正な日時が渡されました。');
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}/${pick('month')}/${pick('day')}（${pick('weekday')}）`;
}

/**
 * JST の暦日（`YYYY-MM-DD`）の**通算日数**。
 * 🔴 用途は「今日のワンポイント」の日替わり（静的な文言集から 1 つ選ぶ。`docs/04` §4.1）であり、
 *    **乱数を使わない** —— 同じ日に何度ホームを開いても同じ 1 文であること（60 秒ポーリングで
 *    文が入れ替わると、読んでいる途中で消える）。
 */
export function jstDayIndex(now: Date): number {
  return Math.floor((now.getTime() + JST_OFFSET_MINUTES * MINUTE_MS) / DAY_MS);
}

/**
 * JST の**時**（0〜23）。挨拶の時間帯（`greetingSlotOf`）に渡す。
 * 🔴 端末の時刻に依らせない（移動中の端末設定で挨拶と日付がずれる。`docs/04` §4.1 の挨拶行）。
 */
export function jstHour(now: Date): number {
  return new Date(now.getTime() + JST_OFFSET_MINUTES * MINUTE_MS).getUTCHours();
}
