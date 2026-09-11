// tests/static/testid-inventory.test.ts
// 🔴 **`data-testid` のインベントリを凍結する。**（`docs/sprints/SP-21` T-21-01 ③）
//
// ============================================================================
// なぜこの検査が要るか
// ============================================================================
// E2E **35 本**（desktop 23 + mobile 12）と `*.render.test.tsx` **13 本**は、画面の要素を
// **`data-testid` で掴む**。SP-21 は 20 画面の `className` を総入れ替えする整形作業であり、
// その過程で testid を 1 つ落とす／改名するのは容易い。ところが——
//
//   🔴 **testid が消えても、テストは「落ちる」とは限らない。**
//      `expect(html).not.toContain(...)` 系の否定的な検査、`if (locator) ...` の下流、
//      「0 件のときはセクションごと出さない」条件分岐など、**要素が無いほうが通ってしまう
//      経路**が実在する。落ちないまま、その画面の回帰検知だけが静かに消える。
//   🔴 **サインインの testid が壊れれば E2E は 35 本すべてが落ちる。**
//      `tests/e2e/support/sessions.ts` は全シナリオで UI 経由でサインインし、
//      `signin-email` / `signin-password` / `signin-2fa-code`（および `admin-signin-*`）を使う。
//
// そこで **整形に手を付ける前に**、現在の testid の集合をここに固定する。
//
//   - **削除・改名があれば落ちる。**
//   - **追加は通す**（新しい画面が testid を足すのは正常。凍結は「減らないこと」だけを守る）。
//
// ============================================================================
// 凍結リストを直すとき（🔴 読まずに消さない）
// ============================================================================
// 🔴 **「テストが落ちたから凍結リストから消す」は、この検査を無効化する行為である。**
//    リストから 1 行消すことは「この testid はもう要らない」という宣言であり、**その testid を
//    使っている E2E / render テストを同じ変更で直したときにだけ**許される。
// 🔴 **testid を `packages/ui` などへ移した場合は、リストから消すのではなく走査対象
//    （`SCAN_ROOTS`）を足す。** 移動は削除ではない。
//
// ============================================================================
// 抽出の規則
// ============================================================================
// 対象は `apps/web/**/*.tsx`（`*.test.tsx` を除く）。次の 2 つの属性を拾う。
//
//   (1) `data-testid` —— 画面が要素に直接付けるもの。
//   (2) `testId` —— **`data-testid={testId}` として下流へ流されるプロパティ**。
//       `OtpauthQr`（`signin-otpauth-qr` / `admin-signin-otpauth-qr`）と `home-sections.tsx` の
//       導線（`home-host-engineer-ledger` ほか）が実際にこの形であり、**`data-testid` だけを
//       見ると E2E が依存している値を丸ごと取りこぼす。**
//
// 値の形は 3 通り。
//
//   - 文字列リテラル（`data-testid="engineer-list-table"`）→ **完全一致**で凍結する。
//   - テンプレートリテラル（`engineer-list-row-${row.id}`）→ 行ごとに値が変わるので、
//     **`${` の手前までの静的な接頭辞**（`engineer-list-row-`）を凍結する。
//   - 三項演算子 / `??` / `||` → **各枝**の文字列リテラルを凍結する。
//
// 静的に解決できない形（`data-testid={testId}` のような素の識別子）は値を凍結できない。
// **その穴が広がっていないこと**を `UNRESOLVED_ALLOWLIST` で別途固定する。
//
// 🔴 **抽出は TypeScript の AST で行う**（`tests/static/no-test-module-imports.test.ts` と同じ）。
//    正規表現だと **コメントの中の `data-testid={...}` を実物と区別できず**、
//    **三項演算子の条件（`pending.kind === 'ROLE' ? ... : ...` の `'ROLE'`）を枝と区別できない**。
//    どちらも「凍結してはいけないものを凍結する」誤りであり、後で必ず緩められる。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/**
 * 🔴 走査対象。**減らさない。** testid を別パッケージへ移した場合はここに足す
 *    （凍結リストから消さない。ファイル冒頭のコメント参照）。
 */
const SCAN_ROOTS: readonly string[] = [path.join(repoRoot, 'apps', 'web')];

const SKIPPED_DIR_NAMES = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '.git']);

/** testid の命名規約（このリポジトリの実体はすべて kebab-case である）。 */
const TESTID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** 動的 testid の静的接頭辞（末尾は必ず `-`。`engineer-list-row-` など）。 */
const TESTID_PREFIX_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-$/;

