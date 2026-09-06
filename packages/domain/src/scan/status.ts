// packages/domain/src/scan/status.ts
// 🔴 ウイルススキャン状態の値集合と**遷移規則**（docs/05 §3.4 / §8.1 / §8.5 / §9.6 /
//    docs/03 §3.4.3-2・3 / `BR-26` / `F-011 AC-1`）。T-05-05。
//
// ============================================================================
// 🔴 なぜ `packages/domain` に置くのか
// ============================================================================
// `ScanStatus` は 3 者が同じ値集合を知る必要がある:
//   ① `packages/connectors` … GuardDuty の生ステータスを正規化した結果として返す
//   ② `packages/db`         … `skill_sheets.scan_status` / `file_scan_results.status` の CHECK
//   ③ `apps/worker`         … 受信結果を適用するジョブ
// ①と②は相互に依存できない（`CLAUDE.md` §2.1）ため、共有点は `packages/domain` しか無い
// （`RecipientClass` を T-04-02 で domain に一本化したのと同じ整理である）。
//
// ============================================================================
// 🔴 遷移規則を「重篤度の単調増加」として表す理由
// ============================================================================
// スキャン結果の配信は **at-least-once であり、重複と順序逆転が起こる**（docs/03 §3.4.3-2）。
// `docs/05` §8.5 は「`THREATS_FOUND` の後に `NO_THREATS_FOUND` が来ても `CLEAN` に戻さない」を
// 要求するが、これを「特定の 1 組み合わせの禁止」として実装すると、
// `FAILED → CLEAN` や `UNSCANNABLE → CLEAN` のような**同じ性質の抜け道**が残る。
//
// 代わりに全状態に**重篤度**の全順序を与え、**重篤度が上がる方向にしか遷移しない**とする。
// これにより
//   ① `INFECTED` / `FAILED` / `UNSCANNABLE` から `CLEAN` へ戻る経路が 1 本も存在しない
//   ② 何度適用しても結果が変わらない（**冪等**）
//   ③ **到着順に依存しない**（最終状態は受け取った結果の最大重篤度であり、順序逆転しても同じ）
// が同時に成り立つ。②③は「重複配信・順序逆転を扱えるように設計せよ」という
// GuardDuty の要求（docs/03 §3.4.1）に対する答えそのものである。

/**
 * docs/05 §3.4 `ScanStatus`（TEXT + CHECK）。
 * `skill_sheets.scan_status` / `file_scan_results.status` / `messages.attachment_scan_status` /
 * `contract_documents.scan_status` / `contract_templates.scan_status` が共有する。
 */
export const SCAN_STATUSES = ['SCANNING', 'CLEAN', 'INFECTED', 'UNSCANNABLE', 'FAILED'] as const;

export type ScanStatus = (typeof SCAN_STATUSES)[number];

/**
 * 🔴 重篤度（小さいほど「まだ何も分かっていない / 共有してよい」）。
 *
 * - `SCANNING`(0) … 未確定。**最も低い**（確定した結果で必ず上書きされる）
 * - `CLEAN`(1) … 唯一の共有可（`BR-26`）
 * - `UNSCANNABLE`(2) … GuardDuty の `UNSUPPORTED`。判定不能であり共有不可
 * - `FAILED`(3) … `ACCESS_DENIED` / `FAILED`。障害であり共有不可
 * - `INFECTED`(4) … `THREATS_FOUND`。**最も強い**。いかなる後続結果でも降格しない
 *
 * 🔴 `CLEAN` を 0 にしない（`SCANNING` より上に置く）。0 にすると「まだ検査していない」と
 *    「検査して安全だった」が同じ重みになり、`CLEAN → SCANNING` の巻き戻しが起こりうる。
 */
const SCAN_STATUS_SEVERITY: Readonly<Record<ScanStatus, number>> = {
  SCANNING: 0,
  CLEAN: 1,
  UNSCANNABLE: 2,
  FAILED: 3,
  INFECTED: 4,
};

export function isScanStatus(value: string): value is ScanStatus {
  return (SCAN_STATUSES as readonly string[]).includes(value);
}

/**
 * 🔴 共有してよい状態か（`BR-26` / `F-011 AC-1`）。
 *
 * **`CLEAN` だけが `true`**。`UNSCANNABLE` / `FAILED` を「たぶん大丈夫」として通さない
 * （docs/03 §3.4.3-3「判定不能はすべて共有不可」）。ダウンロード URL の発行（T-05-07）・
 * 提案添付（SP-09）・チャット添付（SP-13）はいずれもこの 1 関数を通す。
 */
