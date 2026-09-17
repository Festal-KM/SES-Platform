// tests/e2e/audit-k7.spec.ts
// 🔴 K-7（`CLAUDE.md` §7「スキルシートの閲覧・DL で監査ログが欠落した件数 = 0 件」）の
//    デスクトップ側 E2E。`docs/dev-plan.md` §6.1 K-7 / `docs/sprints/SP-05-engineer-ledger.md`
//    §T-05-10。モバイルビューポートの③は `tests/e2e/audit-k7.mobile.spec.ts`（別プロジェクト）。
//
// 検証する 4 経路のうち、本ファイルが担当するのは:
//   ① デスクトップの閲覧（#21 `GET /api/skill-sheets/{id}/preview`）
//   ② デスクトップの DL（#20 `GET /api/skill-sheets/{id}/download-url` → S3 への実ナビゲーション）
//   ④ 共有 URL 経由の DL（#20 を API 直叩きで発行し、発行された署名付き URL が実際に取得できる）
// ③ モバイルビューポートの閲覧・DL は `audit-k7.mobile.spec.ts`。
//
// 🔴 記録できない経路が 1 つも無いこと（`BR-28`）と、`deviceKind` が経路（デスクトップ /
//    モバイル）どおりに記録されること（`CLAUDE.md` §13.3）を、`GET /api/audit-logs`
//    （S-041 API）で実際に確かめる —— 「押した後に間を置かず確認する」のではなく、
//    `issueDownloadUrl` / `readSkillSheetPreview` は**同期的に**監査を書いてから応答するため
//    （`apps/web/lib/storage/download.ts` / `apps/web/lib/skill-sheets/service.ts`）、
//    非同期ジョブのポーリングは不要である（ウイルススキャンの完了待ちだけが非同期だが、
//    それは下記のとおり別の手段で解決する）。
//
// ============================================================================
// 🔴 前提データの作り方（CLEAN な版をどう用意するか）
// ============================================================================
// ① S-007 相当でエンジニアを登録（`POST /api/engineers`）
// ② #18 `upload-url` を発行（`POST /api/engineers/{id}/skill-sheets/upload-url`）
// ③ 実体を MinIO へ PUT する
// ④ #19 で確定（`POST /api/engineers/{id}/skill-sheets`）。直後は必ず `SCANNING`
// ⑤ 🔴 `harness/db-admin.ts` の K-7 専用シームで `scan_status` を直接 `CLEAN` にする
//
// ⑤ が必要な理由: 実際のスキャン結果の適用（`SCANNING` → `CLEAN`）は GuardDuty Webhook →
// `scan.apply-result`（`apps/worker`）だけが行う経路であり、E2E ハーネスには worker プロセスも
// BullMQ 経由の駆動も無い（`development` は `PendingScanApplyResultQueue` というインメモリの
// 保留キューにしか積まない）。K-7 が証明したいのは「閲覧・DL の記録が経路によらず漏れないこと」
// であって、ウイルススキャンの状態遷移そのものは T-05-05 のユニット / 結合テストの射程である。
// `tests/isolation/skill-sheet-download.test.ts` の `setScanStatus` と同じ判断を E2E でも踏襲する。
//
// 🔴 ③（MinIO への PUT）は**ブラウザ経由にせず、テストプロセス（Node）側から直接 fetch する**。
//    development の `objectStore` は `real`（`packages/config/src/connector-selection.ts`）であり、
//    アップロード先はアプリと別オリジンの MinIO になる。ブラウザの `fetch` は非同一オリジンへの
//    非単純リクエスト（`Content-Type: application/pdf` を持つ PUT）に CORS プリフライトを要求するが、
//    このバケットには CORS 設定を持たせていない（本番の S3 バケット側の CORS 設定は本タスクの
//    射程外であり、`docs/03` / `docs/05` にも記載が無い —— `programmer` への申し送りとして
//    報告する）。Node 側の `fetch` はブラウザの CORS 制約を受けないため、ここだけ経路を変える。
//    一方 ②（ダウンロード）はボタン押下がブラウザの**トップレベルナビゲーション**
//    （`window.location.assign`）を起こすだけであり、ナビゲーションは CORS の対象外なので
//    ブラウザ側で完結できる。
// 🔴 PUT のヘッダから `content-length` を意図的に外す。このリポジトリの `undici`（fetch の実装）は
//    明示的な `content-length` ヘッダを「不正なヘッダ」として拒否する（実測。`node -e` での
//    スモークテストで確認済み）。`content-type` だけを指定すれば `fetch` が実際のボディ長から
//    正しい `Content-Length` を自動算出して送るため、S3 の署名検証（`content-length` も
//    signableHeaders に含む。`packages/connectors/src/storage/aws-sdk-s3.ts`）は成立する
//    （送信される実ヘッダ値が一致していれば良く、誰が計算したかは問われない）。
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import { markSkillSheetClean } from './harness/db-admin';
import { objectStorageOrigin } from './harness/object-storage';
import { apiRequest, auditLogPeriodQuery, parseJson } from './support/api';
import { tenantIds } from './support/population';
import { hostOwner, openTenantSession, type Session } from './support/sessions';