/** 拾う属性名。`testId` は `data-testid={testId}` へ流れるプロパティ（冒頭コメント (2)）。 */
const ATTRIBUTE_NAMES = new Set(['data-testid', 'testId']);

type Extraction = {
  /** 完全一致で凍結する値。 */
  readonly exact: readonly string[];
  /** 静的接頭辞で凍結する値（末尾 `-`）。 */
  readonly prefixes: readonly string[];
  /** 静的に解決できなかった式（`testId` のような素の識別子）。 */
  readonly unresolved: readonly string[];
  /** 属性の出現回数（走査が空振りしていないことの対照に使う）。 */
  readonly occurrences: number;
};

/** 🔴 抽出器の本体。自己検査は末尾の `describe('抽出器そのものの検査', ...)` が行う。 */
export function extractTestIds(source: string, fileName = 'source.tsx'): Extraction {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const exact: string[] = [];
  const prefixes: string[] = [];
  const unresolved: string[] = [];
  let occurrences = 0;

  /** 値の式から静的に決まる部分を拾う。拾えたら true。 */
  function collectFrom(expression: ts.Expression): boolean {
    if (ts.isParenthesizedExpression(expression)) return collectFrom(expression.expression);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      exact.push(expression.text);
      return true;
    }
    // `engineer-list-row-${row.id}` → 静的接頭辞は `head`（`${` の手前）。
    if (ts.isTemplateExpression(expression)) {
      prefixes.push(expression.head.text);
      return true;
    }
    // 🔴 三項演算子は**枝だけ**を見る（条件に書かれた列挙値は testid ではない）。
    if (ts.isConditionalExpression(expression)) {
      const whenTrue = collectFrom(expression.whenTrue);
      const whenFalse = collectFrom(expression.whenFalse);
      return whenTrue || whenFalse;
    }
    if (
      ts.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      const left = collectFrom(expression.left);
      const right = collectFrom(expression.right);
      return left || right;
    }
    return false;
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxAttribute(node) && ATTRIBUTE_NAMES.has(node.name.getText(sourceFile))) {
      occurrences += 1;
      const initializer = node.initializer;
      if (initializer !== undefined && ts.isStringLiteral(initializer)) {
        exact.push(initializer.text);
      } else if (
        initializer !== undefined &&
        ts.isJsxExpression(initializer) &&
        initializer.expression !== undefined &&
        !collectFrom(initializer.expression)
      ) {
        unresolved.push(initializer.expression.getText(sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return { exact, prefixes, unresolved, occurrences };
}

function collectTsxFiles(root: string, relative = ''): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const nextRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIPPED_DIR_NAMES.has(entry.name)) return [];
      return collectTsxFiles(path.join(root, entry.name), nextRelative);
    }
    if (!entry.isFile()) return [];
    // 🔴 テスト側（`*.test.tsx`）は「参照する側」であり、凍結の対象は実装側だけである。
    if (!entry.name.endsWith('.tsx') || entry.name.endsWith('.test.tsx')) return [];
    return [nextRelative];
  });
}

type ScannedFile = { readonly label: string; readonly extraction: Extraction };

const scannedFiles: readonly ScannedFile[] = SCAN_ROOTS.flatMap((root) =>
  collectTsxFiles(root).map((relative) => ({
    label: `${path.relative(repoRoot, root).split(path.sep).join('/')}/${relative}`,
    extraction: extractTestIds(readFileSync(path.join(root, relative), 'utf8'), relative),
  })),
);

const presentExact = new Set(scannedFiles.flatMap((file) => file.extraction.exact));
const presentPrefixes = new Set(scannedFiles.flatMap((file) => file.extraction.prefixes));
const totalOccurrences = scannedFiles.reduce((sum, file) => sum + file.extraction.occurrences, 0);

/**
 * 🔴 静的に解決できない `data-testid={<識別子>}` を持つファイルの許可リスト。
 *    いずれも値は `testId` プロパティとして**呼び出し側**に書かれており（`signin-otpauth-qr` /
 *    `home-host-engineer-ledger` ほか）、そちらが凍結の対象になっている。
 * 🔴 **ここを増やさない。** 増えるということは「凍結できない testid」が増えるということであり、
 *    その分だけこの安全網に穴が開く。定数へ切り出したくなったら、呼び出し側に
 *    `testId="..."` の形で文字列リテラルを残すこと。
 */
