// apps/web/lib/home/periods.test.ts
// 🔴 KPI カードの差分の**期間の境界**（`docs/04` §7.2 改訂 23 ② が条文で義務づけた基準時刻）。
//
// 固定するもの:
//   ① 🔴 暦日・週の境界は **JST（+09:00）**である（UTC で切らない = 0:00〜8:59 が前日に落ちない）
//   ② 🔴 週の起点は**月曜**（日曜起点にしない。営業日で動く業務に合わせる）
//   ③ 🔴 前期の窓は **同時刻で切る**（1 日ぶんと半日ぶんを比べない = 朝に必ず減って見える形を作らない）
//   ④ 🔴 不正な入力を黙って受けない（差分が静かに嘘になる経路を作らない）
//   ⑤ 日替わりの選択は**決定的**（同じ日なら何度開いても同じ 1 文）
import { describe, expect, it } from 'vitest';
import {
  deltaWindowOf,
  formatJstDateWithWeekday,
  formatJstHourMinute,
  jstDayIndex,
  jstHour,
  startOfJstDay,
  startOfJstWeek,
} from './periods';

describe('🔴 ① 暦日の境界は JST である', () => {
  it('JST の 0:30 は当日の 0:00 に丸まる（UTC で切ると前日になる）', () => {
    // 2026-10-02 00:30 JST = 2026-10-01T15:30:00Z。
    expect(startOfJstDay(new Date('2026-10-01T15:30:00Z')).toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });

  it('JST の 23:59 も同じ日に丸まる', () => {
    expect(startOfJstDay(new Date('2026-10-02T14:59:00Z')).toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });

  it('JST の 0:00 ちょうどはその日の起点である', () => {
    expect(startOfJstDay(new Date('2026-10-01T15:00:00Z')).toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });
});

describe('🔴 ② 週の起点は月曜 0:00（JST）', () => {
  it('金曜から見た週の起点は同じ週の月曜', () => {
    // 2026-10-02 は金曜。月曜は 2026-09-28（= 2026-09-27T15:00Z）。
    expect(startOfJstWeek(new Date('2026-10-02T03:00:00Z')).toISOString()).toBe('2026-09-27T15:00:00.000Z');
  });

  it('🔴 日曜はその週の月曜（= 6 日前）に丸まる（日曜起点にしない）', () => {
    // 2026-10-04（日）12:00 JST = 2026-10-04T03:00Z。月曜は 2026-09-28。
    expect(startOfJstWeek(new Date('2026-10-04T03:00:00Z')).toISOString()).toBe('2026-09-27T15:00:00.000Z');
  });

  it('月曜 0:00 ちょうどはその週の起点である', () => {
    expect(startOfJstWeek(new Date('2026-09-27T15:00:00Z')).toISOString()).toBe('2026-09-27T15:00:00.000Z');
  });
});

describe('🔴 ③ 前期の窓は同時刻で切る（同じ長さの窓を比べる）', () => {
  it('昨日比: 当日 0:00 起点 / 前日 0:00 から同じ経過時間まで', () => {
    const window = deltaWindowOf('PREVIOUS_DAY', new Date('2026-10-02T03:00:00Z')); // 金 12:00 JST
    expect(window.currentFrom.toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect(window.previousFrom.toISOString()).toBe('2026-09-30T15:00:00.000Z');
    expect(window.previousTo.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    // 🔴 2 つの窓の長さが等しい。
    expect(window.previousTo.getTime() - window.previousFrom.getTime()).toBe(
      new Date('2026-10-02T03:00:00Z').getTime() - window.currentFrom.getTime(),
    );
  });

  it('先週比: 当週の月曜 0:00 起点 / 前週の同曜日・同時刻まで', () => {
    const window = deltaWindowOf('PREVIOUS_WEEK', new Date('2026-10-02T03:00:00Z'));
    expect(window.currentFrom.toISOString()).toBe('2026-09-27T15:00:00.000Z');
    expect(window.previousFrom.toISOString()).toBe('2026-09-20T15:00:00.000Z');
    // 金曜 12:00 JST 相当 = 2026-09-25T03:00Z。
    expect(window.previousTo.toISOString()).toBe('2026-09-25T03:00:00.000Z');
  });

  it('🔴 週明け直後（月曜 0:05）でも窓が崩れない（前週の月曜 0:05 まで）', () => {
    const window = deltaWindowOf('PREVIOUS_WEEK', new Date('2026-09-27T15:05:00Z'));
    expect(window.previousFrom.toISOString()).toBe('2026-09-20T15:00:00.000Z');
    expect(window.previousTo.toISOString()).toBe('2026-09-20T15:05:00.000Z');
  });
});

describe('🔴 ④ 不正な入力を黙って受けない', () => {
  it('不正な日時は例外（差分が静かに 0 にならない）', () => {
    expect(() => deltaWindowOf('PREVIOUS_DAY', new Date('x'))).toThrow(RangeError);
    expect(() => formatJstHourMinute(new Date('x'))).toThrow(RangeError);
    expect(() => formatJstDateWithWeekday(new Date('x'))).toThrow(RangeError);
  });
});

describe('表示（基準時刻 / 日付）', () => {
  it('基準時刻は JST の `HH:MM`（秒を出さない）', () => {
    expect(formatJstHourMinute(new Date('2026-10-02T01:42:30Z'))).toBe('10:42');
  });

  it('0 時台も 2 桁で出る', () => {
    expect(formatJstHourMinute(new Date('2026-10-01T15:05:00Z'))).toBe('00:05');
  });

  it('日付は曜日つき（`Intl` の `ja-JP` の語をそのまま使う）', () => {
    expect(formatJstDateWithWeekday(new Date('2026-10-02T03:00:00Z'))).toBe('2026/10/02（金）');
  });

  it('🔴 JST の深夜も当日として出る（UTC 切り出しなら前日になる）', () => {
    expect(formatJstDateWithWeekday(new Date('2026-10-01T15:30:00Z'))).toBe('2026/10/02（金）');
  });

  it('時間帯の判定は JST の時（挨拶の 3 区分に渡す値）', () => {
    expect(jstHour(new Date('2026-10-01T15:30:00Z'))).toBe(0);
    expect(jstHour(new Date('2026-10-02T01:00:00Z'))).toBe(10);
  });
});

describe('🔴 ⑤ 日替わりの選択は決定的（同じ日なら同じ値）', () => {
  it('同じ暦日の 2 つの時刻で同じ指標になる', () => {
    expect(jstDayIndex(new Date('2026-10-01T15:00:00Z'))).toBe(jstDayIndex(new Date('2026-10-02T14:59:00Z')));
  });

  it('翌日は 1 つ進む', () => {
    expect(jstDayIndex(new Date('2026-10-02T15:00:00Z')) - jstDayIndex(new Date('2026-10-02T14:59:00Z'))).toBe(1);
  });
});
