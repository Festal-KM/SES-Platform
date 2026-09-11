// apps/web/lib/anonymize/candidate-view.ts
// 🔴 匿名候補の応答型 `AnonymousCandidateView` と、その**唯一の組み立て経路**。T-08-04。
//    `docs/05` §4.6（改訂 10）/ `docs/02` `F-017 AC-1`〜`AC-3` / `AC-7` / `BR-54` / `BR-55`。
//
// ---------------------------------------------------------------------------
// 🔴 この型に無いものは、ホストに出ない
// ---------------------------------------------------------------------------
// 実名・所属会社名（＝ 共有元パートナー）・社内 ID・営業メモ・スキルシート・詳細な経歴の並びの
// フィールドは **`undefined` ではなく型として存在しない**（`F-017 AC-1` / `F-008 AC-7`）。
// 加えて **`engineerId` / `skillId` / `sortKey` / `MatchCandidate.id` / 生の `updated_at`** も
// 持たない —— これらは「案件をまたいで同一人物を突き合わせられる値」であり、`F-017 AC-2` /
// `BR-55` が名指しで禁じている。
//
// 🔴 **型だけでは足りない**（T-08-03 のレビューで実 DB の漏洩が再現された教訓）。
//    ここでは 3 枚で閉じている:
//      ①**型**       … 下記 `AnonymousCandidateView`（`@ts-expect-error` の型テストが固定）
//      ②**組み立て** … `buildAnonymousCandidateViews` が**フィールドを 1 つずつ明示的に写す**。
//                       🔴 スプレッド（`...rounded`）を使わない —— 使うと、上流の
//                       `RoundedAnonymousAttributes` にフィールドが増えた瞬間に**このファイルを
//                       触らずに**開示項目が増える（開示項目の追加は人間の承認事項。
//                       `CLAUDE.md` §8.6）
//      ③**実測**     … `tests/isolation/anonymous-candidate-view.test.ts` が実 DB の応答を
//                       深さ 6 で走査し、禁止値が 1 つも現れないことを対照付きで固定する
//
// ---------------------------------------------------------------------------
// 🔴 `F-017 AC-2` で「防ぐもの」と「Phase 1 の残存リスク」（`docs/05` §4.6 の線引き表）
// ---------------------------------------------------------------------------
//   防ぐ  … ①内部 ID（`engineerId` / `skillId` / `MatchCandidate.id` / 共有元 ID）
//           ②案件をまたいで安定なハッシュ（参照子は `project_id` を鍵付き入力に含む）
//           ③並び順から復元できる連番・順位（`index` / `rank` / `score` を作らない。
//             並びのタイブレークも `candidateRef` にする = 案件ごとに変わる）
//           ④丸めていない更新日時（`updatedOn` は JST 暦日のみ）
//           ⑤スキルの辞書 ID / `sortKey`（出すのは `name` だけ）
//   残る  … ⑥**丸め後 5 項目の組み合わせそのもの**（属性の指紋）。🔴 k-匿名性の件数閾値は
//           Phase 1 では入れない（2026-09-10 に人間が決定。Issue #5。母集団が小さい立ち上げ期に
//           ほとんどの候補が消え、経路 4 が機能しなくなる）。一意率は運営平面の監視指標
//           （`docs/03` §4.13.2-4 / SP-11 `F-059`）
//           ⑦候補の出現・消滅のタイミング（共有の開始・停止）。解除の即時反映（`F-016 AC-2`）と
//           両立しないため受け入れる
//   🔴 ⑥⑦を「防いだことにしない」。扱いを変えるには `docs/03` §4.13.1 の改訂と再承認が要る。
//
// ⚠️ **T-08-05（`S-016` / `S-005`）への申し送り**: 本モジュールは `../format/db-values` 経由で
//    `@ses/db` を**値として**引き込む（サーバ専用）。`'use client'` のコンポーネントからは
//    **型だけを** import すること（`import type { AnonymousCandidateView }`）。値
//    （`ANONYMOUS_CANDIDATE_VIEW_KEYS` / `compareAnonymousCandidateViews`）をクライアントから
//    読むと `tests/static/client-db-boundary.test.ts` が落ちる —— そのときは表示側の関数を
//    `labels.ts`（`@ses/db` に依存しない）へ置くのが正しい直し方である。
import { ANONYMIZE_ROUNDING } from '@ses/config';
import type { SharedCandidateSource } from '@ses/db';
import {
  anonymizeEngineer,
  isPrefectureCode,
  ANONYMIZED_REMOTE_MODES,
  type AnonymizedAvailabilityBand,
  type AnonymizedPriceBand,
  type AnonymizedRemoteMode,
  type AnonymizedYearsBand,
  type AnonymizeSkillInput,
  type PrefectureCode,
} from '@ses/domain';
import { toJstIsoDay } from '../format/datetime';
import { decimalToNumber, toDateOnlyString } from '../format/db-values';
import { CANDIDATE_REF_PATTERN, type CandidateReference } from './reference';

