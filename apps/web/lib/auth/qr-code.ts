// apps/web/lib/auth/qr-code.ts
// QR コード（ISO/IEC 18004 モデル 2 / バイトモード / 誤り訂正レベル M）の最小エンコーダ。
// `S-001` `A-001` の 2 要素認証 登録ウィザードが、`otpauth://` URL を認証アプリのカメラで
// 読み取れる形に描くために使う（docs/04 §S-001 セクション 3 / §A-001 セクション 3）。
//
// 🔴 **外部の QR 生成 API・CDN・画像サービスに `otpauth://` URL を渡してはならない。**
//    この文字列は TOTP のシークレットそのものを含む（`totp.ts` の `buildOtpauthUrl`）。
//    外部サービスに渡す実装は「シークレットを第三者へ送信した」ことと同義であり、
//    `CLAUDE.md` §3.5 / §7（シークレット・PII の外部流出は 0 件）の重大事故になる。
//    そのため生成経路をこのモジュール 1 本に閉じ、**ネットワーク I/O を 1 つも持たない
//    純粋関数**にしてある。ここに fetch / Image / 外部 URL の組み立てを足さないこと。
//
// 🔴 依存を増やさずに自前実装している。理由は 2 つ:
//    ① 同じ理由で RFC 4226 / 6238 を自前実装した `totp.ts` と同じ規律（2 要素認証の材料を
//       外部コードの手に渡さない）を保つため
//    ② この関数はクライアントバンドルに載る。必要なのは決定的なモジュール行列だけであり、
//       外部ライブラリが抱える canvas / PNG 生成 / CLI 依存は要らない
//    正しさは `qr-code.test.ts` が**参照実装（Python `qrcode`）の出力とのビット単位の一致**で
//    担保する（8 種のマスクすべて + 実際の `otpauth://` URL）。
//
// 実装は ISO/IEC 18004 の手順そのままである:
//   ① バイト列化 → ② 型番の決定 → ③ データ符号語（モード / 文字数 / 本体 / 埋め草）
//   → ④ ブロック分割と Reed-Solomon 誤り訂正符号語 → ⑤ インターリーブ
//   → ⑥ 機能パターンの描画 → ⑦ データのジグザグ配置 → ⑧ マスク選択 → ⑨ 形式情報・型番情報

/** 生成した QR コード。`modules[y][x]` が `true` なら暗モジュール。クワイエットゾーンは含まない。 */
export type QrCode = {
  /** 一辺のモジュール数（`17 + 4 × 型番`）。 */
  readonly size: number;
  readonly modules: readonly (readonly boolean[])[];
  /** 選択されたマスクパターン（0〜7）。形式情報に書かれる値。 */
  readonly maskPattern: number;
  /** 型番（1〜20）。 */
  readonly version: number;
};

export type EncodeQrCodeOptions = {
  /**
   * マスクパターンを固定する（0〜7）。既定は減点法（ISO/IEC 18004 8.8.2）による自動選択。
   * 🔴 出力を決定的にしたいテスト・参照実装との突き合わせのために公開している。
   *    画面表示では既定（自動選択）を使う —— 固定すると、内容によっては読み取りにくい模様
   *    （大きな同色の塊や、偽の位置検出パターン）を選び続けることになる。
   */
  readonly maskPattern?: number;
};

const MIN_VERSION = 1;
/**
 * 対応する最大の型番。20（レベル M・バイトモードで 666 バイト）まで持てば、`otpauth://` URL の
 * 最長ケース（発行者名に日本語を含む運営者コンソール = パーセントエンコードで 1 文字 9 バイト。
 * 実測 290 バイト）でも 2 倍以上の余裕がある。これを超える入力は `null` を返し、
 * 呼び出し側は手入力用の表示だけを出す。
 */
const MAX_VERSION = 20;