type SkillSheetAuditAction = 'skill_sheet.view' | 'skill_sheet.download';

type AuditLogItem = {
  readonly action: string;
  readonly targetId: string | null;
  readonly deviceKind: string | null;
  /** `S-041` の詳細（許可リストを通った項目だけ。`engineer.view` は `via`）。 */
  readonly detail: { readonly entries: readonly { readonly key: string; readonly value: { readonly kind: string; readonly value: unknown } }[] };
};

/** `seed:isolation` のテナント A ホスト `OWNER`（`GET /api/audit-logs` は `OWNER` / `ADMIN` のみ）。 */
const HOST_OWNER_USER_ID = tenantIds(1).hostOwnerUserId;

/**
 * `GET /api/audit-logs`（S-041 API）から、指定した `action` / `targetId`（スキルシートの版 ID）に
 * 一致する行だけを取り出す。🔴 `action` はカテゴリでしか絞れない
 * （`ENGINEER_SKILL_SHEET_ACCESS` = `engineer.view` / `skill_sheet.view` / `skill_sheet.download`。
 * `apps/web/lib/audit-logs/categories.ts`）ため、正確な action と targetId でテスト側から絞り込む。
 */
async function skillSheetAuditRows(
  session: Session,
  action: SkillSheetAuditAction,
  skillSheetId: string,
): Promise<readonly AuditLogItem[]> {
  const period = auditLogPeriodQuery();
  const response = await apiRequest(
    session.page,
    `/api/audit-logs?${period}&action=ENGINEER_SKILL_SHEET_ACCESS&actorId=${HOST_OWNER_USER_ID}&limit=200`,
  );
  expect(response.status, 'GET /api/audit-logs が失敗しました').toBe(200);
  const body = parseJson(response) as { items: readonly AuditLogItem[] };
  return body.items.filter((item) => item.action === action && item.targetId === skillSheetId);
}

/**
 * S-007（エンジニア登録）→ #18 → PUT（MinIO）→ #19（確定）→ K-7 のシームで `CLEAN` にする。
 * 🔴 値をベタ書きしない: 表示名・ファイル内容はどちらも呼び出し側が渡す一意な文字列から作る
 *    （テストどうしがすれ違わないように、かつ内容の一致を検証できるように）。
 */
