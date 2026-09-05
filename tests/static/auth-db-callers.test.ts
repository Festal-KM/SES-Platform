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
  //    T-03-07 で 2FA の判断ロジックを `two-factor-core.ts` に抽出したため、
  //    暗号化・復号もそこ 1 ファイルに集約された（主平面・管理平面のどちらも core を通る）。
  EncryptedString: ['apps/web/lib/auth/two-factor-core.ts'],
  // 🔴 鍵の注入は起動時の 1 箇所だけ（CLAUDE.md §11.1 / docs/05 §13.1）。
  configureTokenEncryption: ['apps/web/lib/db/bootstrap.ts'],
  // 🔴 T-03-10: ジョブ文脈（docs/05 §9.2）。**`apps/web` から呼べてはならない** ——
  //    呼べると、HTTP 経路がリクエスト入力の `tenantId` で任意のテナントの文脈を作れる
  //    （`CLAUDE.md` §3.1 / `BR-03`）。許可先は `apps/worker` のジョブ実装だけである。
  //    docs/05 §9.2 の ⚠️「この関数を `apps/web` から呼べないよう制限する」の実装。
  systemTenantCtx: [
    'apps/worker/src/jobs/usage-seat-snapshot.ts',
    // 🔴 T-04-03: 運用メールのジョブ（docs/05 §9.4）。どちらも payload の `tenantId` から
    //    ジョブ文脈を組み立てる。**`apps/web` 側には 1 つも無い**（下の it が固定する）。
    'apps/worker/src/jobs/account-mail.ts',
    'apps/worker/src/jobs/email-dispatch.ts',
  ],
  // 🔴 T-03-10: `usage_counters` を書く唯一の経路（docs/05 §7.6 / §9.8）。
  //    ここを増やすと「計測を迂回した書き込み」が生まれ、原価と請求根拠が説明できなくなる。
  snapshotSeatCount: ['apps/worker/src/jobs/usage-seat-snapshot.ts'],
  incrementUsageCounter: [],

  // --- 🔴 T-04-03: 運用メールと Webhook 受信（docs/05 §8.5 / §9.4）--------------------------
  // 🔴 `EmailDispatch` を作る経路を 1 ファイルに固定する。増えると `dedupeKey` の組み立てが
  //    分散し、「再試行しても 1 通」の根拠（`UNIQUE`）を迂回する INSERT が書けてしまう。
  reserveEmailDispatch: ['apps/worker/src/jobs/account-mail.ts'],
  readEmailDispatch: ['apps/worker/src/jobs/email-dispatch.ts'],
  // 🔴 送信の 1 手順（判定 → 予約 → 送信 → CAS）は `email-send.ts` の 1 箇所だけが持つ。
  //    `email.dispatch` と `account.mail` で順序を書き分けると、片方だけ保留や上限が緩む。
  readEmailDailyCount: ['apps/worker/src/jobs/email-send.ts'],
  reserveEmailDailyQuota: ['apps/worker/src/jobs/email-send.ts'],
  holdEmailDispatch: ['apps/worker/src/jobs/email-send.ts'],
  suppressEmailDispatch: ['apps/worker/src/jobs/email-send.ts'],
  failEmailDispatch: ['apps/worker/src/jobs/email-send.ts'],
  markEmailDispatchSent: ['apps/worker/src/jobs/email-send.ts'],
  markEmailDispatchMocked: ['apps/worker/src/jobs/email-send.ts'],
  // 🔴 `DispatchToken` を作れる場所（docs/05 §10.2 / `packages/connectors/src/types.ts`）。
  //    予約（`reserveEmailDispatch`）の結果からしか作らない ——
  //    ここが増えると「行が無いのに送れるトークン」を組み立てられる。
  dispatchTokenFor: ['apps/worker/src/jobs/email-send.ts'],
  // 🔴 Webhook 受信は「検証 → INSERT → 200 → enqueue」の 1 経路だけ（docs/05 §8.5）。
  recordWebhookDelivery: ['apps/web/lib/webhooks/ses.ts'],
  readWebhookDelivery: ['apps/worker/src/jobs/webhook-process.ts'],
  markWebhookDeliveryProcessed: ['apps/worker/src/jobs/webhook-process.ts'],
  markWebhookDeliveryFailed: [
    'apps/web/lib/webhooks/ses.ts',
    'apps/worker/src/jobs/webhook-process.ts',
  ],
  recordEmailEvent: ['apps/worker/src/jobs/webhook-process.ts'],
  // 🔴 T-03-10: `PLATFORM_OWNER` 専用操作のゲート（`CLAUDE.md` §10.1 / `BR-44`）。
  //    ロール判定を各ルートに散らさない（散らすと 1 本だけ緩む）。
  requirePlatformOwner: ['apps/web/lib/auth/platform-session.ts'],
  // 🔴 T-04-02: メール送信の単一経路の宛先分類（docs/05 §8.2）。呼び出し元を固定するのは
  //    「分類を導く場所」を数えられる状態に保つためである。ここが散ると、どこかで
  //    `resolveRecipientClass` を通さずに分類を組み立てる実装（= 自己申告）が紛れ込む。
  //    T-04-03 以降で送信経路が増えたら、その 1 ファイルをここに追記する。
  resolveRecipientClass: ['apps/web/lib/invitations/service.ts'],
  // 🔴 分類外（運営者宛）を名乗れる場所は `apps/**` に 1 つも無い（`@ses/db/platform` にしか
  //    export されておらず、テナント側のコードからは import 経路そのものが無い）。
  platformRecipientClass: [],

  // --- 🔴 T-03-07: 管理平面（運営者認証。`F-055` / `BR-36`）------------------------------
  // 主平面と**同じ規律**を管理平面にも適用する。運営者の資格情報・2FA・監査ログに触れる経路が
  // ファイル単位で固定されていないと、「運営者の 2FA を無効化する API」が別の場所から生える。
  configurePlatformWriteDb: ['apps/web/lib/db/bootstrap.ts'],
  // 🔴 T-03-08: 管理平面の読み取り専用プール（`app_platform`）。初期化は起動時の 1 箇所だけ。
  configurePlatformReadDb: ['apps/web/lib/db/bootstrap.ts'],
  // 🔴 T-03-08: **`apps/**` から `withPlatform*` を 1 箇所も呼ばない**（期待値が空配列）。
  //    分離バイパスの呼び出しは `packages/db/src/platform/queries/*.ts`（画面と 1 対 1 の
  //    専用クエリ関数。docs/05 §5.2「汎用エスケープハッチを作らない担保」）に閉じる。
  //    ESLint（`@ses/db/platform` の import 制限）と合わせて二重に固定する
  //    —— lint はゾーン設定の書き換えで緩みうるが、この走査は「実際に書かれているか」を見る。
  withPlatformRead: [],
  withPlatformWrite: [],
  withPlatformAuthLookup: ['apps/web/lib/auth/platform-credentials.ts'],
  loadPlatformUserFacts: ['apps/web/lib/auth/platform-context.ts'],
  resolvePlatformCtx: ['apps/web/lib/auth/platform-context.ts'],
  recordPlatformAuditLog: [
    'apps/web/lib/auth/platform-credentials.ts',
    'apps/web/lib/auth/platform-two-factor.ts',
  ],
  readPlatformTwoFactorCredential: ['apps/web/lib/auth/platform-two-factor.ts'],
  readRecentPlatformTwoFactorFailures: ['apps/web/lib/auth/platform-two-factor.ts'],
  startPlatformTwoFactorEnrollment: ['apps/web/lib/auth/platform-two-factor.ts'],
  confirmPlatformTwoFactorEnrollment: ['apps/web/lib/auth/platform-two-factor.ts'],
  consumePlatformRecoveryCode: ['apps/web/lib/auth/platform-two-factor.ts'],
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

  it('🔴 apps/web/** に systemTenantCtx の参照が無い（docs/05 §9.2 の ⚠️）', () => {
    const webFiles = filesMentioning('systemTenantCtx').filter((file) =>
      file.startsWith('apps/web/'),
    );
    expect(webFiles).toEqual([]);
  });

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

  it('🔴 apps/web/app/** （ルート・ページ）が resolvePlatformCtx を直接呼ばない（T-03-07）', () => {
    const routeFiles = filesMentioning('resolvePlatformCtx').filter((file) =>
      file.startsWith('apps/web/app/'),
    );
    expect(routeFiles).toEqual([]);
  });
});

