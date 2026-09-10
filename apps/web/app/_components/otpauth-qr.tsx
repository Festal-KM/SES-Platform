'use client';

// apps/web/app/_components/otpauth-qr.tsx
// 2 要素認証の登録ウィザードが出す QR コード（`S-001` セクション 3 / `A-001` セクション 3）。
// 主平面と管理平面の**両方**が使う（同じものを 2 つ書かない。片方だけ直る事故を作らないため）。
//
// 🔴 **QR は利用者の端末の中だけで組み立てる。** `otpauth://` URL は TOTP のシークレットを
//    含むため、外部の QR 生成 API・CDN・画像サービスへ渡すことは「シークレットを第三者へ
//    送信した」ことと同義である（CLAUDE.md §3.5 / §7）。ここに `<img>` や fetch を持ち込まない。
//    そもそも `otpauthUrl` は `#3 setup` の応答としてこの画面にすでに届いており、QR にしても
//    露出は増えない —— 増えるのは「どこへ出すか」を誤ったときだけである。
//
// 🔴 インライン `<svg>` として描く（`dangerouslySetInnerHTML` を使わない）。`path` の `d` は
//    数字とコマンド文字だけからなる文字列であり、React が属性値としてエスケープする。
//
// ============================================================================
// 🔴 寸法（旧 `globals.css` の `.ses-otpauth-qr`）— SP-21 T-21-04 で Tailwind へ移した
// ============================================================================
// **`viewBox` だけでは幅が決まらない。** 寸法指定を落とすと、SVG は親いっぱいに伸びるか
// 潰れて**読み取れなくなる**（T-21-04 の受け入れ基準 ⑤-③）。移設は 1 対 1 で行った:
//
// | 旧宣言（`.ses-otpauth-qr`） | Tailwind | 理由 |
// |---|---|---|
// | `display: block` | `block` | `<svg>` の既定は inline。行末に隙間が出る |
// | `width: 100%` | `w-full` | 狭い画面でカラムからはみ出さない |
// | `max-width: 17rem` | `max-w-68`（`0.25rem × 68 = 17rem`） | 広い画面で 1 モジュールあたりの画素数を確保する（読み取り精度） |
// | `height: auto` | `h-auto` | 縦横比を `viewBox` に従わせる（潰さない） |
// | `background: #ffffff` | `bg-white` | 🔴 QR は明暗の比で読む。地の色を透かさない |
// | `margin: 0.5rem 0 1rem` | `Field` の `gap-1.5` + `mb-4` | 上の 0.5rem は見出しとの間隔であり、`Field` の gap がその役目を持つ |
import { useMemo } from 'react';
import { Field } from '@ses/ui';
import { encodeQrCode, qrCodeSvgPath } from '../../lib/auth/qr-code';

/** クワイエットゾーン（ISO/IEC 18004 が要求する周囲 4 モジュールの余白）。 */
const QUIET_ZONE = 4;

export type OtpauthQrProps = {
  /** `otpauth://` URL。🔴 この値をこのコンポーネントの外へ渡さない。 */
  readonly otpauthUrl: string;
  /** 画面に見える見出し（`packages/i18n` から渡す。ここにベタ書きしない）。 */
  readonly caption: string;
  /** 代替テキスト（同上）。 */
  readonly alt: string;
  readonly testId: string;
};

/**
 * 🔴 符号化できない場合（想定外に長い URL）は**見出しごと何も描かない**。QR が出せないことは
 *    2 要素認証の設定を止める理由にならず、併記してある手入力用の表示で設定を完了できる
 *    （CLAUDE.md §13.3「劣化はさせても遮断はしない」）。見出しを呼び出し側に置くと
 *    「QR コード」という見出しの下に何も無い状態が残りうるため、見出しもここが持つ。
 */
export function OtpauthQr({ otpauthUrl, caption, alt, testId }: OtpauthQrProps) {
  const drawing = useMemo(() => {
    const code = encodeQrCode(otpauthUrl);
    if (code === null) return null;
    return { extent: code.size + QUIET_ZONE * 2, path: qrCodeSvgPath(code) };
  }, [otpauthUrl]);

  if (drawing === null) return null;

  return (
    <Field as="p" className="mb-4" label={caption}>
      <svg
        className="block h-auto w-full max-w-68 bg-white"
        viewBox={`0 0 ${drawing.extent} ${drawing.extent}`}
        role="img"
        aria-label={alt}
        /* モジュールの境界をぼかさない（拡大縮小しても読み取り精度を落とさない）。 */
        shapeRendering="crispEdges"
        data-testid={testId}
      >
        <rect width={drawing.extent} height={drawing.extent} fill="#ffffff" />
        <g transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`}>
          <path d={drawing.path} fill="#000000" />
        </g>
      </svg>
    </Field>
  );
}