const UNRESOLVED_ALLOWLIST: readonly string[] = [
  'apps/web/app/(main)/_home/home-sections.tsx',
  'apps/web/app/_components/otpauth-qr.tsx',
];

/**
 * 🔴 **凍結された testid（完全一致）。** 2026-09-10 の `apps/web` の実体
 *    （`docs/sprints/SP-21` §3.1-8）。**消さない・並べ替えない・改名しない。**
 */
const FROZEN_EXACT: readonly string[] = [
  'admin-signin-2fa-code',
  'admin-signin-2fa-form',
  'admin-signin-2fa-submit',
  'admin-signin-email',
  'admin-signin-error',
  'admin-signin-form',
  'admin-signin-otpauth-qr',
  'admin-signin-otpauth-uri',
  'admin-signin-password',
  'admin-signin-submit',
  'engineer-availability',
  'engineer-available-from',
  'engineer-cancel',
  'engineer-careers-coming-soon',
  'engineer-collection-scope',
  'engineer-contact-email',
  'engineer-contact-note',
  'engineer-contact-phone',
  'engineer-detail-collection-scope',
  'engineer-detail-edit-link',
  'engineer-detail-headline',
  'engineer-detail-list-link',
  'engineer-detail-name',
  'engineer-detail-ownership',
  'engineer-detail-proposals-coming-soon',
  'engineer-detail-share-link',
  'engineer-detail-skill-empty',
  'engineer-detail-skill-sheets-lead',
  'engineer-detail-skill-sheets-link',
  'engineer-detail-skill-table',
  'engineer-detail-view-recorded',
  'engineer-display-name',
  'engineer-form',
  'engineer-form-error',
  'engineer-form-saved',
  'engineer-ledger-screen',
  'engineer-list-active-filters',
  'engineer-list-checkbox-note',
  'engineer-list-clear',
  'engineer-list-empty',
  'engineer-list-empty-checkbox-notice',
  'engineer-list-error',
  'engineer-list-experience-coming-soon',
  'engineer-list-filter-availability',
  'engineer-list-filter-available-by',
  'engineer-list-filter-only-commutable',
  'engineer-list-filter-only-in-time',
  'engineer-list-filter-prefecture',
  'engineer-list-filter-price-max',
  'engineer-list-filter-price-min',
  'engineer-list-filter-q',
  'engineer-list-filter-remote',
  'engineer-list-filter-skill-mode',
  'engineer-list-filter-skills',
  'engineer-list-filter-years-min',
  'engineer-list-filters',
  'engineer-list-first',
  'engineer-list-loading',
  'engineer-list-next',
  'engineer-list-order-note',
  'engineer-list-paging',
  'engineer-list-partner-scope-notice',
  'engineer-list-population',
  'engineer-list-read-only-note',
  'engineer-list-register',
  'engineer-list-retry',
  'engineer-list-search',
  'engineer-list-search-coming-soon',
  'engineer-list-skeleton',
  'engineer-list-table',
  'engineer-new-alias-add',
  'engineer-new-alias-dictionary-link',
  'engineer-new-alias-empty',
  'engineer-new-alias-input',
  'engineer-new-alias-list',
  'engineer-new-alias-note',
  'engineer-not-found',
  'engineer-ownership',
  'engineer-ownership-note',
  'engineer-prefecture',
  'engineer-preference-note',
  'engineer-remote-mode',
  'engineer-section-availability',
  'engineer-section-basic',
  'engineer-section-careers',
  'engineer-section-conditions',
  'engineer-section-contact',
  'engineer-section-skills',
  'engineer-share-confirm-cancel',
  'engineer-share-confirm-submit',
  'engineer-share-denied',
  'engineer-share-error',
  'engineer-share-lead',
  'engineer-share-ledger-empty',
  'engineer-share-not-shared',
  'engineer-share-not-shared-empty',
  'engineer-share-not-shared-table',
  'engineer-share-preview',
  'engineer-share-preview-careers-note',
  'engineer-share-preview-note',
  'engineer-share-preview-placeholder',
  'engineer-share-revoke-confirm',
  'engineer-share-screen',
  'engineer-share-share-confirm',
  'engineer-share-shared',
  'engineer-share-shared-empty',
  'engineer-share-shared-table',
  'engineer-skill-add',
  'engineer-skill-duplicate',
  'engineer-skill-empty',
  'engineer-skill-filter',
  'engineer-skill-select',
  'engineer-skill-table',
  'engineer-skill-years',
  'engineer-submit',
  'engineer-unit-price-max',
  'engineer-unit-price-min',
  'home-host-engineer-ledger',
  'home-host-project-list',
  'home-host-register-engineer',
  'home-host-register-project',
  'home-partner-engineer-ledger',
  'home-partner-engineer-shares',
  'home-partner-project-list',
  'home-scan-quarantine',
  'member-action-cancel',
  'member-action-confirm',
  'member-action-done',
  'member-action-error',
  'member-revoke-confirm',
  'member-revoke-confirm-text',
  'member-role-confirm',
  'member-role-confirm-after',
  'member-role-confirm-before',
  'members-empty',
  'members-invite-email',
  'members-invite-error',
  'members-invite-form',
  'members-invite-result',
  'members-invite-role',
  'members-invite-sandbox-notice',
  'members-invite-section',
  'members-invite-submit',
  'members-panel',
  'members-read-only-note',
  'members-table',
  'partner-companies-detail-section',
  'partner-companies-empty',
  'partner-companies-list-section',
  'partner-companies-register-section',
  'partner-companies-scope-notice',
  'partner-companies-screen',
  'partner-companies-table',
  'partner-company-detail',
  'partner-company-detail-pending-invitations',
  'partner-company-detail-prompt',
  'partner-company-detail-status',
  'partner-company-invite-blocked',
  'partner-company-invite-blocked-link',
  'partner-company-invite-email',
  'partner-company-invite-error',
  'partner-company-invite-form',
  'partner-company-invite-link',
  'partner-company-invite-link-copy',
  'partner-company-invite-link-copy-status',
  'partner-company-invite-link-once-only',
  'partner-company-invite-link-value',
  'partner-company-invite-result',
  'partner-company-invite-role',
  'partner-company-invite-sandbox-notice',
  'partner-company-invite-section',
  'partner-company-invite-submit',
  'partner-company-register-contact-email',
  'partner-company-register-contact-name',
  'partner-company-register-done',
  'partner-company-register-error',
  'partner-company-register-form',
  'partner-company-register-name',
  'partner-company-register-submit',
  'partner-company-resume-submit',
  'partner-company-suspend-cancel',
  'partner-company-suspend-confirm',
  'partner-company-suspend-confirm-submit',
  'partner-company-suspend-start',
  'partner-company-suspension-error',
  'partner-company-suspension-reason',
  'partner-company-suspension-section',
  'password-reset-complete',
  'password-reset-complete-message',
  'password-reset-confirm-error',
  'password-reset-confirm-form',
  'password-reset-confirm-invalid',
  'password-reset-confirm-invalid-message',
  'password-reset-confirm-submit',
  'password-reset-confirm-success',
  'password-reset-confirm-success-message',
  'password-reset-email',
  'password-reset-new-password',
  'password-reset-new-password-confirm',
  'password-reset-request-error',
  'password-reset-request-form',
  'password-reset-request-submit',
  'project-cancel',
  'project-commerce-notice',
  'project-detail-candidates-coming-soon',
  'project-detail-commerce-notice',
  'project-detail-edit-link',
  'project-detail-headline',
  'project-detail-name',
  'project-detail-not-shared',
  'project-detail-partner-published',
  'project-detail-proposals-coming-soon',
  'project-detail-proposals-empty',
  'project-detail-public-summary',
  'project-detail-screen',
  'project-detail-view-recorded',
  'project-detail-visibility-empty',
  'project-detail-visibility-proposal-count',
  'project-detail-visibility-settings',
  'project-detail-visibility-table',
  'project-detail-visibility-warning',
  'project-end-client-name',
  'project-form',
  'project-form-error',
  'project-form-saved',
  'project-headcount',
  'project-internal-unit-price',
  'project-list-clear',
  'project-list-empty',
  'project-list-error',
  'project-list-filter-prefecture',
  'project-list-filter-q',
  'project-list-filter-start-from',
  'project-list-filter-status',
  'project-list-filters',
  'project-list-first',
  'project-list-loading',
  'project-list-next',
  'project-list-order-note',
  'project-list-paging',
  'project-list-partner-scope-notice',
  'project-list-population',
  'project-list-read-only-note',
  'project-list-register',
  'project-list-retry',
  'project-list-screen',
  'project-list-search',
  'project-list-search-coming-soon',
  'project-list-skeleton',
  'project-list-table',
  'project-name',
  'project-not-found',
  'project-prefecture',
  'project-public-summary',
  'project-public-summary-note',
  'project-remote-mode',
  'project-section-basic',
  'project-section-commerce',
  'project-section-conditions',
  'project-section-public-summary',
  'project-start-date',
  'project-status',
  'project-status-note',
  'project-submit',
  'project-unit-price-max',
  'project-unit-price-min',
  'project-visibility-current',
  'project-visibility-current-empty',
  'project-visibility-current-table',
  'project-visibility-denied',
  'project-visibility-detail-link',
  'project-visibility-edit-link',
  'project-visibility-error',
  'project-visibility-execute',
  'project-visibility-form',
  'project-visibility-gate',
  'project-visibility-gate-lead',
  'project-visibility-gate-title',
  'project-visibility-lead',
  'project-visibility-link',
  'project-visibility-name',
  'project-visibility-notice',
  'project-visibility-preview',
  'project-visibility-preview-note',
  'project-visibility-preview-summary',
  'project-visibility-preview-warning',
  'project-visibility-result',
  'project-visibility-revoke-cancel',
  'project-visibility-revoke-confirm',
  'project-visibility-revoke-submit',
  'project-visibility-screen',
  'project-visibility-select',
  'project-visibility-select-empty',
  'project-visibility-select-note',
  'project-visibility-submit',
  'project-visibility-suspended-note',
  'sending-domain-affects',
  'sending-domain-dkim-pending',
  'sending-domain-fact',
  'sending-domain-failed-banner',
  'sending-domain-failure-reason',
  'sending-domain-guard-banner',
  'sending-domain-guard-banner-link',
  'sending-domain-onboarding',
  'sending-domain-records-empty',
  'sending-domain-records-section',
  'sending-domain-records-table',
  'sending-domain-register-error',
  'sending-domain-register-form',
  'sending-domain-register-input',
  'sending-domain-register-owner-only',
  'sending-domain-register-section',
  'sending-domain-register-submit',
  'sending-domain-screen',
  'sending-domain-unset-banner',
  'sending-domain-verify-error',
  'sending-domain-verify-pending',
  'sending-domain-verify-requested',
  'sending-domain-verify-submit',
  'signin-2fa-code',
  'signin-2fa-form',
  'signin-2fa-submit',
  'signin-email',
  'signin-error',
  'signin-form',
  'signin-otpauth-qr',
  'signin-otpauth-uri',
  'signin-password',
  'signin-submit',
  'skill-aliases-empty',
  'skill-aliases-section',
  'skill-aliases-table',
  'skill-candidates-accept-hint',
  'skill-candidates-empty',
  'skill-candidates-error',
  'skill-candidates-note',
  'skill-candidates-occurrence-note',
  'skill-candidates-read-only-note',
  'skill-candidates-reject-note',
  'skill-candidates-section',
  'skill-candidates-submitting',
  'skill-candidates-table',
  'skill-dictionary-empty',
  'skill-dictionary-error',
  'skill-dictionary-read-only-note',
  'skill-dictionary-screen',
  'skill-dictionary-search-form',
  'skill-dictionary-search-input',
  'skill-dictionary-search-submit',
  'skill-dictionary-section',
  'skill-dictionary-table',
  'skill-sheet-action-error',
  'skill-sheet-audit-notice',
  'skill-sheet-engineer-name',
  'skill-sheet-extraction-coming-soon',
  'skill-sheet-extraction-section',
  'skill-sheet-screen',
  'skill-sheet-upload-done',
  'skill-sheet-upload-error',
  'skill-sheet-upload-file',
  'skill-sheet-upload-form',
  'skill-sheet-upload-formats',
  'skill-sheet-upload-image-notice',
  'skill-sheet-upload-note',
  'skill-sheet-upload-read-only',
  'skill-sheet-upload-scan-notice',
  'skill-sheet-upload-section',
  'skill-sheet-upload-submit',
  'skill-sheet-versions-empty',
  'skill-sheet-versions-section',
  'skill-sheet-versions-table',
];