/**
 * 🔴 T-03-07 / `F-055 AC-2`「テナント利用者の認証情報で `/admin` に到達できず、逆も成立しない」。
 *    実行時の担保（別 Cookie 名 / 別署名鍵 / 別インスタンス / 別 DB ロール）は
 *    `tests/isolation/platform-auth.test.ts` が実証する。ここでは**構造**を固定する ——
 *    2 平面のルートが互いの認証入口を 1 つも参照していないこと。
 *    参照が生まれた時点で「片方のセッションでもう片方に入れる」実装が書けるようになる。
 */
describe('主平面と管理平面のルートが互いの認証入口を参照しない（F-055 AC-2 / BR-36）', () => {
  /** 主平面の認証入口（`app/(main)/**` と `app/api/(main)/**` だけが使ってよい）。 */
  const MAIN_PLANE_ENTRYPOINTS = [
    'currentClaims',
    'requireTenantCtx',
    'resolveTenantCtxOutcome',
    'markTwoFactorVerified',
    'signInWithCredentials',
  ];

  /** 管理平面の認証入口（`app/admin/**` と `app/api/admin/**` だけが使ってよい）。 */
  const PLATFORM_PLANE_ENTRYPOINTS = [
    'currentPlatformClaims',
    'requirePlatformCtx',
    'resolvePlatformCtxOutcome',
    'markPlatformTwoFactorVerified',
    'signInPlatformWithCredentials',
  ];

  function routeFilesUnder(prefixes: readonly string[], identifier: string): string[] {
    return filesMentioning(identifier).filter(
      (file) => file.startsWith('apps/web/app/') && prefixes.some((p) => file.startsWith(p)),
    );
  }

  it('対照: 管理平面のルートは管理平面の入口を実際に使っている（空振り防止）', () => {
    const used = PLATFORM_PLANE_ENTRYPOINTS.filter(
      (id) => routeFilesUnder(['apps/web/app/admin/', 'apps/web/app/api/admin/'], id).length > 0,
    );
    expect(used.length).toBeGreaterThan(0);
  });

  it.each(MAIN_PLANE_ENTRYPOINTS)(
    '🔴 管理平面のルートが主平面の入口 %s を参照しない',
    (identifier) => {
      expect(
        routeFilesUnder(['apps/web/app/admin/', 'apps/web/app/api/admin/'], identifier),
      ).toEqual([]);
    },
  );

  it.each(PLATFORM_PLANE_ENTRYPOINTS)(
    '🔴 主平面のルートが管理平面の入口 %s を参照しない',
    (identifier) => {
      expect(
        routeFilesUnder(['apps/web/app/(main)/', 'apps/web/app/api/(main)/'], identifier),
      ).toEqual([]);
    },
  );
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