/** 誤り訂正レベル M の形式情報ビット（ISO/IEC 18004 表 12）。本モジュールは M のみを扱う。 */
const EC_LEVEL_FORMAT_BITS = 0b00;

/** レベル M のブロックあたり誤り訂正符号語数（型番 1〜20。添字 0 は番兵）。 */
const EC_CODEWORDS_PER_BLOCK: readonly number[] = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
];
/** レベル M の誤り訂正ブロック数（型番 1〜20。添字 0 は番兵）。 */
const EC_BLOCK_COUNT: readonly number[] = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
];

/** バイトモードのモード指示子（ISO/IEC 18004 表 2）。 */
const MODE_BYTE = 0b0100;
/** 埋め草符号語（ISO/IEC 18004 8.4.9）。 */
const PAD_CODEWORDS: readonly number[] = [0xec, 0x11];
/** GF(2^8) の原始多項式 x^8 + x^4 + x^3 + x^2 + 1。 */
const GF_PRIMITIVE = 0x11d;

const MASK_COUNT = 8;
const PENALTY_ADJACENT = 3;
const PENALTY_BLOCK = 3;
const PENALTY_FINDER_LIKE = 40;
const PENALTY_BALANCE = 10;

// --- ① バイト列化 -------------------------------------------------------------

function toUtf8Bytes(text: string): readonly number[] {
  return Array.from(new TextEncoder().encode(text));
}

// --- ② 型番の決定 -------------------------------------------------------------

/** 型番 `version` の総モジュール数のうち、符号語に使える生のビット数。 */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignCount = Math.floor(version / 7) + 2;
    result -= (25 * alignCount - 10) * alignCount - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** 型番 `version`（レベル M）のデータ符号語数。 */
function dataCodewordCount(version: number): number {
  return (
    Math.floor(rawDataModules(version) / 8) -
    EC_CODEWORDS_PER_BLOCK[version] * EC_BLOCK_COUNT[version]
  );
}

/** バイトモードの文字数指示子のビット数（ISO/IEC 18004 表 3）。 */
function charCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function chooseVersion(byteLength: number): number | null {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const capacityBits = dataCodewordCount(version) * 8;
    const requiredBits = 4 + charCountBits(version) + byteLength * 8;
    if (requiredBits <= capacityBits) return version;
  }
  return null;
}

// --- ③ データ符号語 -----------------------------------------------------------

