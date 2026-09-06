// apps/web/lib/skill-sheets/policy.ts
// 🔴 スキルシートの版に対して「何ができるか」を決める**唯一の**規則（`F-011 AC-1`〜`AC-3` /
//    `BR-26` / docs/04 §S-008）。T-05-06。
//
// ============================================================================
// 🔴 なぜ 1 ファイルに集めるのか
// ============================================================================
// `F-011 AC-1` は「`CLEAN` でないファイルについて、共有 URL の発行・提案への添付・チャットへの
// 添付のいずれもできない。**導線が存在しない**」を要求する。導線の有無（画面）と拒否（API）が
// 別々の条件式で書かれていると、片方だけが緩んだときに **「押せるのに拒否される」ボタン**か、
// 最悪の場合 **「押せてしまう」ボタン**が生まれる。したがって画面（`S-008`）と API
// （#19 / 版の切替 / 削除、そして T-05-07 の #20 / #21）は**同じ関数**を見る。
//
// 🔴 判定の中心（`isShareableScanStatus`）は `@ses/domain` にある。ここはそれを**再実装せず**、
//    業務上の操作（共有・最新版・削除）へ写すだけである。
import type { TenantRole } from '@ses/db';
import { isShareableScanStatus, type ScanStatus } from '@ses/domain';

/**
 * 🔴 スキルシートの版を**操作できる**ロール（`docs/02` `F-011` 関連ロール / `docs/04` §S-008 権限差分）。
 *
 * 🔴 **`#18`（署名の発行）/ `#19`（確定）/ `#19b`（版の切替）/ `#19c`（削除）の `requireRole` と、
 *    `S-008` の `canManage` が同じ定数を見る。** 片方だけ広い / 狭い状態を作らないため
 *    （`skills/policy.ts` の `SKILL_ALIAS_DECIDER_ROLES` と同じ規律）。
 * 🔴 `VIEWER` を含めない（`F-012 AC-3` / `BR-31`。閲覧はできるが実行はできない）。
 *    ⚠️ 画面側の判定は UI の配慮であり、拒否の本体はルートのガードと RLS である。
 */
export const SKILL_SHEET_MANAGER_ROLES = [
  'OWNER',
  'ADMIN',
  'SALES',
  'PARTNER_ADMIN',
  'PARTNER_SALES',
] as const satisfies readonly TenantRole[];

export function canManageSkillSheets(role: TenantRole): boolean {
  return (SKILL_SHEET_MANAGER_ROLES as readonly TenantRole[]).includes(role);
}

/**
 * 🔴 スキルシートを**ダウンロードできる**ロール（`F-012 AC-3` / `BR-31` / `docs/02` `F-012`
 *    関連ロール）。T-05-07。
 *
 * 🔴 **管理ロールと同じ定数を指す**（別に列挙しない）。現時点で両者は同じ集合であり、
 *    2 つ書くとロールが増減したときに片方だけ変わる。**分ける必要が生じたらここで枝分かれさせる**
 *    —— そのときも「画面の導線」と「`#20` の `requireRole`」は同じ定数を見続ける。
 * 🔴 `VIEWER` を含めない。`VIEWER` は閲覧（`#21` / 版一覧）はできるがダウンロードはできない。
 */
export const SKILL_SHEET_DOWNLOADER_ROLES = SKILL_SHEET_MANAGER_ROLES;

/**
 * 🔴 そのロールがダウンロードを実行できるか（`F-012 AC-3` / `BR-31`）。
 *
 * 🔴 **版の状態（`CLEAN` か）はここで見ない。** ダウンロードの可否は
 *    「ロール」×「版の状態」の AND だが、後者は `isSkillSheetShareable` が持っている ——
 *    2 つを 1 つの関数に畳むと、画面が「行ごとにロールを渡す」不自然な形になるか、
 *    さもなくば片方の条件だけを見る枝が生まれる。**画面も API も、同じ 2 つの述語の AND**
 *    として表現する（`canDownloadSkillSheet(role) && isSkillSheetShareable(scanStatus)`）。
 *    無効化したボタンは置かない（「押せるが拒否される」は `F-011 AC-1` が禁じる状態そのもの）。
 */
