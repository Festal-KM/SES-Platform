// apps/web/app/(main)/engineers/[id]/skill-sheets/skill-sheet-screen.render.test.tsx
// 🔴 `S-008` の状態別描画（`F-011 AC-1`〜`AC-3`）。T-05-06。
//
// ============================================================================
// 🔴 なぜこの粒度のテストが要るか
// ============================================================================
// `F-011 AC-1` が要求するのは「`CLEAN` でないファイルについて、共有 URL の発行・提案への添付・
// チャットへの添付のいずれもできない。**導線が存在しない**」である。API の結合テストで示せるのは
// 「呼んでも 403 / 409 になる」ことだけであり、**押せるボタンが画面にある**時点で要件違反である。
// したがって「DOM にその要素が無いこと」をここで固定する。
//
// 🔴 対照（`CLEAN` の行には導線がある）を必ず併せて確認する —— 対照が無いと、
//    セレクタの綴りを間違えただけの**空振りするテスト**が green のまま残る。
//
// 🔴 `@testing-library/react` を使わず `react-dom/server` の `renderToStaticMarkup` を使う
//    （新規依存を増やさない。`skill-dictionary-screen.render.test.tsx` と同じ方針）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SCAN_STATUSES, type ScanStatus } from '@ses/domain';
import type { SkillSheetVersionView } from '../../../../../lib/skill-sheets/service';
import { SkillSheetScreen, type SkillSheetScreenMessages } from './skill-sheet-screen';

const ENGINEER = '01930000-0000-7000-8000-0000000000e1';

/** 版 ID は状態ごとに固定（`data-testid` の突き合わせに使う）。 */
const IDS: Readonly<Record<ScanStatus, string>> = {
  SCANNING: '01930000-0000-7000-8000-00000000c001',
  CLEAN: '01930000-0000-7000-8000-00000000c002',
  INFECTED: '01930000-0000-7000-8000-00000000c003',
  UNSCANNABLE: '01930000-0000-7000-8000-00000000c004',
  FAILED: '01930000-0000-7000-8000-00000000c005',
};

function version(
  scanStatus: ScanStatus,
  overrides: Partial<SkillSheetVersionView> = {},
): SkillSheetVersionView {
  return {
    id: IDS[scanStatus],
    version: SCAN_STATUSES.indexOf(scanStatus) + 1,
    uploadedAt: '2026-09-05T02:00:00.000Z',
    uploadedByName: '山田 太郎',
    scanStatus,
    isLatest: false,
    note: null,
    contentType: 'application/pdf',
    byteSize: 1024,
    ...overrides,
  };
}

const messages: SkillSheetScreenMessages = {
  uploadSection: 'アップロード',
  uploadFileLabel: 'ファイルを選択',
  uploadNoteLabel: '版のメモ（任意）',
  uploadSubmit: 'アップロード',
  uploadSubmitting: 'アップロードしています…',
  uploadDone: 'アップロードしました。',
  uploadFormats: '対応形式: xlsx / xls / docx / doc / pdf / png / jpeg',
  uploadImageNotice: '画像 PDF・画像ファイルは自動読み取りに対応していません。',
  uploadScanNotice: '検査に合格するまで共有できません。',
  uploadError: 'アップロードできませんでした。',
  uploadErrorTooLarge: 'ファイルのサイズが上限を超えています。',
  uploadErrorQuota: 'ストレージの空き容量が不足しています。',
  uploadErrorTransfer: 'ファイルをストレージへ送信できませんでした。',
  uploadReadOnlyNote: 'この画面ではアップロードできません。',

  versionsSection: '版の一覧',
  versionsEmpty: 'スキルシートが登録されていません。',
  columnVersion: '版',
  columnUploadedAt: 'アップロード日時',
  columnUploadedBy: 'アップロード者',
  columnScanStatus: 'スキャン状態',
  columnExtraction: '抽出状態',
  columnLatest: '最新版',
  columnActions: '操作',
  versionPrefix: 'v',
  latestBadge: '最新',
  notLatest: '—',
  uploaderUnknown: '—',
  noteLabel: 'メモ',

  scanStatusLabels: {
    SCANNING: '検査中（通常 2 分以内）',
    CLEAN: '検査済み',
    INFECTED: '隔離',
    UNSCANNABLE: '検査不能',
    FAILED: '検査失敗',
  },
  blockedReasons: {
    SCANNING: '検査中のため、操作は選択できません。',
    INFECTED: 'このファイルは隔離されました。以後どのロールからもダウンロードできません。',
    UNSCANNABLE: '検査を完了できなかったため、この版は共有できません。',
    FAILED: '検査に失敗したため、この版は共有できません。',
  },

  setLatest: '最新版にする',
  setLatestSubmitting: '切り替えています…',
  deleteAction: '削除',
  deleteSubmitting: '削除しています…',
  deleteConfirm: 'この版を削除します。',
  actionError: '操作を反映できませんでした。',
  shareComingSoon: '提案・チャットへの添付は後続のリリースで行えます。',

  preview: 'この版を開く',
  previewSubmitting: '開いています…',
  previewClose: '閉じる',
  download: 'ダウンロード',
  downloadSubmitting: '準備しています…',
  auditNotice: '閲覧とダウンロードは監査ログに記録されます。',
  downloadReadOnlyNote: 'この画面ではダウンロードできません（閲覧のみの権限です）。',
  previewTitle: '版の情報',
  previewContentType: '形式',
  previewByteSize: 'サイズ',
  previewByteSizeUnit: 'バイト',
  previewBodyNotice: 'この画面には本文を表示しません。',
  previewError: '版の情報を読み込めませんでした。',
  downloadError: 'ダウンロードを開始できませんでした。',

  extractionSection: '抽出結果と採否',
  extractionNotRun: '未実行',
  extractionUnsupported: '自動読み取り非対応',
  extractionComingSoon: '自動読み取りは後続のリリースで利用できます。',
};

