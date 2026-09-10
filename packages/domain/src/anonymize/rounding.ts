// packages/domain/src/anonymize/rounding.ts
// 🔴 匿名共有（`CLAUDE.md` §3.1 経路 4）でホストに見せる 5 項目の丸め。T-08-01。
//
// 🔴 なぜ `packages/domain` の純粋関数に閉じるか（`docs/03` §4.13 / `docs/05` §4.6 / TBD-2）:
//    ①DB・ネットワーク・**現在時刻**を持ち込まないので、**同じ入力に同じ出力を返すことを
//      テストで証明できる**（`CLAUDE.md` §2.1）。決定性が壊れると、同じ台帳の同じ人が
//      表示のたびに違う粒度で出ることになり、監査もテストもできない。
//    ②丸めが 1 箇所にあり、`F-009`（Phase 1 の検索）と `F-029`（Phase 2 のスコア表示）で
//      共通に使える。**丸めの実装を 2 つ作らない。**
//
// 🔴 粒度は **`docs/03` §4.13.1（= `docs/02` A-04）で確定した値**である（2026-09-10、
//    [Issue #5](https://github.com/Festal-KM/SES-Platform/issues/5) の回答。暫定値ではない）。
//    **実装判断で変えてはならない** —— 変えるときは `docs/03` §4.13.1 の改訂と再承認から始める
//    （`CLAUDE.md` §8.6 / §8.7）。粒度の**値**は `packages/config/src/anonymize.ts` が持ち、
//    本関数は引数で受け取る（`SEAT_SNAPSHOT_COUNTS_PARTNER_SEATS` と同じ整理。
//    `packages/domain` は `@ses/config` を import できない ——
//    `eslint.config.mjs` の `packages/domain` ゾーンが `forbidAllSes` を立てている）。
//
// 🔴 **開示する項目そのものを 5 から増やさない**（`BR-54` / `CLAUDE.md` §8.6 = 人間の承認事項）。
//    スキルの上位 8 件は「項目の追加」ではなく **1 項目内の粒度**である。
//
// 🔴 **k-匿名性による件数閾値はここに入れない**（`docs/02` A-04 / `docs/03` §4.13.2-4）。
//    母集団が小さい立ち上げ期にほとんどの候補が消え、経路 4 が使えない機能になるため。
//    一意率は運営平面の監視指標として出す（SP-11）。加えて、件数閾値は「母集団を数える」
//    ＝ I/O であり、そもそも本関数（純粋関数）の責務ではない。
//
// 🔴 **表示文字列（`1〜3 年` / `60〜70 万円`）をここに持たない**（`CLAUDE.md` §3.5）。
//    本関数が返すのは**区分**（判別可能なタグ）と**数値**だけであり、表示名は `packages/i18n` が
//    持ち、区分 → 文言キーの写像は `apps/web/lib/**/labels.ts` の
//    `Record<区分, MessageKey>`（＝ 割り当て漏れをコンパイラが強制する形）が引き受ける。
//    `PrefectureCode`（`../ledger/prefectures.ts`）と `RemoteMode` で確立済みの規律であり、
//    ここだけ日本語を持つと**同じ値の表示が 2 箇所に散る**。
//    ⚠️ `docs/05` §4.6 の `AnonymousCandidateView` は `yearsBand: '1年未満' | …` と日本語の
//    リテラルで書かれているが、**実装は既存の規律（コード + i18n）に合わせた**。
//    API 応答が日本語の表示文字列を返す実装は本リポジトリに 1 つも無い（`remoteMode` は
//    `'FULL_REMOTE'`、勤務地は都道府県コード `'13'` で返している）。

import type { PrefectureCode } from '../ledger/prefectures.js';

/**
 * 経験年数の 5 段階（`docs/02` A-04 ②）。
 * 表示名は `packages/i18n`（`1 年未満` / `1〜3 年` / `3〜5 年` / `5〜10 年` / `10 年以上`）。
 *
 * 🔴 **境界の値そのものは `AnonymizeRoundingConfig.yearsBandBoundaries` が持つ**。
 *    ここにあるのは「5 段階である」という構造だけであり、段階を増減させることは
 *    粒度の変更（＝ `docs/03` §4.13.1 の改訂事項）にあたる。
 * ⚠️ 識別子（`Y1_3` 等）は A-04 の境界に由来する名前である。**境界を変えるなら識別子と
 *    `packages/i18n` の表示名も同時に見直す** —— 設定値の差し替えだけでは完結しない
 *    （`rounding.test.ts` の「粒度は関数の外から差し替えられる」がこの性質を固定している）。
 */