export function isShareableScanStatus(status: ScanStatus): status is 'CLEAN' {
  return status === 'CLEAN';
}

/**
 * 🔴 検査が確定しており、かつ共有できない状態（＝ **隔離**）か。T-05-08（`F-011` 処理④）。
 *
 * `INFECTED`（感染）/ `FAILED`（検査失敗）/ `UNSCANNABLE`（検査不能）の 3 つが該当する。
 *
 * 🔴 **3 値を列挙しない。** 「確定している（`SCANNING` でない）かつ共有できない
 *    （`isShareableScanStatus` が偽）」から導く —— 状態が増えたときに列挙を書き足し忘れると、
 *    **隔離されたのに誰にも周知されないファイル**が生まれる（`F-011` 処理④ / `AC-3`）。
 * 🔴 `SCANNING` を含めない。検査中は「まだ何も分かっていない」であって隔離ではなく、
 *    周知すると利用者は毎回のアップロードで警告を受け取ることになる（`F-011 AC-2` は
 *    検査中を「検査中」と表示せよと定めており、失敗として扱えとは言っていない）。
 */
export function isQuarantinedScanStatus(status: ScanStatus): status is QuarantinedScanStatus {
  return status !== 'SCANNING' && !isShareableScanStatus(status);
}

/** 隔離にあたる状態（`INFECTED` / `UNSCANNABLE` / `FAILED`）。 */
export type QuarantinedScanStatus = Exclude<ScanStatus, 'SCANNING' | 'CLEAN'>;

/**
 * 🔴 隔離状態の値集合（DB の `where` / 画面の文言表が使う）。
 *
 * 🔴 **`isQuarantinedScanStatus` から導く**（別の配列として列挙しない）。列挙を 2 つ持つと、
 *    状態が増えたときに片方だけが古くなり、**隔離なのに一覧にも周知にも出ない版**が生まれる。
 */
export const QUARANTINED_SCAN_STATUSES: readonly QuarantinedScanStatus[] =
  SCAN_STATUSES.filter(isQuarantinedScanStatus);

/**
 * 🔴 `incoming` で置き換えてよい `current` の集合（重篤度が `incoming` 未満のもの）。
 *
 * DB 側の CAS（`UPDATE ... WHERE scan_status = ANY($replaceable)`）の述語として使う。
 * **判断はこの純粋関数だけが持ち、SQL には「置き換えてよい値の一覧」しか渡さない** ——
 * SQL に重篤度表を書き写すと 2 実装になり、片方だけが更新される。
 *
 * 🔴 `SCANNING` を `incoming` にできない（空配列ではなく例外）。「確定した結果を未確定へ戻す」
 *    のは遷移ではなく破壊であり、呼び出し側の誤りとして落とす。
 */
export function scanStatusesReplaceableBy(incoming: ScanStatus): readonly ScanStatus[] {
  if (incoming === 'SCANNING') {
    throw new InvalidScanStatusTransitionError(incoming);
  }
  const threshold = SCAN_STATUS_SEVERITY[incoming];
  return SCAN_STATUSES.filter((status) => SCAN_STATUS_SEVERITY[status] < threshold);
}

/** 🔴 `SCANNING` を適用結果として渡そうとした（確定 → 未確定の巻き戻し）。 */
export class InvalidScanStatusTransitionError extends Error {
  constructor(incoming: ScanStatus) {
    super(
      `スキャン結果として '${incoming}' は適用できません（確定した状態を未確定へ戻せません。docs/05 §8.5）。`,
    );
    this.name = 'InvalidScanStatusTransitionError';
  }
}

/**
 * 🔴 遷移の可否（docs/05 §8.5 / §9.6）。
 *
 * `'APPLY'` … `current` を `incoming` で置き換える
 * `'KEEP'`  … 何もしない（**重複配信・順序逆転の正常系**。エラーではない）
 */
export function decideScanStatusTransition(input: {
  readonly current: ScanStatus;
  readonly incoming: ScanStatus;
}): 'APPLY' | 'KEEP' {
  return scanStatusesReplaceableBy(input.incoming).includes(input.current) ? 'APPLY' : 'KEEP';
}
