// tests/e2e/harness/network-guard.mjs
// 🔴 docs/05 §17.6 globalSetup の ⑥「外向きネットワークの遮断を確認」/ §17.4
//    「実エンドポイントへの発信が 0 件であることを確認する」の実装。
//
// アプリのプロセスに `node --import <このファイル>` で**アプリコードより先に**読み込ませ、
// `net` の接続要求をフックして **ループバック以外への発信をその場で失敗させる**。
// docs/05 §17.4 は「コンテナのネットワークを外向き遮断（`--network none` 相当）」と書いているが、
// E2E ではアプリをホスト上のプロセスとして起動する（DB は Testcontainers が割り当てた
// 127.0.0.1 のランダムポートにある）ため、プロセス境界で同じ効果を作る。
//
// 🔴 「モックが呼ばれたこと」ではなく「外に出ていないこと」を見るための仕掛けである。
//    APP_ENV=development ではコネクタがすべてモックに解決される（`resolveConnectorSelection`）が、
//    それは**実装が正しい前提**の検証にすぎない。ここは実装が誤っていても発信を止める。
//
// ⚠️ 追跡できない残余（意図的。code-reviewer / pm への申し送り）:
//    Prisma の Rust クエリエンジンや他のネイティブアドオンは Node の `net` を経由せずに
//    ソケットを開くため、このフックからは見えない。Prisma の接続先は 127.0.0.1（テスト
//    コンテナ）であり本件の関心事ではないが、「Node の I/O だけを塞いでいる」ことは明示しておく。
//
// 🔴 CommonJS ではなく ESM で書く理由: `NODE_OPTIONS` に渡すパスは `pathToFileURL` で
//    percent-encode した `file://` URL にする（リポジトリのパスに空白が含まれても壊れない）。
//    `require` / `module` などの暗黙のグローバルにも依存しない。
import net from 'node:net';
import process from 'node:process';

/** ループバックだけを許可する（DB / MinIO / MailHog はすべて 127.0.0.1）。 */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '']);

/**
 * globalSetup がこの行を待って「遮断が有効である」ことを確認する。
 * 🔴 目印は**起動のたびに globalSetup が生成した値**を環境変数で受け取る。
 *    文字列リテラルを 2 箇所に書くと、片方を変えたときに「待っているのに永久に来ない」
 *    という分かりにくい失敗になる。未設定なら起動を失敗させる（黙って素通りさせない）。
 */
const READY_MARKER = process.env.SES_E2E_GUARD_MARKER;
/** 自己診断で使う到達不能なアドレス（RFC 5737 TEST-NET-2。実在しない）。 */
const PROBE_HOST = '198.51.100.7';

export class OutboundNetworkBlockedError extends Error {
  constructor(host) {
    super(
      `E2E: 外向きの通信を遮断しました（host=${host}）。` +
        'APP_ENV=development では外部エンドポイントへ発信してはいけません（CLAUDE.md §11.1 / docs/05 §17.4）。',
    );
    this.name = 'OutboundNetworkBlockedError';
  }
}

function isAllowed(host) {
  if (typeof host !== 'string') return true; // ホスト指定が無い = Unix ソケット等
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  return ALLOWED_HOSTS.has(normalized) || normalized.startsWith('127.');
}

function assertAllowed(options) {
  // net.connect の引数は (options) / (port, host) / (path) の 3 形態がある。
  if (options === null || typeof options !== 'object') return;
  if (typeof options.path === 'string') return; // Unix ドメインソケット
  if (!isAllowed(options.host)) throw new OutboundNetworkBlockedError(String(options.host));
}

/**
 * `net.Socket.prototype.connect` の引数を正規化する。
 *
 * 🔴 4 形態ある。`(port, host)` / `(path)` / `(options)` に加えて、
 *    **`net.connect()` 経由の呼び出しは `[options, callback]` という配列 1 個**を渡してくる
 *    （Node 本体の `normalizeArgs()` の戻り値をそのまま `Socket.prototype.connect` に渡すため）。
 *    この形を取りこぼすと `fetch` / `http` / `undici` 経由の発信をすべて素通しする。
 */
function normalizeArgs(args) {
  const [first, second] = args;
  if (Array.isArray(first)) return normalizeArgs(first);
  if (typeof first === 'object' && first !== null) return first;
  if (typeof first === 'number') {
    return { port: first, host: typeof second === 'string' ? second : 'localhost' };
  }
  if (typeof first === 'string') return { path: first };
  return null;
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  assertAllowed(normalizeArgs(args));
  return originalConnect.apply(this, args);
};

// 自己診断: フックが実際に効いていることを、起動時に 1 回だけ確かめる。
// 🔴 「読み込まれたが効いていない」状態で green になることを防ぐ（空振り防止）。
let blocked = false;
try {
  net.connect({ host: PROBE_HOST, port: 80 });
} catch (error) {
  blocked = error instanceof OutboundNetworkBlockedError;
}
if (!blocked) {
  process.stderr.write('[e2e-network-guard] 自己診断に失敗しました（フックが効いていません）\n');
  process.exit(1);
}
if (typeof READY_MARKER !== 'string' || READY_MARKER === '') {
  process.stderr.write('[e2e-network-guard] SES_E2E_GUARD_MARKER が未設定です\n');
  process.exit(1);
}
process.stdout.write(`${READY_MARKER}\n`);