/**
 * 🔴 **凍結された testid の静的接頭辞（動的 testid）。** 実行時の値は
 *    `engineer-list-row-<uuid>` のように末尾が変わるため、接頭辞だけを固定する。
 */
const FROZEN_PREFIXES: readonly string[] = [
  'engineer-detail-',
  'engineer-detail-basic-',
  'engineer-detail-headline-',
  'engineer-list-link-',
  'engineer-list-more-skills-',
  'engineer-list-remove-filter-',
  'engineer-list-row-',
  'engineer-share-preview-',
  'engineer-share-preview-field-',
  'engineer-share-revoke-',
  'engineer-share-row-',
  'engineer-share-select-',
  'engineer-share-share-',
  'engineer-skill-level-',
  'engineer-skill-remove-',
  'engineer-skill-row-',
  'engineer-skill-years-',
  'home-scan-quarantine-item-',
  'home-scan-quarantine-link-',
  'member-revoke-start-',
  'member-role-select-',
  'member-row-',
  'member-self-',
  'partner-company-row-',
  'partner-company-select-',
  'project-detail-',
  'project-detail-headline-',
  'project-detail-requirements-',
  'project-list-link-',
  'project-list-more-requirements-',
  'project-list-row-',
  'project-list-visibility-',
  'project-requirement-add-',
  'project-requirement-error-',
  'project-requirement-free-text-',
  'project-requirement-remove-',
  'project-requirement-row-',
  'project-requirement-skill-',
  'project-requirement-skill-filter-',
  'project-requirement-years-',
  'project-requirements-empty-',
  'project-requirements-note-',
  'project-requirements-table-',
  'project-section-requirements-',
  'project-visibility-choice-',
  'project-visibility-preview-warning-',
  'sending-domain-record-copy-',
  'sending-domain-record-copy-feedback-',
  'skill-alias-row-',
  'skill-candidate-accept-',
  'skill-candidate-read-only-',
  'skill-candidate-reject-',
  'skill-candidate-row-',
  'skill-candidate-target-',
  'skill-dictionary-row-',
  'skill-sheet-blocked-',
  'skill-sheet-delete-',
  'skill-sheet-download-',
  'skill-sheet-download-error-',
  'skill-sheet-download-read-only-',
  'skill-sheet-extraction-',
  'skill-sheet-latest-',
  'skill-sheet-note-',
  'skill-sheet-preview-',
  'skill-sheet-preview-body-notice-',
  'skill-sheet-preview-error-',
  'skill-sheet-preview-panel-',
  'skill-sheet-row-',
  'skill-sheet-scan-status-',
  'skill-sheet-set-latest-',
  'skill-sheet-share-',
];