function render(
  versions: readonly SkillSheetVersionView[],
  canManage = true,
  /**
   * 🔴 T-05-07: ダウンロードの導線を出すか（`F-012 AC-3`）。**`canManage` と独立に渡す** ——
   *    「管理できる ＝ ダウンロードできる」と読み替えると、集合が分かれた日に検査が空振りする。
   */
  canDownload = canManage,
): string {
  return renderToStaticMarkup(
    createElement(SkillSheetScreen, {
      engineerId: ENGINEER,
      versions,
      canManage,
      canDownload,
      messages,
    }),
  );
}

/** すべての状態を 1 行ずつ並べた一覧（`CLEAN` を対照として必ず含む）。 */
const ALL_STATUS_ROWS = SCAN_STATUSES.map((status) => version(status));

/**
 * 🔴 `data-testid` の**完全一致**で判定する（部分文字列で見ない）。
 *    `skill-sheet-upload-form` は `skill-sheet-upload-formats`（対応形式の注記）の接頭辞であり、
 *    部分一致だと「無いこと」の検証が**常に失敗する / 常に成功する**方向へ静かに壊れる。
 */
function hasTestId(html: string, testId: string): boolean {
  return html.includes(`data-testid="${testId}"`);
}

describe('🔴 `F-011 AC-1`: `CLEAN` でない版に共有の導線が DOM に存在しない', () => {
  it.each(SCAN_STATUSES.filter((status) => status !== 'CLEAN'))(
    '%s の行に共有の要素が 1 つも無い',
    (status) => {
      const html = render(ALL_STATUS_ROWS);
      expect(hasTestId(html, `skill-sheet-share-${IDS[status]}`)).toBe(false);
      // 🔴 「最新版にする」も共有側の操作である（最新版は共有される版であり、
      //    `CLEAN` 以外は DB の CHECK でも拒否される）。
      expect(hasTestId(html, `skill-sheet-set-latest-${IDS[status]}`)).toBe(false);
    },
  );

  it('🔴 対照: `CLEAN` の行には共有の置き場所と切替の導線がある（空振りするテストにしない）', () => {
    const html = render(ALL_STATUS_ROWS);
    expect(hasTestId(html, `skill-sheet-share-${IDS.CLEAN}`)).toBe(true);
    expect(hasTestId(html, `skill-sheet-set-latest-${IDS.CLEAN}`)).toBe(true);
  });

  it.each(SCAN_STATUSES.filter((status) => status !== 'CLEAN'))(
    '🔴 %s の行にダウンロードのボタンが無い（`F-011 AC-1` / `AC-3`。T-05-07）',
    (status) => {
      const html = render(ALL_STATUS_ROWS);
      expect(hasTestId(html, `skill-sheet-download-${IDS[status]}`)).toBe(false);
    },
  );

  it('🔴 対照: `CLEAN` の行にはダウンロードのボタンがある（空振りするテストにしない）', () => {
    const html = render(ALL_STATUS_ROWS);
    expect(hasTestId(html, `skill-sheet-download-${IDS.CLEAN}`)).toBe(true);
  });

  it('🔴 共有できない理由は状態ごとに書き分ける（「順番待ち」と読める文言に畳まない）', () => {
    const html = render(ALL_STATUS_ROWS);
    expect(html).toContain(messages.blockedReasons.INFECTED);
    expect(html).toContain(messages.blockedReasons.UNSCANNABLE);
    expect(html).toContain(messages.blockedReasons.FAILED);
  });
});