function buildDataCodewords(bytes: readonly number[], version: number): readonly number[] {
  const bits: number[] = [];
  const appendBits = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  appendBits(MODE_BYTE, 4);
  appendBits(bytes.length, charCountBits(version));
  for (const byte of bytes) appendBits(byte, 8);

  const capacityBits = dataCodewordCount(version) * 8;
  // 終端パターン（最大 4 ビット）→ 符号語境界までの 0 詰め → 埋め草符号語。
  appendBits(0, Math.min(4, capacityBits - bits.length));
  appendBits(0, (8 - (bits.length % 8)) % 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  for (let i = 0; codewords.length * 8 < capacityBits; i++) {
    codewords.push(PAD_CODEWORDS[i % PAD_CODEWORDS.length]);
  }
  return codewords;
}

// --- ④ Reed-Solomon -----------------------------------------------------------

/** GF(2^8) の乗算。 */
export function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * GF_PRIMITIVE);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** 次数 `degree` の生成多項式（最高次の係数 1 を除いた係数列）。 */
export function reedSolomonDivisor(degree: number): readonly number[] {
  const result: number[] = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** `data` を `divisor` で割った剰余 ＝ 誤り訂正符号語。 */
export function reedSolomonRemainder(
  data: readonly number[],
  divisor: readonly number[],
): readonly number[] {
  const result: number[] = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    // `divisor.length >= 1` なので `shift()` は必ず値を返す（`?? 0` は型を閉じるためだけ）。
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

// --- ⑤ ブロック分割とインターリーブ -------------------------------------------

function addEccAndInterleave(data: readonly number[], version: number): readonly number[] {
  const blockCount = EC_BLOCK_COUNT[version];
  const eccLength = EC_CODEWORDS_PER_BLOCK[version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const shortBlockCount = blockCount - (rawCodewords % blockCount);
  const shortBlockLength = Math.floor(rawCodewords / blockCount);

  const divisor = reedSolomonDivisor(eccLength);
  const blocks: (readonly number[])[] = [];
  for (let i = 0, offset = 0; i < blockCount; i++) {
    const dataLength = shortBlockLength - eccLength + (i < shortBlockCount ? 0 : 1);
    const chunk = data.slice(offset, offset + dataLength);
    offset += dataLength;
    const ecc = reedSolomonRemainder(chunk, divisor);
    // 🔴 短いブロックにはダミーを 1 語詰めて、全ブロックの長さを揃えてから連結する。
    //    揃えないと誤り訂正符号語の開始位置が長短で 1 語ずれ、インターリーブが崩れる
    //    （データ部の先頭だけ正しく、途中から全部ずれる ＝ 読めない QR になる）。
    const padded = i < shortBlockCount ? [...chunk, 0] : [...chunk];
    blocks.push([...padded, ...ecc]);
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, blockIndex) => {
      // 上で詰めたダミーの位置だけ飛ばす（ISO/IEC 18004 図 15 の並び）。
      if (i === shortBlockLength - eccLength && blockIndex < shortBlockCount) return;
      result.push(block[i]);
    });
  }
  return result;
}

// --- ⑥〜⑨ 行列の組み立て -----------------------------------------------------

type Grid = {
  readonly size: number;
  readonly modules: boolean[][];
  /** 機能パターン（データを置けない位置）。 */
  readonly reserved: boolean[][];
};

function createGrid(size: number): Grid {
  const fill = (): boolean[][] =>
    Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, modules: fill(), reserved: fill() };
}

function setFunctionModule(grid: Grid, x: number, y: number, dark: boolean): void {
  grid.modules[y][x] = dark;
  grid.reserved[y][x] = true;
}

/** 位置合わせパターンの中心座標（ISO/IEC 18004 附属書 E）。 */
export function alignmentPatternPositions(version: number): readonly number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

function drawFinderPattern(grid: Grid, centerX: number, centerY: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || x >= grid.size || y < 0 || y >= grid.size) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunctionModule(grid, x, y, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignmentPattern(grid: Grid, centerX: number, centerY: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunctionModule(grid, centerX + dx, centerY + dy, distance !== 1);
    }
  }
}

/** 形式情報（誤り訂正レベル + マスク）を BCH(15,5) で符号化して 2 か所に書く。 */
function drawFormatBits(grid: Grid, maskPattern: number): void {
  const data = (EC_LEVEL_FORMAT_BITS << 3) | maskPattern;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bitAt = (i: number): boolean => ((bits >>> i) & 1) !== 0;
  const size = grid.size;

  // 左上（位置検出パターンの周り）。
  for (let i = 0; i <= 5; i++) setFunctionModule(grid, 8, i, bitAt(i));
  setFunctionModule(grid, 8, 7, bitAt(6));
  setFunctionModule(grid, 8, 8, bitAt(7));
  setFunctionModule(grid, 7, 8, bitAt(8));
  for (let i = 9; i < 15; i++) setFunctionModule(grid, 14 - i, 8, bitAt(i));

  // 右上と左下（複製）。
  for (let i = 0; i < 8; i++) setFunctionModule(grid, size - 1 - i, 8, bitAt(i));
  for (let i = 8; i < 15; i++) setFunctionModule(grid, 8, size - 15 + i, bitAt(i));
  // 常に暗のモジュール（ISO/IEC 18004 8.9）。
  setFunctionModule(grid, 8, size - 8, true);
}

