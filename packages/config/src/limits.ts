// packages/config/src/limits.ts
// docs/05 §2.1 の `config/ … limits.ts`。**期限・上限の値をアプリ側に散らさないための単一の出所。**
//
// 🔴 なぜ packages/config に置くか（CLAUDE.md §3.4）:
//    「メール: テナントあたり 1 日 500 通 …（既定値。`packages/config` で管理し、プランごとに
//    上書き可能）」と同じ扱いである。期限の値が `apps/web` の各ハンドラに散ると、
//    招待の再発行（docs/05 §8.3 の `expiresAt = now + INVITATION_TTL`）と発行（#14）で
//    別々の値になり得る。**同じ名前の期限が 2 つ存在する状態を作らない。**
//
// 🔴 ここに置くのは「環境によって変わらない方針値」だけである。環境変数で与えるものは
//    `schema.ts`（Zod 検証つき）に置く。両方に同じ名前の値を作らない。

/**
 * 招待トークンの有効期間（docs/05 §8.3 の `INVITATION_TTL`）。
 *
 * 🔴 docs は `INVITATION_TTL` を参照するだけで値を定めていない。7 日は
 *    `tests/isolation/support/fixtures.ts` のシードが置いた既定値に合わせたものであり、
 *    **事業判断で変わりうる**（変えるときはこの 1 行だけを直す）。
 */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * パスワード再設定トークンの有効期間（docs/05 §6.3 #5 / #5b）。
 * 🔴 招待より大幅に短い。既存アカウントの乗っ取りに直結するため、
 *    「メールを受け取った本人がその場で使う」時間だけを与える。
 */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/**
 * 利用者が**設定する**パスワードの長さ（招待の受諾 #7 / 再設定の確定 #5b）。
 *
 * 🔴 サインイン（#1）には適用しない。既存の（ポリシー変更前の）パスワードで
 *    ログインできなくなるうえ、「弾かれた ＝ そのアカウントは存在する」の手がかりになる。
 * ⚠️ 12 文字は NIST SP 800-63B の下限（8）より強い実装既定である。
 *    docs には明文が無いため、**方針が決まったらこの 1 行を差し替える**。
 */
export const PASSWORD_MIN_LENGTH = 12;

/** RFC 5321 由来の実務上の上限。長大な入力を Argon2id に持ち込まないための境界。 */
export const PASSWORD_MAX_LENGTH = 512;

/** メールアドレスの長さの上限（RFC 5321）。 */
export const EMAIL_MAX_LENGTH = 254;

/** 表示名（`User.displayName`）の長さの上限。 */
export const DISPLAY_NAME_MAX_LENGTH = 120;

/** 組織名（`Tenant.name`。`A-014` の企業名 / `S-035` の商号）の長さの上限。 */
export const TENANT_NAME_MAX_LENGTH = 200;

/**
 * 送信元ドメイン（`TenantSendingDomain.domain`）の長さの上限。
 * RFC 1035 のホスト名全体の上限（253 オクテット）。
 */
export const SENDING_DOMAIN_MAX_LENGTH = 253;

/**
 * 一覧 API のページサイズ（docs/05 §6.1「カーソル方式。`?cursor=&limit=`（既定 50、最大 200）」）。
 *
 * 🔴 ページサイズは**性能の防御線**である（`CLAUDE.md` §7 のエンジニア 1 万件 / 案件 1 万件で
 *    p95 1 秒）。ハンドラごとに違う既定値を持つと、どのルートが重いのかを比較できなくなる。
 */
export const PAGE_SIZE_DEFAULT = 50;

/** 🔴 上限（docs/05 §6.1）。これを超える `limit` は 400 で拒否する（黙って丸めない）。 */
export const PAGE_SIZE_MAX = 200;

/**
 * 🔴 席数の日次スナップショット（`usage.seat-snapshot`。docs/05 §9.8）が、
 *    **取引先所属の席（`PARTNER_ADMIN` / `PARTNER_SALES`）を数に含めるか**の既定値。
 *
 * 🔴 **決め打ちしない**（docs/05 TBD-19 / [Issue #12](https://github.com/Festal-KM/SES-Platform/issues/12)）。
 *    席単価と課金対象は事業判断であり未決である。集計関数（`snapshotSeatCount`）は
 *    `countPartnerSeats: boolean` を**引数**で受け取り、その既定値だけをここが持つ。
 *    決まったらこの 1 行を差し替える（呼び出し側のコードは変わらない）。
 *
 * 暫定 `false` の理由: 取引先の担当者はテナントが招いた「相手方」であり、
 * 課金対象に含めると請求額が取引先の増減で動く。含める判断は増額側であり、
 * 決まっていない状態では**安全側（請求に載せない）**に倒す。
 */
export const SEAT_SNAPSHOT_COUNTS_PARTNER_SEATS = false;

/**
 * カーソル文字列の長さの上限。
 * 🔴 カーソルは**サーバが発行した値の返送**であり、利用者が組み立てるものではない。
 *    長大な入力をそのまま `where` に持ち込まないための境界。
 */
export const PAGE_CURSOR_MAX_LENGTH = 256;
