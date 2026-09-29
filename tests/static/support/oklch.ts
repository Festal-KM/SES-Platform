// tests/static/support/oklch.ts
// 🔴 oklch → sRGB → 相対輝度 → コントラスト比（`docs/05` §17.7.1 (e)）。**純粋関数だけを置く。**
//
// なぜ自前で書くか: Tailwind v4 の既定パレットは **oklch で定義されている**（実測:
// `node_modules/tailwindcss/theme.css` の `--color-slate-500: oklch(55.4% 0.046 257.417)`）。
// `docs/04` §7.9 は「独自の hex を起こさず**階調を参照する**」と定めており、コントラスト比を
// 機械で確かめるには **oklch を解ける**必要がある。
// 🔴 **パレットの値をテスト側に写さない**（写すと Tailwind の更新で静かに嘘になる。§17.7.1 (e)）。
//
// 変換の出典（いずれも標準の定義であり、係数を「調整」しない）:
//   - Oklab → LMS → linear sRGB: Björn Ottosson の Oklab の定義（CSS Color 4 が採用）
//   - linear sRGB → sRGB: IEC 61966-2-1 の伝達関数
//   - 相対輝度とコントラスト比: WCAG 2.1 の定義（1.4.3）
//
// ⚠️ **色域外（linear sRGB が [0,1] を外れる）の扱い**: 単純にクランプする。本リポジトリが
//    解くのは Tailwind の既定パレット（sRGB 内に収まるよう作られている）だけであり、
//    彩度の高い外部色を持ち込まない前提（`U-21`「独自の hex を起こさない」）。

/** `oklch(55.4% 0.046 257.417)` / `oklch(0.554 0.046 257.417 / 50%)` を解く。解けなければ `null`。 */
export function parseOklch(value: string): { l: number; c: number; h: number } | null {
  const match = /^oklch\(\s*([0-9.]+)(%?)\s+([0-9.]+)\s+([0-9.]+)/.exec(value.trim());
  if (match === null) return null;
  const lightness = Number(match[1]);
  return {
    l: match[2] === '%' ? lightness / 100 : lightness,
    c: Number(match[3]),
    h: Number(match[4]),
  };
}

/** `#fff` / `#ffffff` を解く。解けなければ `null`。 */
export function parseHex(value: string): { r: number; g: number; b: number } | null {
  const text = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short !== null) {
    return {
      r: Number.parseInt(`${short[1]}${short[1]}`, 16) / 255,
      g: Number.parseInt(`${short[2]}${short[2]}`, 16) / 255,
      b: Number.parseInt(`${short[3]}${short[3]}`, 16) / 255,
    };
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text);
  if (long === null) return null;
  return {
    r: Number.parseInt(long[1] ?? '', 16) / 255,
    g: Number.parseInt(long[2] ?? '', 16) / 255,
    b: Number.parseInt(long[3] ?? '', 16) / 255,
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** oklch → 線形 sRGB（Oklab の定義そのまま）。 */
function oklchToLinearSrgb(l: number, c: number, hDegrees: number): [number, number, number] {
  const hRadians = (hDegrees * Math.PI) / 180;
  const a = c * Math.cos(hRadians);
  const b = c * Math.sin(hRadians);

  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    +4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ];
}

/** sRGB（0〜1）→ 線形（IEC 61966-2-1）。 */
function srgbChannelToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** CSS の色（`oklch(…)` / `#rrggbb`）→ WCAG の相対輝度。解けなければ `null`。 */
export function relativeLuminance(cssColor: string): number | null {
  const oklch = parseOklch(cssColor);
  if (oklch !== null) {
    const [r, g, b] = oklchToLinearSrgb(oklch.l, oklch.c, oklch.h);
    return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
  }
  const hex = parseHex(cssColor);
  if (hex === null) return null;
  return (
    0.2126 * srgbChannelToLinear(hex.r) +
    0.7152 * srgbChannelToLinear(hex.g) +
    0.0722 * srgbChannelToLinear(hex.b)
  );
}

/** WCAG 2.1 のコントラスト比。解けない色があれば `null`。 */
export function contrastRatio(foreground: string, background: string): number | null {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) return null;
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}