export const ANONYMIZED_YEARS_BANDS = ['LT_1Y', 'Y1_3', 'Y3_5', 'Y5_10', 'GTE_10Y'] as const;

export type AnonymizedYearsBand = (typeof ANONYMIZED_YEARS_BANDS)[number];

/**
 * 稼働可能時期の 5 段階（`docs/02` A-04 ④）。
 * 表示名は `packages/i18n`（`即日` / `当月中` / `翌月` / `翌々月` / `3 か月以降`）。
 *
 * 🔴 **具体的な稼働開始日（`2026-09-16` 等）を出さない**（`F-017 AC-3`）。
 *    日付は「個人の事情」（前の現場がいつ切れるか）を露出する。
 */
export const ANONYMIZED_AVAILABILITY_BANDS = [
  'IMMEDIATE',
  'THIS_MONTH',
  'NEXT_MONTH',
  'MONTH_AFTER_NEXT',
  'THREE_MONTHS_OR_LATER',
] as const;

export type AnonymizedAvailabilityBand = (typeof ANONYMIZED_AVAILABILITY_BANDS)[number];

/**
 * リモート可否の 3 値（`docs/02` A-04 ⑤）。
 *
 * ⚠️ **`@ses/db` の `REMOTE_MODES` と二重宣言である。** `packages/domain` は `@ses/db` を
 *    import できず（`CLAUDE.md` §2.1）、`packages/db` 側は Prisma の CHECK と対応する
 *    値集合をそこに置いている。`tests/static/anonymize-rounding-mirror.test.ts` が
 *    **機械的に突合**する（`connector-selection-mirror.test.ts` と同じ扱い）。
 *    ⚠️ 申し送り: `ScanStatus` / `RecipientClass` と同様に宣言を domain へ移す整理は可能だが、
 *    `packages/db` の値集合の移設は本タスク（丸めの純粋関数）の射程外である。
 */
export const ANONYMIZED_REMOTE_MODES = ['FULL_REMOTE', 'PARTIAL_REMOTE', 'ONSITE_ONLY'] as const;

export type AnonymizedRemoteMode = (typeof ANONYMIZED_REMOTE_MODES)[number];

/**
 * 単価レンジの区分（`docs/02` A-04 ③）。**10 万円刻み**で、上限は `100 万円以上` で打ち止め。
 *
 * - `RANGE`: `fromManYen` 以上 `toManYen` 未満（表示例「60〜70 万円」）
 * - `OPEN`: `fromManYen` 以上（打ち止め。表示例「100 万円以上」）
 *
 * 🔴 単位は **万円**である（円ではない）。台帳の生の金額（`650000`）を応答に載せないため、
 *    刻みの単位まで粗くしたものだけを持つ。
 * 🔴 **確定単価を持たない**（`F-017 AC-4` / `BR-58`）。匿名の段階で単価の交渉をさせない。
 */
export type AnonymizedPriceBand =
  | { readonly kind: 'RANGE'; readonly fromManYen: number; readonly toManYen: number }
  | { readonly kind: 'OPEN'; readonly fromManYen: number };

/**
 * 丸めの粒度。🔴 **値の出所は `packages/config/src/anonymize.ts`（`ANONYMIZE_ROUNDING`）**であり、
 * 本パッケージは既定値を持たない（2 つの出所を作らない）。
 *
 * 🔴 `packages/domain` は `@ses/config` を import できないため、この型と config 側の
 *    オブジェクトは**二重宣言**である。突合は `tests/static/anonymize-rounding-mirror.test.ts`。
 */
export type AnonymizeRoundingConfig = {
  /** スキルの表示上限（A-04 ①。既定 8 件）。 */
  readonly maxSkills: number;
  /**
   * 経験年数の区分境界（A-04 ②。既定 `[1, 3, 5, 10]`）。**昇順で、5 段階に対応する 4 個**。
   * `y < b0` → `LT_1Y` / `b0 <= y < b1` → `Y1_3` / … / `b3 <= y` → `GTE_10Y`。
   */
  readonly yearsBandBoundaries: readonly [number, number, number, number];
  /** 単価の刻み（A-04 ③。既定 100,000 円 = 10 万円）。 */
  readonly priceBucketYen: number;
  /** 単価の打ち止め（A-04 ③。既定 1,000,000 円 = 100 万円以上）。 */
  readonly priceCapYen: number;
};