describe('🔴 `F-011 AC-2`: 検査中は「検査中」と表示し、操作を選べない', () => {
  it('検査中の行に状態が表示される', () => {
    const html = render([version('SCANNING')]);
    expect(html).toContain(messages.scanStatusLabels.SCANNING);
    expect(html).toContain(messages.blockedReasons.SCANNING);
  });

  it('🔴 検査中の行には共有・切替・削除のボタンが 1 つも無い（結果の適用先が消えない）', () => {
    const html = render([version('SCANNING')]);
    expect(hasTestId(html, `skill-sheet-delete-${IDS.SCANNING}`)).toBe(false);
    expect(hasTestId(html, `skill-sheet-set-latest-${IDS.SCANNING}`)).toBe(false);
    expect(hasTestId(html, `skill-sheet-share-${IDS.SCANNING}`)).toBe(false);
    expect(hasTestId(html, `skill-sheet-download-${IDS.SCANNING}`)).toBe(false);
  });
});

describe('🔴 `F-011 AC-3`: 感染したファイルは隔離され、ダウンロードできない', () => {
  it('隔離であることと、どのロールからも DL できないことを明示する', () => {
    const html = render([version('INFECTED')]);
    expect(html).toContain(messages.scanStatusLabels.INFECTED);
    expect(html).toContain(messages.blockedReasons.INFECTED);
    expect(hasTestId(html, `skill-sheet-share-${IDS.INFECTED}`)).toBe(false);
  });

  it('隔離された版は削除できる（検査は終わっている）', () => {
    const html = render([version('INFECTED')]);
    expect(hasTestId(html, `skill-sheet-delete-${IDS.INFECTED}`)).toBe(true);
  });

  it('🔴 隔離された版でも「この版を開く」は出る（メタデータの確認であり本文は返らない）', () => {
    const html = render([version('INFECTED')]);
    expect(hasTestId(html, `skill-sheet-preview-${IDS.INFECTED}`)).toBe(true);
    // 🔴 ただしダウンロードは無い（`F-011 AC-3`「以後どのロールからもダウンロードできない」）。
    expect(hasTestId(html, `skill-sheet-download-${IDS.INFECTED}`)).toBe(false);
  });
});

/**
 * 🔴 T-05-07（`F-012`）。**閲覧とダウンロードは別の導線**であり、`VIEWER` の扱いも別である。
 *    ここで固定するのは「DOM に何があるか」だけであり、拒否の本体はルートのガードと RLS である
 *    （`tests/isolation/skill-sheet-download.test.ts` が実証する）。
 */
describe('🔴 `F-012 AC-3`: `VIEWER` は DL の導線が無く、閲覧の導線はある', () => {
  it('🔴 `canDownload` が false なら、`CLEAN` の行にもダウンロードのボタンが無い', () => {
    const html = render(ALL_STATUS_ROWS, false, false);
    for (const status of SCAN_STATUSES) {
      expect(hasTestId(html, `skill-sheet-download-${IDS[status]}`)).toBe(false);
    }
  });

  it('🔴 導線を消すだけにせず、誰に頼めばよいかを書く（行き止まりにしない）', () => {
    const html = render(ALL_STATUS_ROWS, false, false);
    expect(hasTestId(html, `skill-sheet-download-read-only-${IDS.CLEAN}`)).toBe(true);
    expect(html).toContain(messages.downloadReadOnlyNote);
  });

  it('🔴 `canDownload` が false でも「この版を開く」は全状態にある（閲覧は可）', () => {
    const html = render(ALL_STATUS_ROWS, false, false);
    for (const status of SCAN_STATUSES) {
      expect(hasTestId(html, `skill-sheet-preview-${IDS[status]}`)).toBe(true);
    }
  });

  it('🔴 対照: `canDownload` が true なら注記は出さない（読めるのにお願いしろと書かない）', () => {
    const html = render(ALL_STATUS_ROWS, true, true);
    expect(hasTestId(html, `skill-sheet-download-read-only-${IDS.CLEAN}`)).toBe(false);
  });

  it('🔴 閲覧・DL が記録されることをロールを問わず明示する（`CLAUDE.md` §3.5 の説明責任）', () => {
    for (const canManage of [true, false]) {
      const html = render(ALL_STATUS_ROWS, canManage, canManage);
      expect(hasTestId(html, 'skill-sheet-audit-notice')).toBe(true);
    }
  });

  it('🔴 本文はこの画面に出ない（プレビューのパネルは押すまで DOM に無い）', () => {
    const html = render(ALL_STATUS_ROWS);
    for (const status of SCAN_STATUSES) {
      expect(hasTestId(html, `skill-sheet-preview-panel-${IDS[status]}`)).toBe(false);
    }
  });
});

