// tests/static/auth-db-callers.test.ts
// T-03-01（docs/sprints/SP-03-auth-audit-admin0.md）。docs/05 §17.2 の方針（#3 / #20）に倣い、
// **認証コンテキストを組み立てられる場所**をコードの構造として固定する。
//
// 🔴 なぜ要るか（CLAUDE.md §3.1 / BR-03 / F-003 AC-1）:
//    `AuthenticatedTenantCtx` はブランド型で「`resolveTenantCtx` 以外が作れない」が、
//    **`resolveTenantCtx` 自体をどこからでも呼べる**なら、ハンドラが自前でセッションを解釈し、
//    ロールを詰めた ctx を組み立てられてしまう。呼び出し元を `apps/web/lib/auth/**` に限定し、
//    「セッション → ctx」の写像を 1 本に保つ。
//
// 🔴 `apps/worker/**` に `resolveTenantCtx` が現れないことも見る（docs/05 §17.2 #20 ①の前提。
//    ワーカーの ctx は常に `systemTenantCtx` であり、パートナー文脈を持てないことの根拠）。
//
// 🔴 対象ファイルは列挙せず、`apps/**` を走査して求める（新しいファイルが検査から漏れない）。
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const appsDir = path.join(repoRoot, 'apps');

const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.turbo']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(full);
    }
    return SOURCE_EXTENSIONS.includes(path.extname(entry.name)) ? [full] : [];
  });
}

function toRepoRelative(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/**
 * 🔴 検査対象は **apps/** の非テストソース**である。
 *    ユニットテストは `vi.mock('@ses/db', …)` のように禁止対象の識別子を
 *    「モックの定義」として書く（`apps/web/lib/auth/credentials.test.ts`）。これは呼び出し経路ではなく、
 *    ここで落とすと「テストを書くと lint 相当の検査が落ちる」状態になり、検査自体が形骸化する。
 *    テストファイルは出荷されないため、境界の担保は非テストソースの走査で足りる。
 */
function isTestFile(absolutePath: string): boolean {
  return /\.test\.(ts|tsx|mts|cts)$/.test(absolutePath);
}

const allAppFiles = listSourceFiles(appsDir);
const appSourceFiles = allAppFiles.filter((file) => !isTestFile(file));

/**
 * コメント（`/* … *\/` と `//`）を落としたソース。
 * 設計意図をコメントに書いた行で検査が落ちないようにするための前処理であり、
 * 判定そのものは「コードとして書かれているか」だけを見る。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.split('//')[0] ?? '')
    .join('\n');
}

/** `identifier` に**コード上で**言及しているファイル（import・呼び出しのどちらでも）を返す。 */
function filesMentioning(identifier: string): string[] {
  const pattern = new RegExp(`\\b${identifier}\\b`);
  return appSourceFiles
    .filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))))
    .map(toRepoRelative)
    .sort();
}

