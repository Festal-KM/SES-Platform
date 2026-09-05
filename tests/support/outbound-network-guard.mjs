// tests/support/outbound-network-guard.mjs
// 🔴 docs/05 §17.4 の「外部エンドポイントへの発信が 0 件」を**実装が正しい前提を置かずに**
//    確かめるための遮断フック（`net.Socket.prototype.connect` を包み、ループバック以外への
//    接続をその場で失敗させる）。
//
// 🔴 ここは**遮断そのものの実装 1 箇所**である。2 つの利用者がいる:
//    ① `tests/e2e/harness/network-guard.mjs` … `node --import` でアプリのプロセスに先読みさせる
//       （docs/05 §17.6 ⑥。プロセス起動時に 1 回だけ入れ、外さない）
//    ② `tests/isolation/env-separation.test.ts` … 結合テストのプロセスに一時的に入れ、
//       送信の検証が終わったら外す（Testcontainers / Docker の後始末を巻き込まないため）
//    🔴 遮断の判定（何を許すか）を 2 箇所に書くと、片方だけ緩めたときに「E2E では止まるが
//       結合テストでは素通り」という差が生まれ、どちらの green も根拠にならなくなる。
//
// ⚠️ 追跡できない残余（意図的。code-reviewer / pm への申し送り）:
//    Prisma の Rust クエリエンジンや他のネイティブアドオンは Node の `net` を経由せずに
//    ソケットを開くため、このフックからは見えない（接続先は 127.0.0.1 のテストコンテナのみ）。
//
// 🔴 CommonJS ではなく ESM で書く理由: `NODE_OPTIONS` に渡すパスは `pathToFileURL` で
//    percent-encode した `file://` URL にする（リポジトリのパスに空白が含まれても壊れない）。
//    🔴 `.ts` ではなく `.mjs` にする理由: ① の経路は Node の型除去に依存させたくない
//    （アプリ本体の起動より前に読み込まれる唯一のコードであり、実行系を増やさない）。
import net from 'node:net';

/** ループバックだけを許可する（DB / MinIO / MailHog / Docker はすべて 127.0.0.1 か Unix ソケット）。 */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '']);

/** 自己診断で使う到達不能なアドレス（RFC 5737 TEST-NET-2。実在しない）。 */
export const OUTBOUND_PROBE_HOST = '198.51.100.7';

export class OutboundNetworkBlockedError extends Error {
  constructor(host) {
    super(
      `外向きの通信を遮断しました（host=${host}）。` +
        '非本番環境では外部エンドポイントへ発信してはいけません（CLAUDE.md §11.1 / docs/05 §17.4）。',
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
  if (typeof options.path === 'string') return; // Unix ドメインソケット / Windows の名前付きパイプ
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

/**
 * 遮断フックを差し込む。戻り値を呼ぶと**元に戻る**。
 *
 * 🔴 復元できる形にしてあるのは結合テスト（利用者②）のためである。Vitest のワーカーは
 *    テストファイルをまたいで再利用されうるので、`node:net` への細工を残すと
 *    後続のファイル（Testcontainers の後始末を含む）へ漏れる。
 */
export function installOutboundNetworkGuard() {
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    assertAllowed(normalizeArgs(args));
    return original.apply(this, args);
  };
  return () => {
    net.Socket.prototype.connect = original;
  };
}

/**
 * 🔴 自己診断: フックが実際に効いているか（「読み込まれたが効いていない」状態で green に
 *    なることを防ぐ = 空振り防止）。到達不能アドレスへの接続がその場で例外になれば真。
 */
export function isOutboundBlocked() {
  try {
    // 遮断が効いていなければソケットが返る（実際の接続は成立しない相手だが、開いたままにしない）。
    net.connect({ host: OUTBOUND_PROBE_HOST, port: 80 }).destroy();
  } catch (error) {
    return error instanceof OutboundNetworkBlockedError;
  }
  return false;
}