describe('版一覧の表示（docs/04 §S-008）', () => {
  it('最新版のバッジは `is_latest` の行にだけ出る', () => {
    const html = render([version('CLEAN', { isLatest: true }), version('FAILED')]);
    expect(hasTestId(html, `skill-sheet-latest-${IDS.CLEAN}`)).toBe(true);
    expect(hasTestId(html, `skill-sheet-latest-${IDS.FAILED}`)).toBe(false);
  });

  it('🔴 すでに最新版の行には「最新版にする」を出さない（何も起きない操作を描かない）', () => {
    const html = render([version('CLEAN', { isLatest: true })]);
    expect(hasTestId(html, `skill-sheet-set-latest-${IDS.CLEAN}`)).toBe(false);
    // 削除と共有の置き場所は残る。
    expect(hasTestId(html, `skill-sheet-delete-${IDS.CLEAN}`)).toBe(true);
  });

  it('🔴 画像は「自動読み取り非対応」と明示する（`docs/03` 申し送り 8）', () => {
    const html = render([
      version('CLEAN', { contentType: 'image/png' }),
      version('FAILED', { contentType: 'application/pdf' }),
    ]);
    expect(html).toContain(messages.extractionUnsupported);
    expect(html).toContain(messages.extractionNotRun);
  });

  it('アップロード欄には対応形式と画像の注記が常に出る（ロールを問わない）', () => {
    for (const canManage of [true, false]) {
      const html = render([], canManage);
      expect(html).toContain(messages.uploadFormats);
      expect(html).toContain(messages.uploadImageNotice);
    }
  });

  it('版が無いときは空状態を出す（表を描かない）', () => {
    const html = render([]);
    expect(hasTestId(html, 'skill-sheet-versions-empty')).toBe(true);
    expect(hasTestId(html, 'skill-sheet-versions-table')).toBe(false);
  });

  it('版のメモは登録されている行にだけ出る', () => {
    const html = render([version('CLEAN', { note: '2026 年 9 月の更新' })]);
    expect(html).toContain('2026 年 9 月の更新');
  });
});

describe('🔴 権限差分（docs/04 §S-008「`VIEWER` はアップロード・ダウンロードの導線が無い」）', () => {
  it('`canManage` が false ならアップロードフォームが DOM に無い', () => {
    const html = render(ALL_STATUS_ROWS, false);
    expect(hasTestId(html, 'skill-sheet-upload-form')).toBe(false);
    expect(hasTestId(html, 'skill-sheet-upload-read-only')).toBe(true);
  });

  it('🔴 `canManage` が false なら切替・削除のボタンが 1 つも無い', () => {
    const html = render(ALL_STATUS_ROWS, false);
    for (const status of SCAN_STATUSES) {
      expect(hasTestId(html, `skill-sheet-set-latest-${IDS[status]}`)).toBe(false);
      expect(hasTestId(html, `skill-sheet-delete-${IDS[status]}`)).toBe(false);
    }
  });

  it('`canManage` が false でも版一覧とスキャン状態は見える（閲覧は可）', () => {
    const html = render(ALL_STATUS_ROWS, false);
    expect(hasTestId(html, 'skill-sheet-versions-table')).toBe(true);
    for (const status of SCAN_STATUSES) {
      expect(hasTestId(html, `skill-sheet-scan-status-${IDS[status]}`)).toBe(true);
    }
  });

  /**
   * 🔴 T-05-07: 管理はできないがダウンロードはできる、という組み合わせを想定していない
   *    （`SKILL_SHEET_DOWNLOADER_ROLES = SKILL_SHEET_MANAGER_ROLES`）。それでも
   *    props を独立にしてあるので、**片方だけ true** にしたときの描画を固定しておく ——
   *    集合が分かれた日に、この行が期待の宣言として効く。
   */
  it('`canManage` が false / `canDownload` が true なら DL だけが出る', () => {
    const html = render([version('CLEAN')], false, true);
    expect(hasTestId(html, `skill-sheet-download-${IDS.CLEAN}`)).toBe(true);
    expect(hasTestId(html, `skill-sheet-delete-${IDS.CLEAN}`)).toBe(false);
    expect(hasTestId(html, `skill-sheet-set-latest-${IDS.CLEAN}`)).toBe(false);
  });
});