/**
 * 丸めの入力になるスキル 1 件。
 *
 * 🔴 **辞書（`Skill`）の行であることを型で要求する**（A-04 ①「辞書の正規化済み名称のみ。
 *    フリーテキスト不可」）。`skillId` / `sortKey` を持たない自由入力はここへ渡せない。
 */
export type AnonymizeSkillInput = {
  /** `Skill.id`。🔴 **出力には載せない**（並びの決定にのみ使う）。 */
  readonly skillId: string;
  /** `Skill.sortKey`（`docs/05` §3.4「匿名候補のスキル並び（同順の決定的タイブレーク）」）。 */
  readonly sortKey: number;
  /** `Skill.name`（辞書の正規化済み名称）。 */
  readonly name: string;
  /** `EngineerSkill.yearsOfExperience`。 */
  readonly yearsOfExperience: number;
};

/**
 * 丸めの入力。**台帳の生値**をそのまま受け取り、丸めた値だけを返す。
 *
 * 🔴 実名・生年月日・連絡先・所属会社名・社内 ID・営業メモ・スキルシートの**フィールドが
 *    そもそも存在しない**（`F-017 AC-1`。`undefined` ではなく型が違う）。
 *    渡せないものは漏らせない。
 */
export type AnonymizeEngineerInput = {
  /** 台帳に登録された**全**スキル（上位 8 件の選別は本関数が行う）。 */
  readonly skills: readonly AnonymizeSkillInput[];
  /** `Engineer.unitPriceMin`（円）。未設定は `null`。 */
  readonly unitPriceMinYen: number | null;
  /** `Engineer.unitPriceMax`（円）。未設定は `null`。 */
  readonly unitPriceMaxYen: number | null;
  /**
   * `Engineer.availableFrom`（`@db.Date`。`YYYY-MM-DD`）。未設定は `null`。
   * 🔴 `@db.Date` の列を `YYYY-MM-DD` にするのは `apps/web` の `toDateOnlyString` である
   *    （UTC 深夜として読み出される値であり、TZ 変換を掛けると 1 日ずれる）。
   */
  readonly availableFrom: string | null;
  /** `Engineer.prefecture`（JIS X 0401）。 */
  readonly prefecture: PrefectureCode | null;
  /**
   * `Engineer.city`。🔴 **受け取るが、出力には 1 文字も載せない**（A-04 ⑤ / `F-017 AC-3`）。
   *
   * 🔴 なぜ「受け取らない」ではなく「受け取って落とす」か: 市区町村を落とすのが**丸めの
   *    責務そのもの**であり、ここで落ちることをユニットテストで証明できる形にするため
   *    （`docs/05` §4.5 の `SharedCandidateDb`（`city` を `select` できない型）は**二重防御の
   *    もう 1 枚**であって、代わりではない）。沿線・駅名も同じ理由でこの列に入れない。
   */
  readonly city: string | null;
  /** `Engineer.remoteMode`。未設定は `null`。 */
  readonly remoteMode: AnonymizedRemoteMode | null;
  /**
   * 🔴 **JST の暦日に丸め済みの更新日**（`YYYY-MM-DD`。`docs/03` §4.13.2-2）。
   *
   * 🔴 丸めるのは `apps/web/lib/format/datetime.ts` の `toJstIsoDay` である（`docs/05` §6.4:
   *    「SP-08 の `AnonymousCandidateView.updatedOn` も**同じ関数**を使い、粒度と基準を揃える」
   *    —— 基準がずれると、同じエンジニアが自社台帳と匿名候補で違う更新日を持つ）。
   *    本関数は**時刻を含む値を受け取らない**ことを検査するだけで、暦の実装を 2 つ持たない。
   *    タイムスタンプ（`2026-09-08T00:15:00.000Z`）を渡すと `RangeError` になる。
   */
  readonly updatedOnJst: string;
};