/**
 * 🔴 ホストに返す匿名候補 1 件（`docs/05` §4.6）。**5 項目 + 参照子 + 丸めた更新日**が全部である。
 *
 * 🔴 **Phase 1 では `score` / `rationale` を型に持たない**（`F-017 AC-7`「Phase 1 の匿名候補に
 *    スコア・順位・重みの表示が存在しない」）。Phase 2（`F-029` / `F-031`）で足す。
 *    「後で使うから今から任意フィールドで置いておく」をしない —— 任意フィールドがあると、
 *    埋める実装が Phase 1 に紛れ込んでも型では落ちない。
 *
 * 🔴 **`index` / `rank` / `position` を作らない。** 並び順から復元できる連番は、
 *    案件をまたいだ突合の材料になる（`F-017 AC-2`）。
 */
export type AnonymousCandidateView = {
  /** 案件スコープの参照子（`reference.ts`）。🔴 案件が違えば別の値になる（`BR-55`）。 */
  readonly candidateRef: string;
  /** 辞書の正規化済み名称。最大 8 件（`ANONYMIZE_ROUNDING.maxSkills`）。🔴 `skillId` は持たない。 */
  readonly skills: readonly { readonly name: string }[];
  readonly yearsBand: AnonymizedYearsBand | null;
  readonly priceBand: AnonymizedPriceBand | null;
  readonly availabilityBand: AnonymizedAvailabilityBand | null;
  /** 都道府県コードのみ（市区町村・沿線・駅名を含まない）。 */
  readonly prefecture: PrefectureCode | null;
  readonly remoteMode: AnonymizedRemoteMode | null;
  /** 🔴 JST 暦日に丸めた更新日（`YYYY-MM-DD`）。生のタイムスタンプは持たない。 */
  readonly updatedOn: string;
};

/**
 * 🔴 `AnonymousCandidateView` のキーの網羅宣言。
 *
 * この `Record` は**型にフィールドを足したらここも足さないとコンパイルが通らない**形であり、
 * 逆に**ここに無いキーは型に無い**。`ANONYMOUS_CANDIDATE_VIEW_KEYS` はこれを唯一の出所とし、
 * 型テストと実 DB テストの両方が「キーはこの 8 個ちょうど」を固定する
 * （`SharedCandidateDb` のキー集合を固定したのと同じ発想。`docs/05` §4.5）。
 */
const VIEW_KEY_PRESENCE: Readonly<Record<keyof AnonymousCandidateView, true>> = {
  availabilityBand: true,
  candidateRef: true,
  prefecture: true,
  priceBand: true,
  remoteMode: true,
  skills: true,
  updatedOn: true,
  yearsBand: true,
};

/** 応答に現れてよいキーの全部（昇順）。🔴 増やすことは開示項目を増やすことに等しい。 */
export const ANONYMOUS_CANDIDATE_VIEW_KEYS: readonly (keyof AnonymousCandidateView)[] =
  Object.keys(VIEW_KEY_PRESENCE).sort() as (keyof AnonymousCandidateView)[];