/** 🔴 それぞれの関数を呼んでよい場所（docs/05 §4.3 / §4.4.2 / §8.6 / §16.1）。 */
const ALLOWED_CALLERS: Readonly<Record<string, readonly string[]>> = {
  // 認証コンテキストの唯一の生成箇所。
  resolveTenantCtx: ['apps/web/lib/auth/tenant-context.ts'],
  loadTenantMembership: ['apps/web/lib/auth/tenant-context.ts'],
  // テナント確定前の限定スコープ（docs/05 §4.4.2）。サインインの照合だけが使う。
  withAuthLookup: ['apps/web/lib/auth/credentials.ts'],
  // 🔴 T-03-03: 行由来コンテキスト（docs/05 §4.4.2）。**未認証の HTTP 経路が触れる唯一の DB 入口**
  //    であり、呼び出し元が増えるほど「トークン照合で得た行以外を分離キーにする」実装が
  //    書けてしまう。docs/05 §4.4.2 ④は呼び出し元を Route Handler に限定すると書いているが、
  //    本リポジトリは T-03-01 以来「DB に触れるロジックは lib に置き、`app/**` からは呼ばない」
  //    形を採っている（結合テストがサーバを立てずに同じ経路を実行できるようにするため。
  //    `withAuthLookup` × `credentials.ts` と同じ）。ファイル数を 1 経路 1 ファイルに保つ点は同じ。
  withInvitationToken: ['apps/web/lib/invitations/service.ts'],
  withInvitationAccept: ['apps/web/lib/invitations/service.ts'],
  withPasswordResetIssue: ['apps/web/lib/auth/password-reset.ts'],
  withPasswordResetConfirm: ['apps/web/lib/auth/password-reset.ts'],
  // 認証の成否の記録（docs/05 §16.1）。サインイン / サインアウトと 2FA の失敗記録だけが使う。
  recordAuthAuditLog: [
    'apps/web/lib/auth/credentials.ts',
    'apps/web/lib/auth/two-factor.ts',
  ],
  // 🔴 T-03-02: `two_factor_credentials` に触れる経路（docs/05 §6.3 #2 / #3）。
  //    RLS の C7 SELF が本人の 1 行に閉じているが、呼び出し元も 1 ファイルに固定する
  //    （「2FA を無効化する API」が別の場所から生えるのを防ぐ）。
  readTwoFactorCredential: ['apps/web/lib/auth/two-factor.ts'],
  // 🔴 監査ログの自己参照カウント（試行スロットル）。ホスト文脈で読む唯一の経路であり、
  //    ここを増やすと「本人以外の監査ログを数える」実装が書けてしまう。
  readRecentTwoFactorFailures: ['apps/web/lib/auth/two-factor.ts'],
  startTwoFactorEnrollment: ['apps/web/lib/auth/two-factor.ts'],
  confirmTwoFactorEnrollment: ['apps/web/lib/auth/two-factor.ts'],
  consumeRecoveryCode: ['apps/web/lib/auth/two-factor.ts'],
  // 🔴 T-03-02: 秘匿値の暗号化（docs/05 §8.6）。暗号化・復号を行ってよい場所を固定する。
  EncryptedString: ['apps/web/lib/auth/two-factor.ts'],
  // 🔴 鍵の注入は起動時の 1 箇所だけ（CLAUDE.md §11.1 / docs/05 §13.1）。
  configureTokenEncryption: ['apps/web/lib/db/bootstrap.ts'],
};

describe('認証コンテキストを組み立てられる場所を固定する（CLAUDE.md §3.1 / F-003 AC-1）', () => {
  it('対照: apps/** に走査対象のソースが存在する（このテスト自体が空振りしていない）', () => {
    expect(appSourceFiles.length).toBeGreaterThan(0);
  });

  it('対照: テストファイルの除外が走査対象を消し去っていない（除外は一部にとどまる）', () => {
    expect(allAppFiles.length).toBeGreaterThan(appSourceFiles.length);
    expect(appSourceFiles.length / allAppFiles.length).toBeGreaterThan(0.5);
  });

  it.each(Object.entries(ALLOWED_CALLERS))(
    '%s を参照するのは許可された場所だけである',
    (identifier, allowed) => {
      expect(filesMentioning(identifier)).toEqual([...allowed].sort());
    },
  );

  it('🔴 apps/worker/** に resolveTenantCtx の参照が無い（docs/05 §17.2 #20 ①）', () => {
    const workerFiles = filesMentioning('resolveTenantCtx').filter((file) =>
      file.startsWith('apps/worker/'),
    );
    expect(workerFiles).toEqual([]);
  });

  it('🔴 apps/web/app/** （ルート・ページ）が resolveTenantCtx を直接呼ばない', () => {
    const routeFiles = filesMentioning('resolveTenantCtx').filter((file) =>
      file.startsWith('apps/web/app/'),
    );
    expect(routeFiles).toEqual([]);
  });
});

/**
 * 🔴 docs/03 §4.9 のリスク回避策:「Auth.js v5 は API が変わりうる。**認証のラッパを
 *    `apps/web/lib/auth` の 1 箇所に閉じ、ページ・API から Auth.js の型を直接参照しない**」。
 *    これを規約文ではなく検査にする。
 */
function filesImporting(moduleName: string): string[] {
  const pattern = new RegExp(
    `(?:from|import|require)\\s*\\(?\\s*['"]${moduleName}(?:/[^'"]*)?['"]`,
  );
  return appSourceFiles
    .filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))))
    .map(toRepoRelative)
    .sort();
}

describe('Auth.js（next-auth）の参照を apps/web/lib/auth/** に閉じる（docs/03 §4.9）', () => {
  it('next-auth を import しているのは lib/auth/** だけである', () => {
    const importers = filesImporting('next-auth');
    expect(importers.length).toBeGreaterThan(0); // 空振り防止
    for (const file of importers) {
      expect(file.startsWith('apps/web/lib/auth/')).toBe(true);
    }
  });

  it('@auth/core を直接 import しているファイルが無い（next-auth 越しにのみ使う）', () => {
    expect(filesImporting('@auth/core')).toEqual([]);
  });
});