describe('🔴 data-testid インベントリの凍結（SP-21 T-21-01 ③）', () => {
  it('走査が空振りしていない（対照）', () => {
    // 🔴 抽出器が壊れて 0 件になったとき、「削除が無い」も自明に真になってしまう。
    //    件数の下限をここで押さえる（2026-09-10 の実測は 59 ファイル / 425 箇所）。
    expect(scannedFiles.length).toBeGreaterThanOrEqual(50);
    expect(totalOccurrences).toBeGreaterThanOrEqual(400);
  });

  it('凍結リスト自体が重複を持たず、昇順に並んでいる（差分を読める形に保つ）', () => {
    expect(new Set(FROZEN_EXACT).size).toBe(FROZEN_EXACT.length);
    expect(new Set(FROZEN_PREFIXES).size).toBe(FROZEN_PREFIXES.length);
    expect([...FROZEN_EXACT]).toEqual([...FROZEN_EXACT].sort());
    expect([...FROZEN_PREFIXES]).toEqual([...FROZEN_PREFIXES].sort());
  });

  it('凍結リストの値が命名規約（kebab-case）に従っている', () => {
    expect(FROZEN_EXACT.filter((value) => !TESTID_PATTERN.test(value))).toEqual([]);
    expect(FROZEN_PREFIXES.filter((value) => !TESTID_PREFIX_PATTERN.test(value))).toEqual([]);
  });

  it('🔴 凍結された data-testid が 1 つも消えていない（削除・改名 0 件）', () => {
    const missing = FROZEN_EXACT.filter((value) => !presentExact.has(value));
    expect(
      missing,
      `凍結済みの data-testid が ${missing.length} 件、apps/web から消えています: ` +
        `${missing.join(', ')}\n` +
        '🔴 整形（SP-21）で testid を削除・改名してはいけません（T-21-04 の受け入れ基準 (1)）。' +
        'E2E 35 本と *.render.test.tsx 13 本がこの値で要素を掴んでおり、' +
        '**落ちずに回帰検知だけが静かに消える**経路があります。' +
        'testid を別パッケージへ移した場合は SCAN_ROOTS に足してください（凍結リストから消さない）。',
    ).toEqual([]);
  });

  it('🔴 凍結された動的 testid の接頭辞が 1 つも消えていない', () => {
    const missing = FROZEN_PREFIXES.filter((value) => !presentPrefixes.has(value));
    expect(
      missing,
      `凍結済みの testid 接頭辞が ${missing.length} 件、apps/web から消えています: ` +
        `${missing.join(', ')}\n` +
        '行ごとに値が変わる testid（例: `engineer-list-row-${row.id}`）の接頭辞です。' +
        '接頭辞が変わると、その一覧の行を掴んでいる E2E がすべて外れます。',
    ).toEqual([]);
  });

  it('🔴 静的に解決できない data-testid が許可リストの外に増えていない', () => {
    const offenders = scannedFiles
      .filter((file) => file.extraction.unresolved.length > 0)
      .map((file) => file.label)
      .filter((label) => !UNRESOLVED_ALLOWLIST.includes(label));
    expect(
      offenders,
      `静的に解決できない data-testid={...} が新たに ${offenders.length} ファイルで見つかりました: ` +
        `${offenders.join(', ')}\n` +
        '🔴 値が凍結できない testid はこの安全網の穴です。' +
        '呼び出し側に `testId="..."` の形で文字列リテラルを残してください。',
    ).toEqual([]);
  });

  it('許可リストのファイルが実在し、実際に解決できない形を持っている（陳腐化の検知）', () => {
    // 🔴 許可リストが実態と合わなくなると、「許可した覚えのない穴」が残り続ける。
    for (const label of UNRESOLVED_ALLOWLIST) {
      const file = scannedFiles.find((candidate) => candidate.label === label);
      expect(file, `${label} が走査対象に見つかりません（移動・削除された？）`).toBeDefined();
      expect(
        file?.extraction.unresolved.length ?? 0,
        `${label} は解決できない data-testid を持たなくなりました。UNRESOLVED_ALLOWLIST から外してください。`,
      ).toBeGreaterThan(0);
    }
  });

  it('サインイン経路の testid が凍結されている（E2E 35 本の前提。SP-21 §3.1-12）', () => {
    // 🔴 ここが欠けると E2E が全滅する。凍結リストの生成がこの値を取りこぼしていないことを、
    //    リストの中身とは独立に名指しで確認する。
    for (const value of [
      'signin-email',
      'signin-password',
      'signin-2fa-code',
      'signin-submit',
      'signin-2fa-submit',
      'admin-signin-email',
      'admin-signin-password',
      'admin-signin-2fa-code',
      'admin-signin-submit',
      'admin-signin-2fa-submit',
    ]) {
      expect(FROZEN_EXACT, `${value} が凍結リストにありません`).toContain(value);
      expect(presentExact, `${value} が apps/web から消えています`).toContain(value);
    }
  });
});

