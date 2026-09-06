// packages/db/src/scan-notice.ts
// 🔴 スキャン失敗・隔離の**周知先**の引き当て（`docs/02` `F-011` 処理④ / docs/05 §8.5 / §9.6）。
//    T-05-08。
//
// ============================================================================
// 🔴 このファイルが答えるのは 2 つだけである
// ============================================================================
//   ① その隔離されたファイルは**どちら側の所有か**（ホスト = 分類 1 / パートナー = 分類 2）
//   ② その所有側の**担当者は誰か**（所有側の管理ロールのみ。アップロードした本人の担保はアプリ内表示 — docs/02 F-011 処理④ / docs/05 §9.6.1）
//
// ①を取り違えると `sandbox` で取引先の担当者へ実メールが飛ぶ（`CLAUDE.md` §11.1 の最悪の事故）。
// ②を空にすると「隔離されたのに誰にも届かない」（`F-011` 処理④ / `AC-3`）。
//
// ============================================================================
// 🔴 分類は自己申告させない（docs/05 §8.2）
// ============================================================================
// 所有側が分かっていても、`recipientClass` を**ここで組み立てない**。宛先 1 人ごとに
// `resolveRecipientClass`（`Membership` から機械的に導く唯一の関数）へ通す。
// 「所有側 = パートナーだから分類 2」と書き下すと、判定が 2 実装になり、片方だけが古くなる。
//
// ============================================================================
// 🔴 なぜ `app_scan_quarantine_target` を経由するのか
// ============================================================================
// `skill_sheets` は C3 OWNER_SCOPED であり、ジョブのホスト文脈（`systemTenantCtx`）からは
// **パートナー所属エンジニアの行が 1 行も見えない**（docs/05 §4.4）。所有側を引けなければ
// 「パートナーが上げたファイルの隔離だけ誰にも周知されない」ことになる。
// migration 20260910000000 の判断事項に詳細を書いた（`file-scan.ts` と同型の問題であり、
// 同型の解 —— 既存の `app_scan_probe` に**列を 1 つだけ**足す —— を採っている）。
//
// 🔴 生 SQL を使うのはこの 1 つの関数呼び出しだけであり、テナントキーの述語は関数の中で
//    `app_tenant_id()` として課される（`file-scan.ts` / `storage-usage.ts` と同じ規律）。

import { Prisma } from '@prisma/client';
import { isScanStatus, type ScanStatus } from '@ses/domain';
import type { SystemTenantCtx, TenantRole } from './context.js';
import { resolveRecipientClass } from './recipient.js';
import { runInTenantTransaction } from './with-tenant.js';

/**
 * 🔴 周知メールを受け取る**所有側の管理ロール**（`docs/02` `F-011` 処理④ の「担当者」）。
 *
 * - ホスト所有 … `OWNER` / `ADMIN`（テナントの管理者）
 * - パートナー所有 … `PARTNER_ADMIN`（その取引先の管理者）
 *
 * 🔴 `SALES` / `PARTNER_SALES` / `VIEWER` を含めない。ホストの `SALES` は 1 テナントに
 *    3〜30 名おり（`CLAUDE.md` §1.2）、他人が上げたファイルの隔離を全員に配ると通知そのものが
 *    読まれなくなる（周知の実効性が落ちる）。
 * 🔴 **`uploaded_by`（上げた本人）を宛先に加えていない。** 加えるには
 *    `app_scan_probe` に `skill_sheets.uploaded_by` を GRANT する必要があるが、
 *    migration 20260908000000 は「スキャン以外の情報を越境させない」ため列を絞っており、
 *    `uploaded_by` はその**明示的な除外対象**である。**上げた本人が取り残されない担保は
 *    アプリ内表示**（`S-003` / `S-004` の隔離ブロック + `S-008` の状態）であり、
 *    こちらは**宛先分類によらず必ず出る**（`F-011` 処理④ の 🔴）。
 * ⚠️ したがって「`PARTNER_ADMIN` が 1 人も居ない取引先」ではメールが 0 通になりうる。
 *    その場合も画面には出る。招待の運用上、取引先には必ず `PARTNER_ADMIN` が居る
 *    （`F-007` / `CLAUDE.md` §1.2「招待された取引先 1 社につき 1〜2 名」）。
 */
const HOST_NOTICE_ROLES = ['OWNER', 'ADMIN'] as const satisfies readonly TenantRole[];
const PARTNER_NOTICE_ROLES = ['PARTNER_ADMIN'] as const satisfies readonly TenantRole[];

/** 隔離の周知対象（`app_scan_quarantine_target` の 1 行）。 */
export type ScanNoticeTarget = {
  readonly skillSheetId: string;
  /** 🔴 `null` = ホスト所有（分類 1 側）。非 `null` = そのパートナーの所有（分類 2 側）。 */
  readonly ownerPartnerCompanyId: string | null;
  readonly scanStatus: ScanStatus;
};

