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
 * 🔴 `usage.gap-check`（docs/05 §9.8 / `F-026 AC-4`）が遡って連続性を検査する日数。T-10-02。
 *
 * 窓は `[max(テナント作成日, 今日 − この日数), 昨日]`。ジョブ自身が数日止まっても復帰した日に
 * それまでの欠測をまとめて拾えるだけの幅を持たせる（docs/03 §4.15「運用監視の指標: 直近 7 日」に揃える）。
 * 7 日を超えて止まった欠測は `A-005` の「スケジューラ停止」（docs/05 §9.9）が先に検知する。
 */
export const USAGE_GAP_CHECK_LOOKBACK_DAYS = 7;

/**
 * カーソル文字列の長さの上限。
 * 🔴 カーソルは**サーバが発行した値の返送**であり、利用者が組み立てるものではない。
 *    長大な入力をそのまま `where` に持ち込まないための境界。
 */
export const PAGE_CURSOR_MAX_LENGTH = 256;

/**
 * 🔴 監査ログ横断検索（API-A7 / `A-006` / `F-058`）で 1 回に指定できる期間の上限（日）。T-11-03。
 *
 * `audit_logs` は 100 テナントで年間約 1 億行になる（docs/03 §8.3-3）。`from` / `to` は必須だが、
 * 必須にしただけでは「1 年分」を指定できてしまうため、期間そのものにも上限を置く。
 * 超えた要求は **400** で拒み、画面は「期間を短縮」を促す（`docs/04` §A-006 のエラー欄）。
 * 🔴 `audit_logs` の月次パーティション（docs/03 §8.3-1）を最大 2 つまたぐ幅として 31 日を暫定値にした。
 *    運用で狭める判断はこの 1 行だけで済む（呼び出し側はこの値を引数で受け取る）。
 */
export const AUDIT_LOG_SEARCH_MAX_PERIOD_DAYS = 31;

/**
 * 管理平面の監視系一覧（`A-005` / `A-006`）の 1 ページの既定行数（docs/04 §5-6「管理平面の監視系は 100 行」）。
 * 🔴 `PAGE_SIZE_MAX`（200）を超えない。
 */
export const ADMIN_MONITORING_PAGE_SIZE = 100;

/**
 * 🔴 `A-005` 運用監視（T-11-04）の**環境によって変わらない方針値**。
 *
 * - `SCHEDULER_HEARTBEAT_STALE_HOURS` … `SchedulerRun` の最終実行がこの時間以上前なら「スケジューラ停止」
 *   （docs/05 §9.9 / `docs/03` §4.6 / `BR-34`。「24 時間更新なし」は設計値であり環境で変えない）。
 * - `GATE_FAIL_RATE_WINDOW_HOURS` … ゲート FAIL 率（項目 5）の「直近」の幅（docs/05 §16.5「日次比率」）。
 * - `GATE_FAIL_RATE_BASELINE_DAYS` … 「前週比」の比較対象。直近の窓の**前**のこの日数を基準にする
 *   （`docs/04` §A-005 項目 5「直近の率 / 前週比。急変を異常として検知」）。
 * 🔴 閾値（分単位で運用が調整するもの）は `schema.ts`（環境変数）に置く。ここは方針値だけ。
 */
export const SCHEDULER_HEARTBEAT_STALE_HOURS = 24;
export const GATE_FAIL_RATE_WINDOW_HOURS = 24;
export const GATE_FAIL_RATE_BASELINE_DAYS = 7;

/**
 * 🔴 T-10-09: 返却データ（`DataExportRequest`。docs/05 §6.7 #77 / #78 / docs/04 §S-042）の**環境によって変わらない方針値**。
 *
 * - `DATA_EXPORT_AVAILABLE_DAYS` … 生成済みの ZIP をダウンロードできる期間（`READY` → `expiresAt`。超過は `EXPIRED` = 410）。
 *   `CLOSING` の猶予（`TENANT_PURGE_GRACE_DAYS`。既定 30）より短く、`PURGED` では実体ごと消える（`PURGE_SPEC`）。
 * - `DATA_EXPORT_DOWNLOAD_URL_TTL_SECONDS` … 署名付き URL の有効期限（docs/05 §14.2 の表「返却データ … 3600 秒」）。
 *   スキルシートの DL（300 秒）と**別の値**であり、同じ設定値に畳まない（用途ごとに「URL が漏れたときに有効な時間」の許容が違う）。
 * 🔴 「試用環境だから期限を延ばす」に相当する値は置かない（`F-064 AC-9`）。
 */
export const DATA_EXPORT_AVAILABLE_DAYS = 7;
export const DATA_EXPORT_DOWNLOAD_URL_TTL_SECONDS = 3600;