describe('抽出器そのものの検査（fixtures。空振り・取りこぼしの対照）', () => {
  const fixturesDir = path.join(here, '__fixtures__', 'testid-inventory');
  const sample = readFileSync(path.join(fixturesDir, 'sample.tsx'), 'utf8');
  const extraction = extractTestIds(sample);

  it('文字列リテラル・テンプレートの接頭辞・三項演算子の枝・testId プロパティを拾う', () => {
    expect([...new Set(extraction.exact)].sort()).toEqual([
      'plain-double-quoted',
      'plain-single-quoted',
      'template-without-hole',
      'ternary-when-false',
      'ternary-when-true',
      'via-test-id-prop',
    ]);
    expect([...new Set(extraction.prefixes)].sort()).toEqual(['dynamic-row-', 'nested-cell-']);
  });

  it('🔴 比較のオペランド（`=== ROLE`）を testid として拾わない', () => {
    expect(extraction.exact).not.toContain('role-enum-value');
  });

  it('素の識別子は解決できないものとして報告する（穴として数える）', () => {
    // 呼び出し側の `<span data-testid={passthroughTestId} />` と、
    // 受け取り側の `<span data-testid={testId} />`（`OtpauthQr` と同じ形）の 2 つ。
    expect(extraction.unresolved).toEqual(['passthroughTestId', 'testId']);
  });

  it('`data-testid` に似た別属性（`data-testid-note`）を拾わない', () => {
    expect(extraction.exact).not.toContain('not-a-testid');
  });
});