async function provisionCleanSkillSheet(
  session: Session,
  label: string,
): Promise<{ readonly engineerId: string; readonly skillSheetId: string }> {
  // 🔴 合成の表示名（`BR-47`。実データを使わない）。
  const displayName = `K7合成-${label}-${randomUUID().slice(0, 8)}`;

  const createdResponse = await apiRequest(session.page, '/api/engineers', {
    method: 'POST',
    body: { displayName },
  });
  expect(createdResponse.status, 'POST /api/engineers が失敗しました').toBe(201);
  const { id: engineerId } = parseJson(createdResponse) as { id: string };

  // 🔴 合成コンテンツに `displayName` を埋め込む（④ で「発行された URL から実際にその内容が
  //    取れる」ことを、値のベタ書きなしで確認するため）。
  const fileBytes = Buffer.from(`K-7 fixture (${displayName})\n`.repeat(64), 'utf8');

  const ticketResponse = await apiRequest(
    session.page,
    `/api/engineers/${engineerId}/skill-sheets/upload-url`,
    {
      method: 'POST',
      body: {
        fileName: 'skill-sheet-e2e.pdf',
        contentType: 'application/pdf',
        byteSize: fileBytes.byteLength,
      },
    },
  );
  expect(ticketResponse.status, 'upload-url（#18）の発行に失敗しました').toBe(201);
  const ticket = parseJson(ticketResponse) as {
    readonly objectKey: string;
    readonly uploadUrl: string;
    readonly requiredHeaders: Readonly<Record<string, string>>;
  };

  // 🔴 `content-length` を除く（本ファイル冒頭コメント）。`content-type` は署名どおりに送る。
  const putHeaders = Object.fromEntries(
    Object.entries(ticket.requiredHeaders).filter(([key]) => key.toLowerCase() !== 'content-length'),
  );
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: putHeaders, body: fileBytes });
  expect(put.status, `MinIO への PUT に失敗しました（status=${put.status}）`).toBeLessThan(300);

  const confirmResponse = await apiRequest(
    session.page,
    `/api/engineers/${engineerId}/skill-sheets`,
    { method: 'POST', body: { objectKey: ticket.objectKey, note: null } },
  );
  expect(confirmResponse.status, '確定（#19）に失敗しました').toBe(201);
  const confirmed = parseJson(confirmResponse) as { readonly id: string; readonly scanStatus: string };
  expect(confirmed.scanStatus, '確定直後は SCANNING のはずです（docs/05 §6.4 #19）').toBe('SCANNING');

  // 🔴 K-7 専用のシーム（`harness/db-admin.ts` 冒頭コメント参照。apps/worker が E2E に無いため）。
  markSkillSheetClean(confirmed.id);

  return { engineerId, skillSheetId: confirmed.id };
}