/** 型番情報（型番 7 以上）を BCH(18,6) で符号化して 2 か所に書く。 */
function drawVersionBits(grid: Grid, version: number): void {
  if (version < 7) return;
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  const bits = (version << 12) | remainder;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunctionModule(grid, a, b, dark);
    setFunctionModule(grid, b, a, dark);
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;
  // タイミングパターン。
  for (let i = 0; i < size; i++) {
    setFunctionModule(grid, 6, i, i % 2 === 0);
    setFunctionModule(grid, i, 6, i % 2 === 0);
  }
  // 位置検出パターンと分離パターン。
  drawFinderPattern(grid, 3, 3);
  drawFinderPattern(grid, size - 4, 3);
  drawFinderPattern(grid, 3, size - 4);
  // 位置合わせパターン（位置検出パターンと重なる 3 つの角には置かない）。
  const positions = alignmentPatternPositions(version);
  const last = positions.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      drawAlignmentPattern(grid, positions[i], positions[j]);
    }
  }
  // 形式情報の領域を先に予約する（値はマスク確定後に上書きする）。
  drawFormatBits(grid, 0);
  drawVersionBits(grid, version);
}

function drawCodewords(grid: Grid, codewords: readonly number[]): void {
  const size = grid.size;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    // 🔴 6 列目は縦のタイミングパターン。**ループ変数そのものをずらす**（別変数に退避して
    //    `right` を 6 のままにすると、以降の列の組が 1 つずれ、左端の列に 1 ビットも
    //    置かれないまま終わる）。
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (grid.reserved[y][x] || bitIndex >= codewords.length * 8) continue;
        grid.modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
        bitIndex++;
      }
    }
  }
}

function maskApplies(maskPattern: number, x: number, y: number): boolean {
  switch (maskPattern) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(grid: Grid, maskPattern: number): void {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (grid.reserved[y][x]) continue;
      if (maskApplies(maskPattern, x, y)) grid.modules[y][x] = !grid.modules[y][x];
    }
  }
}

// --- マスクの減点法（ISO/IEC 18004 8.8.2） ------------------------------------

function finderLikeCount(history: readonly number[]): number {
  const unit = history[1];
  const core =
    unit > 0 &&
    history[2] === unit &&
    history[3] === unit * 3 &&
    history[4] === unit &&
    history[5] === unit;
  return (
    (core && history[0] >= unit * 4 && history[6] >= unit ? 1 : 0) +
    (core && history[6] >= unit * 4 && history[0] >= unit ? 1 : 0)
  );
}

function pushRun(history: number[], runLength: number, size: number): void {
  // 走査開始時の 1 本目には、外側の余白（クワイエットゾーン）を明モジュールとして足す。
  const length = history[0] === 0 ? runLength + size : runLength;
  history.pop();
  history.unshift(length);
}

function terminateRuns(
  history: number[],
  runDark: boolean,
  runLength: number,
  size: number,
): number {
  let length = runLength;
  if (runDark) {
    pushRun(history, length, size);
    length = 0;
  }
  pushRun(history, length + size, size);
  return finderLikeCount(history);
}

function penaltyScore(modules: readonly (readonly boolean[])[], size: number): number {
  let score = 0;

  const scanLine = (read: (i: number) => boolean): void => {
    let runDark = false;
    let runLength = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < size; i++) {
      if (read(i) === runDark) {
        runLength++;
        if (runLength === 5) score += PENALTY_ADJACENT;
        else if (runLength > 5) score++;
        continue;
      }
      pushRun(history, runLength, size);
      if (!runDark) score += finderLikeCount(history) * PENALTY_FINDER_LIKE;
      runDark = read(i);
      runLength = 1;
    }
    score += terminateRuns(history, runDark, runLength, size) * PENALTY_FINDER_LIKE;
  };

  for (let y = 0; y < size; y++) scanLine((x) => modules[y][x]);
  for (let x = 0; x < size; x++) scanLine((y) => modules[y][x]);

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y][x];
      if (
        color === modules[y][x + 1] &&
        color === modules[y + 1][x] &&
        color === modules[y + 1][x + 1]
      ) {
        score += PENALTY_BLOCK;
      }
    }
  }

  let dark = 0;
  for (const row of modules) for (const module of row) if (module) dark++;
  const total = size * size;
  const deviation = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return score + deviation * PENALTY_BALANCE;
}