/**
 * 周知の宛先 1 人。
 *
 * 🔴 `recipientClass` は `resolveRecipientClass` が `Membership` から導いた値である
 *    （呼び出し側が組み立てた値ではない。docs/05 §8.2）。
 */
export type ScanNoticeRecipient = {
  readonly userId: string;
  readonly email: string;
  readonly recipientClass: 'HOST_MEMBER' | 'PARTNER_MEMBER';
};

export type ScanQuarantineNotice = {
  readonly target: ScanNoticeTarget;
  readonly recipients: readonly ScanNoticeRecipient[];
};

type TargetRow = {
  readonly skill_sheet_id: string;
  readonly owner_partner_company_id: string | null;
  readonly scan_status: string;
};

/**
 * 🔴 隔離されたスキルシートの**所有側と、その担当者一覧**を引く（`F-011` 処理④）。
 *
 * 呼び出せるのはジョブ（`apps/worker`）だけである（`ctx` が `SystemTenantCtx`）。
 * 対象が見つからなければ `null`（`applyFileScanResult` の `NOT_FOUND` と同じ扱い）。
 *
 * 🔴 **宛先の母集団は所有側に閉じる。** ホスト所有ならホスト所属の管理者、パートナー所有なら
 *    そのパートナーの管理者だけである。ホスト所有の隔離を取引先へ、取引先の隔離をホストへ
 *    送らない —— 後者は「パートナーの台帳にファイルが存在する」ことをホストへ漏らす
 *    （`CLAUDE.md` §3.1 の第二境界。越境 5 経路のどれにも当たらない）。
 */
export async function readScanQuarantineNotice(
  ctx: SystemTenantCtx,
  input: { readonly objectKey: string },
): Promise<ScanQuarantineNotice | null> {
  return runInTenantTransaction(
    { tenantId: ctx.tenantId, partnerCompanyId: null, actorUserId: ctx.userId },
    async (tx) => {
      const rows = await tx.$queryRaw<TargetRow[]>(Prisma.sql`
        SELECT skill_sheet_id::text AS skill_sheet_id,
               owner_partner_company_id::text AS owner_partner_company_id,
               scan_status
          FROM app_scan_quarantine_target(${input.objectKey})`);

      const row = rows[0];
      if (row === undefined) return null;
      if (!isScanStatus(row.scan_status)) {
        // 値集合の外の状態が保存されている ＝ CHECK の前提が壊れている。握り潰さない。
        throw new Error(
          `app_scan_quarantine_target が未知の scan_status '${row.scan_status}' を返しました。`,
        );
      }

      const ownerPartnerCompanyId = row.owner_partner_company_id;
      const target: ScanNoticeTarget = {
        skillSheetId: row.skill_sheet_id,
        ownerPartnerCompanyId,
        scanStatus: row.scan_status,
      };

      // 🔴 母集団は `memberships`（C5 PARTY）で確定させる（`users` から数え上げない。
      //    docs/05 §6.6 #83 の 🔴 と同じ理由 —— `users` は C8 DIRECTORY であり、
      //    ホスト文脈からはテナント内の全利用者が見えてしまう）。
      const noticeRoles = ownerPartnerCompanyId === null ? HOST_NOTICE_ROLES : PARTNER_NOTICE_ROLES;
      const memberships = await tx.membership.findMany({
        where: {
          revokedAt: null,
          // 🔴 所有側に閉じる（`null` = ホスト所属）。
          partnerCompanyId: ownerPartnerCompanyId,
          role: { in: [...noticeRoles] },
        },
        select: { userId: true },
      });

      const userIds = [...new Set(memberships.map((membership) => membership.userId))].sort();
      if (userIds.length === 0) return { target, recipients: [] };

      const users = await tx.user.findMany({
        where: { id: { in: userIds }, ownerPartnerCompanyId },
        select: { id: true, email: true },
        // 🔴 決定的な順序（同じ入力で同じ順に予約される。docs/05 §4.8）。
        orderBy: { id: 'asc' },
      });

      const recipients: ScanNoticeRecipient[] = [];
      for (const user of users) {
        // 🔴 分類は 1 人ずつ `Membership` から導く（docs/05 §8.2「呼び出し側に自己申告させない」）。
        //    `fallback` は型により分類 3 / 4 しか渡せないため、引けなかった宛先は
        //    **モック側**に倒れる（「分からないから実送信」には決してならない）。
        const recipientClass = await resolveRecipientClass(tx, { userId: user.id }, 'CLIENT');
        if (recipientClass !== 'HOST_MEMBER' && recipientClass !== 'PARTNER_MEMBER') continue;
        recipients.push({ userId: user.id, email: user.email, recipientClass });
      }
      return { target, recipients };
    },
  );
}