/** `buildAnonymousCandidateViews` の入力。🔴 分離キーは受け取らない（呼び出し側の ctx が持つ）。 */
export type AnonymousCandidateViewInput = {
  /** 候補を出す対象の案件。🔴 参照子の案件スコープはこれで決まる。 */
  readonly projectId: string;
  /** 共有スコープ（`withSharedCandidateScope`）が返した素データ。 */
  readonly rows: readonly SharedCandidateSource[];
  /**
   * 丸めの基準日（JST の `YYYY-MM-DD`）。
   * 🔴 `packages/domain` に現在時刻を持ち込まないための注入（`docs/05` §4.6.1）。
   *    呼び出し側は `toJstIsoDay(new Date())` で作る。
   */
  readonly referenceDate: string;
  /** 起動時に鍵を閉じ込めた参照子の生成関数（`bootstrap.ts` の `candidateReference()`）。 */
  readonly candidateRef: CandidateReference;
};

/** 組み立ての不変条件違反。🔴 `engineerId` を message に載せない。 */
export class AnonymousCandidateViewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnonymousCandidateViewError';
  }
}

/**
 * 🔴 匿名候補の並び（`docs/03` §4.13.2-2）:
 * **`updatedOn`（JST 暦日）の降順 → 同日内は `candidateRef` の昇順**。
 *
 * 🔴 **`engineerId` や `updated_at` の生値でタイブレークしない。** それらは案件が変わっても
 *    同じなので、**同じ候補集合が複数の案件に現れたときに相対順序が一致**してしまい、
 *    参照子を案件スコープにした意味が消える（`F-017 AC-2`）。`candidateRef` は案件ごとに
 *    異なるため、同日内の順序も案件ごとに変わる。
 * 🔴 `updatedOn` は `YYYY-MM-DD` なので**辞書順 = 日付順**である（`Date` を作らない）。
 * ⚠️ **全順序である**こと（同日・同参照子は同一候補のみ）を保ったまま安定ソートに頼らない。
 */
export function compareAnonymousCandidateViews(
  a: AnonymousCandidateView,
  b: AnonymousCandidateView,
): number {
  if (a.updatedOn !== b.updatedOn) return a.updatedOn < b.updatedOn ? 1 : -1;
  if (a.candidateRef !== b.candidateRef) return a.candidateRef < b.candidateRef ? -1 : 1;
  return 0;
}

function toSkillInputs(row: SharedCandidateSource): readonly AnonymizeSkillInput[] {
  return row.skills.map((skill) => ({
    skillId: skill.skillId,
    sortKey: skill.sortKey,
    name: skill.name,
    // `EngineerSkill.yearsOfExperience` は `Decimal(4,1)`（`engineer-shares/service.ts` と同形）。
    yearsOfExperience: Number(skill.yearsOfExperience.toString()),
  }));
}

/**
 * 🔴 都道府県は**既知のコードだけ**を通す（`F-017 AC-3`）。
 *
 * 未知の値を素通しすると、列に想定外の文字列（例「東京都渋谷区」）が入っていた場合に
 * **丸めを経ずにそのまま応答へ出る**。`null`（未設定）に倒すのが fail-closed である。
 */
function toPrefecture(value: string | null): PrefectureCode | null {
  if (value === null) return null;
  return isPrefectureCode(value) ? value : null;
}

/** 🔴 リモート可否も同じく既知の 3 値だけを通す（理由は `toPrefecture` と同じ）。 */
function toRemoteMode(value: string | null): AnonymizedRemoteMode | null {
  if (value === null) return null;
  return (ANONYMIZED_REMOTE_MODES as readonly string[]).includes(value)
    ? (value as AnonymizedRemoteMode)
    : null;
}