/**
 * 丸めの基準。
 *
 * 🔴 **現在時刻を関数の中で取得しない**（`CLAUDE.md` §2.1 / `tests/static/domain-purity.test.ts`）。
 *    稼働可能時期の 5 段階は「今日」からの相対区分なので、基準日を引数で受け取る。
 */
export type AnonymizeContext = {
  /** JST の「今日」（`YYYY-MM-DD`）。呼び出し側は `toJstIsoDay(new Date())` で作る。 */
  readonly referenceDate: string;
};

/**
 * 丸め後の 5 項目（+ 並び替えのキーに使う更新日）。
 *
 * 🔴 **このオブジェクトのフィールドが、ホストに出せるものの全部である。**
 *    フィールドを増やすことは開示項目を増やすことに直結する（`BR-54` / `CLAUDE.md` §8.6 =
 *    人間の承認事項）。`rounding.test.ts` の「キーの網羅テスト」が、増えた瞬間に落ちる。
 *
 * ⚠️ `candidateRef`（案件スコープの参照子）はここに含まない —— HMAC 鍵と `projectId` を要し、
 *    T-08-04（`anonymize/reference.ts`）の責務である。**丸めと参照子を 1 つの関数にしない。**
 */
export type RoundedAnonymousAttributes = {
  /** 辞書の正規化済み名称。**最大 `maxSkills` 件**（経験年数の降順）。 */
  readonly skills: readonly { readonly name: string }[];
  /** 経験年数の区分。登録スキルが 0 件なら `null`（＝ 未設定）。 */
  readonly yearsBand: AnonymizedYearsBand | null;
  /** 単価の区分。単価が未設定なら `null`。 */
  readonly priceBand: AnonymizedPriceBand | null;
  /** 稼働可能時期の区分。未設定なら `null`。 */
  readonly availabilityBand: AnonymizedAvailabilityBand | null;
  /** 都道府県コードのみ（市区町村・沿線・駅名を含まない）。 */
  readonly prefecture: PrefectureCode | null;
  /** リモート可否 3 値。 */
  readonly remoteMode: AnonymizedRemoteMode | null;
  /** 日単位に丸めた更新日（`YYYY-MM-DD`）。 */
  readonly updatedOn: string;
};

/** 万円 ↔ 円。表示単位（万円）そのものであり、粒度の設定値ではない。 */
const YEN_PER_MAN_YEN = 10_000;

/** `YYYY-MM-DD`。🔴 時刻を含む値（`…T00:15:00Z`）はここで弾かれる。 */
const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

type CalendarDay = { readonly year: number; readonly month: number; readonly day: number };

/**
 * `YYYY-MM-DD` を年月日に分解する。
 * 🔴 `Date` を作らない（`packages/domain` は `new Date()` / `Date.*()` を禁じられている）。
 */