test.describe('K-7: 4 経路すべてで AuditLog が 1 件ずつ増える（BR-28。デスクトップ + 共有 URL）', () => {
  test('① デスクトップの閲覧（#21）で skill_sheet.view が 0→1 件（deviceKind=desktop）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      const { engineerId, skillSheetId } = await provisionCleanSkillSheet(session, 'view');

      expect(
        await skillSheetAuditRows(session, 'skill_sheet.view', skillSheetId),
        '提供直後は 0 件のはずです',
      ).toHaveLength(0);

      await session.page.goto(`/engineers/${engineerId}/skill-sheets`, {
        waitUntil: 'domcontentloaded',
      });
      await session.page.getByTestId(`skill-sheet-preview-${skillSheetId}`).click();
      await expect(
        session.page.getByTestId(`skill-sheet-preview-panel-${skillSheetId}`),
      ).toBeVisible();

      const rows = await skillSheetAuditRows(session, 'skill_sheet.view', skillSheetId);
      expect(rows, '閲覧後は 1 件だけのはずです（欠落 0 件 = BR-28）').toHaveLength(1);
      expect(rows[0]?.deviceKind, 'デスクトップの閲覧は deviceKind=desktop').toBe('desktop');

      // 🔴 本テストは MinIO へ到達しない（プレビューは `{ meta }` のみを返す）ので、
      //    アプリのオリジン以外への発信が 0 件であることまで確かめる。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('② デスクトップの DL（#20）で skill_sheet.download が 0→1 件、実ファイルが取得できる（deviceKind=desktop）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 🔴 ダウンロードボタンはブラウザを MinIO（development の `objectStore` は `real`）へ
    //    ナビゲートさせる。`guardOutboundRequests`（`support/network.ts`）はアプリのオリジン以外を
    //    既定で遮断するため、E2E が自分で起動したこの MinIO の 1 オリジンだけを明示的に許可する。
    const session = await openTenantSession(browser, hostOwner(1), {
      extraAllowedOrigins: [objectStorageOrigin()],
    });
    try {
      const { engineerId, skillSheetId } = await provisionCleanSkillSheet(session, 'dl');

      expect(
        await skillSheetAuditRows(session, 'skill_sheet.download', skillSheetId),
        '提供直後は 0 件のはずです',
      ).toHaveLength(0);

      await session.page.goto(`/engineers/${engineerId}/skill-sheets`, {
        waitUntil: 'domcontentloaded',
      });
      const downloadButton = session.page.getByTestId(`skill-sheet-download-${skillSheetId}`);
      await expect(downloadButton).toBeVisible();

      const [download] = await Promise.all([
        session.page.waitForEvent('download'),
        downloadButton.click(),
      ]);

      // 🔴 ダウンロード名は版番号だけで組み立てる（氏名を含まない。docs/05 §14.1 の決着）。
      //    このエンジニアの版はここで初めて作った 1 件目なので `v1` になる。
      expect(download.suggestedFilename()).toBe('skill-sheet-v1.pdf');
      const path = await download.path();
      expect(path, 'ダウンロードされたファイルの実体が見つかりません').not.toBeNull();
      const savedText = await readFile(path as string, 'utf8');
      expect(savedText, 'アップロードした内容がそのまま取得できること').toContain('K7合成-dl-');

      const rows = await skillSheetAuditRows(session, 'skill_sheet.download', skillSheetId);
      expect(rows, 'ダウンロード後は 1 件だけのはずです（欠落 0 件 = BR-28）').toHaveLength(1);
      expect(rows[0]?.deviceKind, 'デスクトップの DL は deviceKind=desktop').toBe('desktop');

      // 🔴 MinIO への到達は「許可した 1 オリジンのみ」であることの対照（`assertNone` は
      //    `extraAllowedOrigins` に無い予期しない外部発信が 0 件であることを見る）。
      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });

  test('④ 共有 URL 経由の DL: API 直叩きで発行された署名付き URL が実際に取得でき、発行のたびに skill_sheet.download が 1 件記録される', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    // 🔴 本テストはブラウザから MinIO へナビゲートしない（発行された URL は Node 側の fetch で
    //    直接検証する）ため、`extraAllowedOrigins` は不要。
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      const { skillSheetId } = await provisionCleanSkillSheet(session, 'shared');

      expect(
        await skillSheetAuditRows(session, 'skill_sheet.download', skillSheetId),
        '提供直後は 0 件のはずです',
      ).toHaveLength(0);

      // 🔴 UI のボタンを経由しない発行（`isolation.spec.ts` の「API 直叩き」と同じ考え方 ——
      //    画面を経由しなくても同じ記録が起きることを見る。「共有 URL」＝ URL さえあれば
      //    ボタンを押さずに取得できる、という意味を最も直接に表す経路である）。
      // 🔴 docs/05 §14.2 の監査対象は「発行」であり、S3 側の実際の GET は対象外
      //    （`issueDownloadUrl` 冒頭コメント）。したがって「発行が記録される」ことに加えて
      //    「発行された URL が実際に有効であること」まで確かめる —— 発行だけして中身が
      //    取れないのでは、共有 URL としての用を成さない。この判断は本コメントに残す
      //    （タスク指示の「判断をコメントに残す」に対応）。
      const issued = await apiRequest(
        session.page,
        `/api/skill-sheets/${skillSheetId}/download-url`,
      );
      expect(issued.status, 'download-url（#20）の発行に失敗しました').toBe(200);
      const ticket = parseJson(issued) as { readonly url: string };

      const rows = await skillSheetAuditRows(session, 'skill_sheet.download', skillSheetId);
      expect(rows, '発行後は 1 件だけのはずです（欠落 0 件 = BR-28）').toHaveLength(1);
      // 🔴 `apiRequest` はブラウザ（Desktop Chrome）の User-Agent で fetch するため、
      //    発行の経路が API 直叩きでも deviceKind は desktop になる（§13.3 は「モバイルだけ
      //    漏れない」ことを求めており、UA が desktop である以上これは正しい記録である）。
      expect(rows[0]?.deviceKind).toBe('desktop');

      // 🔴 発行された URL への到達は Node 側（テストプロセス）から行う。ブラウザ経由にすると
      //    `guardOutboundRequests` の許可が要る（② のテストと同じ理由）が、ここで見たいのは
      //    「URL 単体で取得できるか」だけなので、遮断の対象にならない Node 側の fetch で足りる。
      const fetched = await fetch(ticket.url);
      expect(fetched.status, '発行された URL への到達に失敗しました').toBe(200);
      const content = await fetched.text();
      expect(content, 'アップロードした内容がそのまま取得できること').toContain('K7合成-shared-');

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});

// ============================================================================
// ⑤ T-12-16: #46b 差分ビュー（docs/05 §17.3 #25 の差分ビュー部分 / `F-019 AC-2` / `docs/04` §S-006 セクション 4・5 / §5-6）
// ============================================================================
// 🔴 K-7 の spec に置く理由: #46b は**台帳の現在値を読み直す「エンジニア詳細の閲覧」**であり、`S-006` から開いたときに
//    `engineer.view` が `DETAIL` と `SNAPSHOT_DIFF` の 2 行残ること（docs/05 §6.5「#46b の境界と記録の確定」）は、この spec が
//    見ている「閲覧の記録が経路によらず漏れない」（`BR-27` / `BR-28`）の一部である。#25 の凍結側（`S-023` の行数と 4 項目が
//    変わらない）は `tests/isolation/proposals-create-update.test.ts` / `proposal-snapshot-diff.test.ts` ② が結合で固定する。
// 🔴 worker は要らない（#36 の作成と #16 の更新は同期。ゲートを掛けない `DRAFT` のまま差分を見る）。

/** `engineer.view` の行（対象のエンジニア ID で絞る。`ENGINEER_SKILL_SHEET_ACCESS` = `engineer.view` を含むカテゴリ）。 */
async function engineerViewRows(session: Session, engineerId: string): Promise<readonly AuditLogItem[]> {
  const period = auditLogPeriodQuery();
  const response = await apiRequest(
    session.page,
    `/api/audit-logs?${period}&action=ENGINEER_SKILL_SHEET_ACCESS&actorId=${HOST_OWNER_USER_ID}&limit=200`,
  );
  expect(response.status, 'GET /api/audit-logs が失敗しました').toBe(200);
  const body = parseJson(response) as { items: readonly AuditLogItem[] };
  return body.items.filter((item) => item.action === 'engineer.view' && item.targetId === engineerId);
}

test.describe('⑤ T-12-16: S-006 → セクション 4（提案履歴）→ 提案を選ぶ → セクション 5 に凍結側と現在値が並ぶ（engineer.view が SNAPSHOT_DIFF で残る）', () => {
  test('🔴 台帳を提案後に変えると、凍結側は提案時点のまま・現在値だけ変わり、別々の表に並ぶ。「提案後に変更」は変えた項目だけ', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openTenantSession(browser, hostOwner(1));
    try {
      const ids = tenantIds(1);
      const tag = randomUUID().slice(0, 8);
      // 🔴 合成データ（`BR-47`）。凍結側と現在値を見分けられる語を業務内容に入れる。
      const createdResponse = await apiRequest(session.page, '/api/engineers', {
        method: 'POST',
        body: {
          displayName: `T1216合成-${tag}-凍結前`,
          unitPriceMin: 650000,
          unitPriceMax: 750000,
          prefecture: '13',
          remoteMode: 'PARTIAL_REMOTE',
          careers: [
            { periodFrom: '2024-04', periodTo: null, role: 'PL', description: `T1216 凍結前の基幹刷新 ${tag}`, technologies: 'Java' },
            { periodFrom: '2021-01', periodTo: '2024-03', role: 'SE', description: `T1216 凍結前の受託 ${tag}`, technologies: 'Kotlin' },
          ],
        },
      });
      expect(createdResponse.status, createdResponse.text).toBe(201);
      const { id: engineerId } = parseJson(createdResponse) as { id: string };

      // セクション 4 が空の状態（「まだ提案されていません」。セクション 5 は無い。プレースホルダも無い）。
      await session.page.goto(`/engineers/${engineerId}`, { waitUntil: 'domcontentloaded' });
      await expect(session.page.getByTestId('engineer-detail-proposals-empty')).toBeVisible();
      await expect(session.page.getByTestId('engineer-detail-snapshot-diff')).toHaveCount(0);
      await expect(session.page.getByTestId('engineer-detail-proposals-coming-soon')).toHaveCount(0);

      // #36 で提案を作る（凍結）。
      const proposalResponse = await apiRequest(session.page, '/api/proposals', {
        method: 'POST',
        body: {
          projectId: ids.publishedProjectId,
          engineerId,
          recipientCompanyName: 'T1216 架空エンド株式会社',
          recipientEmail: 't1216-recipient@example.test',
          offeredUnitPrice: 700000,
          subject: `T1216 ${tag}`,
          body: 'T1216 合成データです。',
        },
      });
      expect(proposalResponse.status, proposalResponse.text).toBe(201);
      const { id: proposalId } = parseJson(proposalResponse) as { id: string };

      // 提案後に台帳を変える（#16。1 行編集・1 行削除・1 行追加 + 氏名・上限単価）。
      const updateResponse = await apiRequest(session.page, `/api/engineers/${engineerId}`, {
        method: 'PATCH',
        body: {
          displayName: `T1216合成-${tag}-凍結後`,
          unitPriceMax: 800000,
          careers: [
            { periodFrom: '2024-04', periodTo: null, role: 'PL', description: `T1216 現在の基幹刷新（改） ${tag}`, technologies: 'Java' },
            { periodFrom: '2019-01', periodTo: '2020-12', role: 'PG', description: `T1216 現在の保守 ${tag}`, technologies: 'PHP' },
          ],
        },
      });
      expect(updateResponse.status, updateResponse.text).toBe(200);

      const before = (await engineerViewRows(session, engineerId)).length;

      // S-006 → セクション 4 の行 → 「差分を見る」→ セクション 5。
      await session.page.goto(`/engineers/${engineerId}`, { waitUntil: 'domcontentloaded' });
      const row = session.page.getByTestId(`engineer-proposal-row-${proposalId}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText('T1216 架空エンド株式会社');
      await expect(session.page.getByTestId(`engineer-proposal-detail-link-${proposalId}`)).toHaveAttribute('href', `/proposals/${proposalId}`);
      await expect(session.page.getByTestId('engineer-snapshot-diff-lead')).toBeVisible();
      await session.page.getByTestId(`engineer-proposal-diff-link-${proposalId}`).click();
      await expect(session.page.getByTestId('engineer-snapshot-diff')).toHaveAttribute('data-proposal-id', proposalId);
      await expect(session.page.getByTestId(`engineer-proposal-row-${proposalId}`)).toHaveAttribute('data-selected', 'true');

      // 🔴 項目: 凍結側は提案時点、現在値は変更後。変えた項目（氏名 / 上限）にだけ「提案後に変更」。
      await expect(session.page.getByTestId('engineer-snapshot-diff-frozen-displayName')).toContainText(`T1216合成-${tag}-凍結前`);
      await expect(session.page.getByTestId('engineer-snapshot-diff-current-displayName')).toContainText(`T1216合成-${tag}-凍結後`);
      await expect(session.page.getByTestId('engineer-snapshot-diff-field-displayName')).toHaveAttribute('data-changed', 'true');
      await expect(session.page.getByTestId('engineer-snapshot-diff-field-unitPriceMax')).toHaveAttribute('data-changed', 'true');
      await expect(session.page.getByTestId('engineer-snapshot-diff-frozen-unitPriceMax')).toContainText('750,000');
      await expect(session.page.getByTestId('engineer-snapshot-diff-current-unitPriceMax')).toContainText('800,000');
      for (const key of ['skills', 'unitPriceMin', 'availableFrom', 'prefecture', 'remoteMode']) {
        await expect(session.page.getByTestId(`engineer-snapshot-diff-field-${key}`)).toHaveAttribute('data-changed', 'false');
      }

      // 🔴 経歴: 凍結側の表と現在値の表が別で、互いの行が混ざらない（docs/05 §17.3 #25「同一のリストに混在しない」）。
      const frozen = session.page.getByTestId('engineer-snapshot-diff-careers-frozen');
      const current = session.page.getByTestId('engineer-snapshot-diff-careers-current');
      await expect(frozen).toContainText('T1216 凍結前の基幹刷新');
      await expect(frozen).toContainText('T1216 凍結前の受託');
      await expect(frozen).not.toContainText('現在の');
      await expect(current).toContainText('T1216 現在の基幹刷新（改）');
      await expect(current).toContainText('T1216 現在の保守');
      await expect(current).not.toContainText('凍結前の');
      expect(await frozen.locator('tbody tr').count()).toBe(2);
      expect(await current.locator('tbody tr').count()).toBe(2);
      await expect(session.page.getByTestId('engineer-snapshot-diff-careers-note')).toHaveAttribute('data-changed', 'true');

      // 🔴 記録: S-006 を開いた DETAIL + 差分の SNAPSHOT_DIFF（2 回の遷移で DETAIL 2 行 + SNAPSHOT_DIFF 1 行 = +3）。
      const after = await engineerViewRows(session, engineerId);
      expect(after.length - before).toBe(3);
      const vias = after.map((item) => item.detail.entries.find((entry) => entry.key === 'via')?.value.value);
      expect(vias.filter((via) => via === 'SNAPSHOT_DIFF')).toHaveLength(1);
      expect(vias.filter((via) => via === 'DETAIL').length).toBeGreaterThanOrEqual(2);
      expect(after.every((item) => item.deviceKind === 'desktop')).toBe(true);

      session.outbound.assertNone();
    } finally {
      await session.close();
    }
  });
});