/**
 * マスク適用後の減点（ISO/IEC 18004 8.8.2）。`encodeQrCode` はこれが最小になるマスクを選ぶ。
 * 🔴 テストが「自動選択が本当に最小値を選んでいるか」を確かめられるように公開している。
 */
export function maskPenaltyScore(code: QrCode): number {
  return penaltyScore(code.modules, code.size);
}

// --- 公開 API -----------------------------------------------------------------

/**
 * `text` を QR コードに符号化する。容量（型番 20 / レベル M）を超える場合は `null` を返す。
 *
 * 🔴 容量超過で例外を投げずに `null` を返すのは、呼び出し側（登録ウィザード）が**手入力用の
 *    表示だけで続行できる**ようにするためである。QR が出せないことは 2 要素認証の設定を
 *    止める理由にならない（`CLAUDE.md` §13.3「劣化はさせても遮断はしない」）。
 *    一方、範囲外の `maskPattern` は**入力データの条件ではなく呼び出し側の誤り**なので、
 *    黙って既定に倒さず `RangeError` にする（黙って倒すと、意図しないマスクの QR が
 *    「正常に見える形で」出続ける）。
 * 🔴 純粋関数である（ネットワーク I/O を持たない）。冒頭の 🔴 のとおり、シークレットを含む
 *    文字列を外へ出さないことがこのモジュールの存在理由である。
 */
export function encodeQrCode(text: string, options: EncodeQrCodeOptions = {}): QrCode | null {
  const requestedMask = options.maskPattern;
  if (
    requestedMask !== undefined &&
    (!Number.isInteger(requestedMask) || requestedMask < 0 || requestedMask >= MASK_COUNT)
  ) {
    throw new RangeError(`maskPattern は 0〜${MASK_COUNT - 1} の整数である必要があります`);
  }

  const bytes = toUtf8Bytes(text);
  const version = chooseVersion(bytes.length);
  if (version === null) return null;

  const grid = createGrid(version * 4 + 17);
  drawFunctionPatterns(grid, version);
  drawCodewords(grid, addEccAndInterleave(buildDataCodewords(bytes, version), version));

  let maskPattern = requestedMask;
  if (maskPattern === undefined) {
    let bestScore = Number.POSITIVE_INFINITY;
    maskPattern = 0;
    for (let candidate = 0; candidate < MASK_COUNT; candidate++) {
      applyMask(grid, candidate);
      drawFormatBits(grid, candidate);
      const score = penaltyScore(grid.modules, grid.size);
      if (score < bestScore) {
        bestScore = score;
        maskPattern = candidate;
      }
      applyMask(grid, candidate); // 排他的論理和なので、同じマスクをもう一度掛けると元に戻る。
    }
  }
  applyMask(grid, maskPattern);
  drawFormatBits(grid, maskPattern);

  return { size: grid.size, modules: grid.modules, maskPattern, version };
}

/**
 * 暗モジュールを SVG の `path` データ（`d` 属性の値）に変換する。座標の単位は 1 モジュール。
 * 横方向に連続する暗モジュールを 1 つの矩形にまとめ、`path` を短く保つ。
 */
export function qrCodeSvgPath(code: QrCode): string {
  const parts: string[] = [];
  for (let y = 0; y < code.size; y++) {
    let x = 0;
    while (x < code.size) {
      if (!code.modules[y][x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < code.size && code.modules[y][x + run]) run++;
      parts.push(`M${x} ${y}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return parts.join('');
}
