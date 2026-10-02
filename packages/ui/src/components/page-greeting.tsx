// packages/ui/src/components/page-greeting.tsx
// 🔴 ホーム（`S-003` / `S-004`）の挨拶ブロック（2026-10-02 の人間のブリーフ）。
//    **`おはようございます、◯◯さん` + 日付 + 一文 + 右端の標語。**
//
// ============================================================================
// 🔴 時計をこの部品に持ち込まない（本ファイルの主眼）
// ============================================================================
// ブリーフの要求は 2 つある: ①**時間帯で挨拶を変える**（朝 / 昼 / 夜）②🔴 **日付と挨拶は
// サーバで決める**（クライアントの時計に依存させない）。
//
// 🔴 したがって **この部品は `new Date()` を呼ばない。** 呼ぶと次が起きる:
//   - サーバで描いた「おはようございます」とクライアントの再水和が食い違い、**ハイドレーション
//     不一致**になる（日付をまたぐ瞬間・端末の時計がずれている場合に必ず起きる）。
//   - 利用者の端末のタイムゾーンで朝夕が決まり、**テナントの営業時間と無関係な挨拶**になる。
//
// 代わりに **時間帯の判定だけを純粋関数（`greetingSlotOf`）として切り出す**。呼び出し側
// （`apps/web` のサーバコンポーネント）が時刻を与えて区分を得て、`packages/i18n` で語に解決し、
// **解決済みの文字列**をこの部品に渡す（`../index.ts` の共通規約 5: 文言を持たない）。
//
// 🔴 **`'use client'` を宣言しない**（規約 4）。🔴 **`children` / `ReactNode` の prop を持たない。**
import { cn } from '../lib/cn.js';

/**
 * 時間帯の区分（🔴 **3 つだけ**。深夜の 4 区分目を作らない —— 区分を増やすと語の数が増え、
 * 「どの区分がどの時刻か」を画面ごとに判断することになる）。
 */
export const GREETING_SLOTS = ['MORNING', 'AFTERNOON', 'EVENING'] as const;

export type GreetingSlot = (typeof GREETING_SLOTS)[number];

/**
 * 時刻（0〜23 時）から時間帯を決める **純粋関数**。
 *
 * 🔴 **境界をここ 1 箇所で決める**（画面ごとに `hour < 12` と `hour <= 11` が混ざらない）。
 *   - `MORNING` … 5〜10 時（出社前後。ホームを最初に開く時間帯）
 *   - `AFTERNOON` … 11〜17 時（客先・移動。`CLAUDE.md` §13.1）
 *   - `EVENING` … 18〜4 時（帰社後と深夜）
 *
 * 🔴 **範囲外の値を黙って丸めない**（`-1` / `24` は呼び出し側の時刻の作り方が壊れている徴候
 *    であり、`EVENING` として描くと気づけない）。
 */
export function greetingSlotOf(hour: number): GreetingSlot {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`greetingSlotOf: hour は 0〜23 の整数です（渡された値: ${String(hour)}）。`);
  }
  if (hour >= 5 && hour <= 10) return 'MORNING';
  if (hour >= 11 && hour <= 17) return 'AFTERNOON';
  return 'EVENING';
}

export type PageGreetingProps = {
  /**
   * 挨拶（`おはようございます、山田さん`）。
   * 🔴 **氏名の差し込みまで済ませた文字列**を渡す（部品は語を組まない）。
   * ⚠️ ホームに**エンジニアの氏名**を出さないという規律（`HANDOFF.md` §3.3 / `BR-27`）とは別物で
   *    ある —— ここに出るのは**サインインしている本人の名**であり、監査ログの対象ではない。
   */
  readonly greeting: string;
  /** 日付（`2026年10月2日（金）`）。🔴 **整形済み**（サーバで決める。上の 🔴）。 */
  readonly dateLabel: string;
  /** 一文（`今日は提案の返答が 2 件あります` 等）。`null` なら描かない。 */
  readonly lead: string | null;
  /** 右端の標語（`正しい情報を、正しい相手にだけ。`）。`null` なら描かない。 */
  readonly motto: string | null;
  /** testid の接頭辞（例 `home-host-greeting-`）。 */
  readonly testIdPrefix: string;
  readonly className?: string;
};

/** 🔴 挨拶は §7.3 の 1 段目（20px / 600）。**画面タイトルと同じ段**で、これ以上大きくしない。 */
const GREETING_CLASSES = 'm-0 text-title font-semibold text-fg';
/** 日付と一文は補助テキスト（12px / `--color-fg-muted`）。 */
const META_CLASSES = 'm-0 text-xs text-fg-muted';
/**
 * 標語。🔴 **右端に寄せるが、狭い画面では下に回り込む**（`CLAUDE.md` §13.3: 狭い画面を理由に
 * 判断材料を隠さない。標語は判断材料ではないが、**隠すために `hidden` を書く習慣を作らない**）。
 */
const MOTTO_CLASSES = 'm-0 text-xs text-fg-muted md:ml-auto md:text-right';

export function PageGreeting({
  greeting,
  dateLabel,
  lead,
  motto,
  testIdPrefix,
  className,
}: PageGreetingProps) {
  return (
    <div
      data-testid={`${testIdPrefix}root`}
      className={cn('mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1', className)}
    >
      <div className="min-w-0">
        <p className={GREETING_CLASSES} data-testid={`${testIdPrefix}message`}>
          {greeting}
        </p>
        <p className={META_CLASSES} data-testid={`${testIdPrefix}date`}>
          {dateLabel}
        </p>
        {lead === null ? null : (
          <p className={META_CLASSES} data-testid={`${testIdPrefix}lead`}>
            {lead}
          </p>
        )}
      </div>
      {motto === null ? null : (
        <p className={MOTTO_CLASSES} data-testid={`${testIdPrefix}motto`}>
          {motto}
        </p>
      )}
    </div>
  );
}