/**
 * 🔴 匿名候補の応答を組み立てる**唯一の経路**（`docs/05` §4.6）。
 *
 * 手順は 3 つだけである:
 *   ① `anonymizeEngineer`（`packages/domain`。丸めの唯一の実装）で 5 項目を丸める
 *   ② `candidateRef(projectId, engineerId)` で案件スコープの参照子を作る
 *   ③ **フィールドを 1 つずつ明示的に写して** `AnonymousCandidateView` にする
 *
 * 🔴 ③でスプレッドを使わないのは、上流の `RoundedAnonymousAttributes` にフィールドが増えたとき
 *    **このファイルを触らずに開示が増える**ことを防ぐためである（`CLAUDE.md` §8.6）。
 * 🔴 `engineerId` は**②の入力にしか使わない**。返り値のどこにも入らない。
 * 🔴 `city`（市区町村）は `SharedCandidateSource` に**そもそも無い**（`docs/05` §4.5）ので、
 *    丸めの入力には `null` を渡す。
 *
 * @throws AnonymousCandidateViewError 参照子が想定の表記（base64url 22 文字）でないとき。
 *         🔴 これは「`engineerId` をそのまま参照子として載せる」実装ミスをその場で落とすための
 *         入口検査である（UUID は 36 文字なのでパターンに一致しない）。**握り潰さない。**
 */
export function buildAnonymousCandidateViews(
  input: AnonymousCandidateViewInput,
): readonly AnonymousCandidateView[] {
  const views = input.rows.map((row) => {
    const rounded = anonymizeEngineer(
      {
        skills: toSkillInputs(row),
        unitPriceMinYen: decimalToNumber(row.unitPriceMin),
        unitPriceMaxYen: decimalToNumber(row.unitPriceMax),
        // 🔴 `available_from` は `@db.Date`（時刻を持たない）。TZ 変換を掛けると 1 日ずれる。
        availableFrom: toDateOnlyString(row.availableFrom),
        prefecture: toPrefecture(row.prefecture),
        // 🔴 共有スコープは市区町村を読まない（二重防御の 1 枚目）。ここは常に `null` である。
        city: null,
        remoteMode: toRemoteMode(row.remoteMode),
        // 🔴 `updated_at` は `timestamptz`。**JST の暦日**に丸める（`docs/05` §4.6.3 の申し送り:
        //    必ず `toJstIsoDay` を通すこと。`toISOString().slice(0, 10)` は JST 0:00〜8:59 の
        //    更新を前日にしてしまい、同じ人が自社台帳と匿名候補で違う更新日を持つ）。
        updatedOnJst: toJstIsoDay(row.updatedAt),
      },
      { referenceDate: input.referenceDate },
      ANONYMIZE_ROUNDING,
    );

    const candidateRef = input.candidateRef(input.projectId, row.engineerId);
    if (!CANDIDATE_REF_PATTERN.test(candidateRef)) {
      // 🔴 値そのものを載せない（`engineerId` が渡っていた場合、message に出れば漏洩になる）。
      throw new AnonymousCandidateViewError(
        '参照子が想定の表記（base64url 22 文字）ではありません（docs/05 §4.6）。',
      );
    }

    // 🔴 明示的な写し取り。ここに無いフィールドは応答に出ない。
    const view: AnonymousCandidateView = {
      candidateRef,
      skills: rounded.skills.map((skill) => ({ name: skill.name })),
      yearsBand: rounded.yearsBand,
      priceBand: rounded.priceBand,
      availabilityBand: rounded.availabilityBand,
      prefecture: rounded.prefecture,
      remoteMode: rounded.remoteMode,
      updatedOn: rounded.updatedOn,
    };
    return view;
  });

  // 🔴 入力（`listSharedEngineers` の `updated_at DESC, id DESC`）の並びを**持ち越さない**。
  //    持ち越すと `engineer_id` によるタイブレークが応答の順序として残り、案件をまたいだ
  //    相対順序の一致から突合できてしまう（`F-017 AC-2`）。
  return [...views].sort(compareAnonymousCandidateViews);
}
