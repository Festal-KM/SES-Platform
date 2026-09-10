// packages/config/src/anonymize.ts
// 🔴 匿名共有（`CLAUDE.md` §3.1 経路 4）の丸めの粒度。T-08-01（`docs/05` TBD-2 /
//    `docs/sprints/SP-08-anonymous-share.md` §3）。
//
// 🔴 **値はここが唯一の出所**であり、丸めの**手続き**は `packages/domain` の
//    `anonymizeEngineer`（`src/anonymize/rounding.ts`）が持つ。関数は粒度を引数で受け取るので、
//    値を変えるのに丸め関数を書き換えなくてよい（`SEAT_SNAPSHOT_COUNTS_PARTNER_SEATS` と
//    同じ整理）。`packages/domain` は `@ses/config` を import できない（`CLAUDE.md` §2.1 /
//    `eslint.config.mjs` の `packages/domain` ゾーンの `forbidAllSes`）ため、**注入**にする。
//
// 🔴 ここに置くのは「環境によって変わらない方針値」である（`limits.ts` と同じ規律）。
//    環境変数で与えるものは `schema.ts`（Zod 検証つき）に置く。両方に同じ名前の値を作らない。
//    🔴 **環境ごとに粒度を変えられる形にしない** —— `development` / `demo` だけ細かく出せる
//    経路を作ると、その経路が本番に紛れ込んだときに再識別が起きる（`CLAUDE.md` §7 の「0 件」）。
//
// 🔴 **これは確定値である**（2026-09-10、[Issue #5](https://github.com/Festal-KM/SES-Platform/issues/5)
//    の回答「OK です」。`docs/03` §4.13.1 = `docs/02` A-04 = `docs/04` U-06）。**暫定ではない。**
//    変更は `docs/03` §4.13.1 の改訂と再承認を要する（`CLAUDE.md` §8.6 / §8.7）。
//    🔴 **開示する項目そのものを 5 から増やすことは人間の承認事項**であり、その判断は
//    ここ（値）ではなく `RoundedAnonymousAttributes`（型）の変更として現れる。

/**
 * 🔴 匿名候補（`F-017`）の丸めの粒度。`@ses/domain` の `AnonymizeRoundingConfig` に渡す。
 *
 * ⚠️ `packages/config` は `@ses/domain` に依存しない（`limits.ts` 同様、方針値だけを持つ）ため、
 *    この形が `AnonymizeRoundingConfig` と一致していることは
 *    `tests/static/anonymize-rounding-mirror.test.ts` が機械的に突合する
 *    （`connector-selection-mirror.test.ts` と同じ扱い）。呼び出し側では構造的部分型として
 *    そのまま渡せる。
 */
export const ANONYMIZE_ROUNDING = {
  /**
   * スキルの表示上限（`docs/02` A-04 ①）。
   * 🔴 上限を設ける理由は**スキルの組み合わせが事実上の指紋になる**ため（`docs/03` §4.13.1）。
   *    「もう少し見せたい」という表示上の要望で緩めない。
   */
  maxSkills: 8,
  /**
   * 経験年数の区分境界（`docs/02` A-04 ②）。5 段階
   * （`1 年未満` / `1〜3 年` / `3〜5 年` / `5〜10 年` / `10 年以上`）に対応する 4 個・昇順。
   * 🔴 「7 年 3 か月」のような値は個人をほぼ一意にする（`docs/03` §4.13.1）。
   */
  yearsBandBoundaries: [1, 3, 5, 10],
  /**
   * 単価の刻み（`docs/02` A-04 ③。10 万円）。
   * 🔴 10 万円まで粗くしたのは、**単価と稼働可能時期の組み合わせが個人を最も強く特定する**
   *    ため（`docs/03` §4.13.1）。
   */
  priceBucketYen: 100_000,
  /** 単価の打ち止め（`docs/02` A-04 ③。これ以上は `100 万円以上` の 1 区分にまとめる）。 */
  priceCapYen: 1_000_000,
} as const;