function parseDay(fieldName: string, value: string): CalendarDay {
  if (!DAY_PATTERN.test(value)) {
    // 🔴 受け取った値そのものを載せない。時刻付きの値を弾いた場合、
    //    メッセージがそのまま「その人がいつ更新されたか」をログに残すことになる。
    throw new RangeError(`${fieldName} は YYYY-MM-DD（日単位）である必要があります。`);
  }
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

function assertFiniteNonNegative(fieldName: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${fieldName} は 0 以上の有限の数値である必要があります。`);
  }
}

/**
 * 粒度の設定値そのものを検査する。
 *
 * 🔴 **黙って既定値に落とさない。** 誤った設定を受け入れると、丸めが意図より細かくなり
 *    （＝ 個人が特定されうる状態で）表示に出る。`CLAUDE.md` §7 の「0 件」に直結するため、
 *    ここは握り潰さずに落とす。
 */
function assertConfig(config: AnonymizeRoundingConfig): void {
  if (!Number.isInteger(config.maxSkills) || config.maxSkills < 1) {
    throw new RangeError('maxSkills は 1 以上の整数である必要があります。');
  }
  const boundaries = config.yearsBandBoundaries;
  for (const boundary of boundaries) {
    assertFiniteNonNegative('yearsBandBoundaries', boundary);
  }
  for (let i = 1; i < boundaries.length; i += 1) {
    if (boundaries[i] <= boundaries[i - 1]) {
      throw new RangeError('yearsBandBoundaries は昇順である必要があります。');
    }
  }
  if (!Number.isFinite(config.priceBucketYen) || config.priceBucketYen <= 0) {
    throw new RangeError('priceBucketYen は 0 より大きい必要があります。');
  }
  if (!Number.isFinite(config.priceCapYen) || config.priceCapYen <= 0) {
    throw new RangeError('priceCapYen は 0 より大きい必要があります。');
  }
  if (config.priceCapYen % config.priceBucketYen !== 0) {
    // 打ち止めが刻みの上に乗っていないと、「100 万円以上」の 1 つ下の区分が
    // 刻み幅と違う幅になり、区分の意味が説明できなくなる。
    throw new RangeError('priceCapYen は priceBucketYen の倍数である必要があります。');
  }
}

/**
 * 🔴 経験年数の集約は「**登録されたスキルの経験年数の最大値**」である
 * （2026-09-07 に T-06-04 で決着。`docs/04` `S-005` / `S-006` の注記。`F-009` の `yearsMin` の
 *  評価と同じ定義）。**ここで別の集約（平均・合計）を使うと、検索の当たり方と表示がずれる。**
 */
function aggregateYears(skills: readonly AnonymizeSkillInput[]): number | null {
  let max: number | null = null;
  for (const skill of skills) {
    assertFiniteNonNegative('yearsOfExperience', skill.yearsOfExperience);
    if (max === null || skill.yearsOfExperience > max) max = skill.yearsOfExperience;
  }
  return max;
}

function yearsBandOf(
  years: number | null,
  boundaries: readonly [number, number, number, number],
): AnonymizedYearsBand | null {
  if (years === null) return null;
  // 境界は「その年数**以上**」で 1 段上がる（7 年は `5 <= 7 < 10` なので `Y5_10`）。
  let index = 0;
  while (index < boundaries.length && years >= boundaries[index]) index += 1;
  return ANONYMIZED_YEARS_BANDS[index];
}

/**
 * 単価レンジを 10 万円刻みに丸める。
 *
 * 🔴 台帳は `[unitPriceMin, unitPriceMax]` のレンジを持つ（片側だけの登録もある）。
 *    下端は刻みの床、上端は「その刻みの次の目盛り」に丸める。65 万円ちょうどの 1 点なら
 *    `60〜70 万円`、60〜75 万円のレンジなら `60〜80 万円` になる。
 *    🔴 **上端を切り捨てない** —— 実際より安く見える帯を出すと、商談の前提を誤らせる。
 *
 * 🔴 打ち止め（既定 100 万円）を跨ぐレンジは `OPEN`（`… 万円以上`）にする。
 *    上端を 100 万円に丸め込んで `90〜100 万円` と出すと、**上限を偽ることになる**。
 */
function priceBandOf(
  minYen: number | null,
  maxYen: number | null,
  config: AnonymizeRoundingConfig,
): AnonymizedPriceBand | null {
  if (minYen !== null) assertFiniteNonNegative('unitPriceMinYen', minYen);
  if (maxYen !== null) assertFiniteNonNegative('unitPriceMaxYen', maxYen);
  if (minYen === null && maxYen === null) return null;

  // 片側だけの登録は、その 1 点として扱う。min > max の逆転した行（台帳に CHECK は無い）でも
  // 決定的に同じ帯を返すよう、大小を取り直す。
  const lowYen = Math.min(minYen ?? maxYen ?? 0, maxYen ?? minYen ?? 0);
  const highYen = Math.max(minYen ?? maxYen ?? 0, maxYen ?? minYen ?? 0);

  const bucket = config.priceBucketYen;
  const fromYen = Math.floor(lowYen / bucket) * bucket;
  const toYen = (Math.floor(highYen / bucket) + 1) * bucket;

  if (fromYen >= config.priceCapYen) {
    return { kind: 'OPEN', fromManYen: config.priceCapYen / YEN_PER_MAN_YEN };
  }
  if (toYen > config.priceCapYen) {
    return { kind: 'OPEN', fromManYen: fromYen / YEN_PER_MAN_YEN };
  }
  return { kind: 'RANGE', fromManYen: fromYen / YEN_PER_MAN_YEN, toManYen: toYen / YEN_PER_MAN_YEN };
}

/**
 * 稼働可能時期を 5 段階（月単位）に丸める。
 *
 * 🔴 基準日は引数（`context.referenceDate`）である。**同じ候補でも「いつ見たか」で区分が
 *    変わる**のは仕様であり、だからこそ基準日を外から与えて決定的にする。
 */
function availabilityBandOf(
  availableFrom: string | null,
  referenceDate: string,
): AnonymizedAvailabilityBand | null {
  const today = parseDay('referenceDate', referenceDate);
  if (availableFrom === null) return null;
  const from = parseDay('availableFrom', availableFrom);

  // 過去日・当日は「即日」。ISO の日付は辞書順比較で日付順になる。
  if (availableFrom <= referenceDate) return 'IMMEDIATE';

  const monthOffset = (from.year - today.year) * 12 + (from.month - today.month);
  if (monthOffset <= 0) return 'THIS_MONTH';
  if (monthOffset === 1) return 'NEXT_MONTH';
  if (monthOffset === 2) return 'MONTH_AFTER_NEXT';
  return 'THREE_MONTHS_OR_LATER';
}

/**
 * スキルを「経験年数の降順 → `sortKey` 昇順 → `skillId` 昇順」で並べ、上位 `maxSkills` 件に絞る。
 *
 * 🔴 **順序は全順序でなければならない。** 同点を安定ソートの実装任せにすると、入力の並び
 *    （＝ DB の返す順）が変わっただけで表示されるスキルが入れ替わる。`docs/02` A-04 ① は
 *    「同順は辞書 ID 順の決定的な順序」とし、`docs/05` §3.4 は `Skill.sortKey` を
 *    「匿名候補のスキル並び（同順の決定的タイブレーク）」と定めている ——
 *    **両方を、辞書の意図した並び（`sortKey`）が先に効く形で使う。**
 *
 * 🔴 **上限を設ける理由は再識別の防止である**（`docs/03` §4.13.1: スキルの組み合わせが
 *    事実上の指紋になる）。件数を「表示の都合」で緩めない。
 */
function topSkills(
  skills: readonly AnonymizeSkillInput[],
  maxSkills: number,
): readonly { readonly name: string }[] {
  return [...skills]
    .sort((a, b) => {
      if (a.yearsOfExperience !== b.yearsOfExperience) {
        return b.yearsOfExperience - a.yearsOfExperience;
      }
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return a.skillId < b.skillId ? -1 : a.skillId > b.skillId ? 1 : 0;
    })
    .slice(0, maxSkills)
    .map((skill) => ({ name: skill.name }));
}

/**
 * 🔴 匿名候補の 5 項目を丸める（純粋関数。`docs/05` §4.6 / `docs/03` §4.13 / `F-017 AC-3`）。
 *
 * 例（`F-017 AC-3`）: 経験年数 7 年 → `Y5_10`（`5〜10 年`）/ 単価 65 万円 →
 * `RANGE 60〜70`（`60〜70 万円`）/ 勤務地「東京都渋谷区」→ 都道府県コード `13`（`東京都`）のみ。
 * **`7 年` / `65 万円` / `渋谷区` / 具体的な稼働開始日は、返り値のどこにも現れない。**
 *
 * @throws RangeError 粒度の設定値、日付の粒度（時刻付き）、数値の範囲が不正なとき。
 *         🔴 **握り潰して既定値で続行しない**（細かすぎる値がそのまま外へ出るため）。
 */
export function anonymizeEngineer(
  input: AnonymizeEngineerInput,
  context: AnonymizeContext,
  config: AnonymizeRoundingConfig,
): RoundedAnonymousAttributes {
  assertConfig(config);

  // 🔴 時刻付きの値をここで弾く（`updatedOnJst` の粒度の担保。`docs/03` §4.13.2-2）。
  parseDay('updatedOnJst', input.updatedOnJst);
  // 🔴 値の検査（`aggregateYears` の中）を、並べ替えより先に済ませる。
  //    不正な年数のまま並べ替えると比較関数が NaN を返し、順序が実装依存になる。
  const years = aggregateYears(input.skills);

  return {
    skills: topSkills(input.skills, config.maxSkills),
    yearsBand: yearsBandOf(years, config.yearsBandBoundaries),
    priceBand: priceBandOf(input.unitPriceMinYen, input.unitPriceMaxYen, config),
    availabilityBand: availabilityBandOf(input.availableFrom, context.referenceDate),
    prefecture: input.prefecture,
    remoteMode: input.remoteMode,
    updatedOn: input.updatedOnJst,
  };
}