export function canDownloadSkillSheet(role: TenantRole): boolean {
  return (SKILL_SHEET_DOWNLOADER_ROLES as readonly TenantRole[]).includes(role);
}

/**
 * 🔴 共有してよい版か（`BR-26` / `F-011 AC-1`）。
 *
 * 🔴 **`CLEAN` だけが `true`。** `SCANNING`（検査中）も `UNSCANNABLE` / `FAILED`（判定不能）も
 *    `INFECTED`（感染）も等しく `false` である —— 「たぶん大丈夫」で通す分岐を作らない
 *    （docs/03 §3.4.3-3）。
 * 🔴 これは**画面に導線を描いてよいか**と**API が発行してよいか**の両方の根拠である。
 * 🔴 戻り値を**型述語**（`scanStatus is 'CLEAN'`）にしてある（`@ses/domain` の
 *    `isShareableScanStatus` と同じ）。これにより、画面の「共有できない側」の分岐では
 *    `scanStatus` が `Exclude<ScanStatus, 'CLEAN'>` に絞られ、**共有不可の理由の表を
 *    `CLEAN` 込みで持つ実装がコンパイルで落ちる**（「`CLEAN` の共有できない理由」という
 *    存在しない状態を、型のうえで作れなくする）。
 */
export function isSkillSheetShareable(scanStatus: ScanStatus): scanStatus is 'CLEAN' {
  return isShareableScanStatus(scanStatus);
}

/**
 * 🔴 最新版フラグを持てる版か（`F-011` 処理③「`CLEAN` になった版のみ最新版フラグを持てる」）。
 *
 * 🔴 共有可否と**同じ条件**である（別の関数にしているのは呼び出し側の意図を残すためだけで、
 *    条件を分岐させてはならない）。DB 側にも `skill_sheets_latest_clean_check`
 *    （`is_latest = false OR scan_status = 'CLEAN'`）があり、これは 2 段目の防御である。
 */
export function canBecomeLatestSkillSheet(scanStatus: ScanStatus): boolean {
  return isSkillSheetShareable(scanStatus);
}

/**
 * 🔴 検査が終わっているか（`F-011 AC-2`「スキャンが完了していないファイルは、状態が『検査中』と
 *    表示され、**共有操作が選択できない**」）。
 *
 * 🔴 `SCANNING` の版には**操作を 1 つも出さない**（docs/04 §S-008 の版一覧: 検査中の行の操作欄は
 *    「操作は選択できません」）。削除も含めて出さないのは、検査中のオブジェクトを消すと
 *    スキャン結果の適用が `SCAN_TARGET_NOT_FOUND` になり（docs/05 §9.6）、
 *    **本物の取りこぼしと区別できない雑音**が `A-005` に流れ込むためである。
 */
export function isScanSettled(scanStatus: ScanStatus): boolean {
  return scanStatus !== 'SCANNING';
}

/**
 * 🔴 自動読み取り（`F-032`。SP-14）に対応する形式か（docs/03 `ui-design` 申し送り 8）。
 *
 * 🔴 **アップロード自体は拒否しない。** 画像・画像 PDF も保管はできる（`schemas.ts` の
 *    `SKILL_SHEET_CONTENT_TYPES` に含む）。ここで区別するのは「読み取りに回せるか」だけであり、
 *    対応していないことを画面に**明示する**ためにある（黙って抽出されないと、利用者は
 *    「壊れている」と受け取る）。
 * ⚠️ PDF は「テキスト PDF か画像 PDF か」を content-type から判別できない。したがって
 *    `application/pdf` は**対応形式として扱い**、画面は「画像 PDF は手入力になる」ことを
 *    アップロード欄の注記で伝える（docs/04 §S-008 セクション 1）。
 */
export function supportsAutoExtraction(contentType: string): boolean {
  return !contentType.startsWith('image/');
}
