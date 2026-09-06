// packages/domain/src/storage/object-key.ts
// 🔴 オブジェクトキーの組み立て（docs/05 §14.1 / docs/03 申し送り 16）。T-05-04。
//
// 🔴 **1 バケット + テナント別プレフィックス**である。テナントごとにバケットを分けると
//    GuardDuty の保護バケット上限 25 で詰まる（`docs/03` §3.4.3）。したがって
//    **キーの先頭 2 セグメント（`t/{tenantId}`）がテナント境界そのもの**であり、
//    ここを組み立てる場所は 1 つでなければならない（散らすと、IAM の `s3:prefix` 条件と
//    食い違うキーが生まれ、他テナントのプレフィックスへ書ける経路になる）。
//
// 🔴 本モジュールは純粋関数だけを持つ（`packages/domain` は I/O も現在時刻も持たない）。
//    UUID の採番は呼び出し側が行い、値として渡す（同じ入力なら必ず同じキーになる）。

/** キーの先頭。`t/` 配下だけがテナントのデータである（IAM の `s3:prefix` 条件と対応）。 */
const TENANT_PREFIX = 't';

/** 用途セグメント（docs/05 §14.1 の 5 種のうち、Phase 1 で使うもの）。 */
export const OBJECT_KIND_SEGMENTS = {
  skillSheet: 'skill-sheets',
} as const;

/** UUID（v4 / v7 のいずれでも通る一般形）。`tenantId` / `engineerId` / `{uuid}` に使う。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 拡張子として許す形（英数字 1〜16 文字）。
 * 🔴 ここを緩めると、キーに `/` や `..` を混ぜてプレフィックスの外へ出られる。
 */
const EXTENSION_PATTERN = /^[a-z0-9]{1,16}$/;

export class InvalidObjectKeyPartError extends Error {
  constructor(part: string, value: string) {
    // 🔴 値をそのまま載せない（ファイル名には氏名が入りうる。`CLAUDE.md` §3.5）。
    super(`オブジェクトキーの構成要素が不正です（${part}: ${value.length} 文字）。`);
    this.name = 'InvalidObjectKeyPartError';
  }
}

function assertUuid(part: string, value: string): void {
  if (!UUID_PATTERN.test(value)) throw new InvalidObjectKeyPartError(part, value);
}

/**
 * ファイル名から拡張子を取り出す（小文字化）。拡張子が無い / 使えない形なら `null`。
 *
 * 🔴 **元のファイル名はキーに含めない**（docs/05 §14.1）。ファイル名に氏名が入ることがあり、
 *    S3 のキーはアクセスログ・IAM ポリシー・Inventory など多くの場所に現れる。
 *    キーに残してよいのは「拡張子」だけであり、原本のファイル名は DB の列に持つ。
 */
export function objectKeyExtensionOf(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) return null;
  const extension = fileName.slice(lastDot + 1).toLowerCase();
  return EXTENSION_PATTERN.test(extension) ? extension : null;
}

export type SkillSheetObjectKeyInput = {
  readonly tenantId: string;
  readonly engineerId: string;
  /** `SkillSheet.version`（1 始まりの整数）。 */
  readonly version: number;
  /** 🔴 推測不能にするための UUID（呼び出し側が採番して渡す）。 */
  readonly objectId: string;
  /** `objectKeyExtensionOf` が返した拡張子。 */
  readonly extension: string;
};

/**
 * スキルシートのオブジェクトキー（docs/05 §14.1）。
 *
 * ```
 * t/{tenantId}/skill-sheets/{engineerId}/{version}/{uuid}.{ext}
 * ```
 *
 * 🔴 `tenantId` は**認証コンテキスト由来の値しか渡してはならない**（`CLAUDE.md` §3.1）。
 *    この関数は形式しか検査できない（誰の tenantId かは知りようがない）。
 */
export function buildSkillSheetObjectKey(input: SkillSheetObjectKeyInput): string {
  assertUuid('tenantId', input.tenantId);
  assertUuid('engineerId', input.engineerId);
  assertUuid('objectId', input.objectId);
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new InvalidObjectKeyPartError('version', String(input.version));
  }
  if (!EXTENSION_PATTERN.test(input.extension)) {
    throw new InvalidObjectKeyPartError('extension', input.extension);
  }
  return [
    TENANT_PREFIX,
    input.tenantId,
    OBJECT_KIND_SEGMENTS.skillSheet,
    input.engineerId,
    String(input.version),
    `${input.objectId}.${input.extension}`,
  ].join('/');
}

/**
 * 🔴 テナントプレフィックス配下のキーかどうか（docs/05 §14.1）。
 *
 * 署名を発行する実装（`packages/connectors` の `S3ObjectStore`）が、**署名する前に**必ず通す。
 * ここを通さないと「バケット直下」「他の用途のプレフィックス」「`..` を含むキー」への
 * 署名付き URL を発行できてしまう —— 署名は発行した時点で有効であり、後から取り消せない。
 */
export function isTenantScopedObjectKey(objectKey: string): boolean {
  const segments = objectKey.split('/');
  if (segments.length < 3) return false;
  if (segments[0] !== TENANT_PREFIX) return false;
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return false;
  }
  return UUID_PATTERN.test(segments[1] ?? '');
}

/**
 * 🔴 キーの先頭 2 セグメント（`t/{tenantId}`）からテナント ID を取り出す（T-05-05）。
 *    形が合わなければ `null`（推測で埋めない）。
 *
 * 🔴 **これは「リクエスト入力からテナントを決める」ことではない**（`CLAUDE.md` §3.1）。
 *    用途は 1 つだけで、**ウイルススキャン結果の受信**（`POST /api/webhooks/guardduty`）である。
 *    スキャン結果は利用者のリクエストではなく S3 のイベントであり、そこに現れるオブジェクトキーは
 *    **こちらが `buildSkillSheetObjectKey` で組み立ててアップロードしたもの**である。
 *    加えて次の 3 段で「どのテナントか」を騙れないようにしている:
 *      ① 受信は HMAC を検証した要求だけを通す（`packages/connectors/src/scan/guardduty.ts`）
 *      ② バケット名が起動時設定（`S3_BUCKET`）と一致しない結果は捨てる
 *      ③ 実際の更新は「そのテナントに `object_key` が一致する行があること」を条件にする
 *         （無ければ `NOT_FOUND`。存在しないテナントを名乗っても 1 行も動かない）
 *    利用者の HTTP 経路からこの関数を呼ぶ実装を足してはならない。
 */
export function tenantIdFromObjectKey(objectKey: string): string | null {
  if (!isTenantScopedObjectKey(objectKey)) return null;
  return objectKey.split('/')[1] ?? null;
}

/**
 * ダウンロード時に見せるファイル名の接頭辞（T-05-07。docs/05 §14.1）。
 *
 * 🔴 **版番号だけで組み立てる**（原本のファイル名を使わない）。理由は
 *    `buildSkillSheetDownloadFileName` の 🔴 を参照。
 */
const DOWNLOAD_FILE_NAME_PREFIX = 'skill-sheet-v';

/**
 * 🔴 スキルシートのダウンロード名（`Content-Disposition: attachment`）。T-05-07。
 *
 * ```
 * t/{tenant}/skill-sheets/{engineer}/3/{uuid}.xlsx  →  skill-sheet-v3.xlsx
 * ```
 *
 * ============================================================================
 * 🔴 なぜ「原本のファイル名」を使わないのか（docs/05 §14.1 の ⚠️ の決着。T-05-07）
 * ============================================================================
 * §14.1 は当初「元のファイル名は DB の列に持つ」と書いていたが、保存先の列は §3.4 に無く、
 * #19 の request にも `fileName` が無かった。T-05-07 は**列を足さない**ことを選んだ:
 *
 *   ① 🔴 **ファイル名は氏名を含みうる PII である**（実際に「山田 太郎 スキルシート.xlsx」の形で
 *      来る）。保存すると、運営者 GRANT の除外・監査 `summary` への不載・エクスポートの除外を
 *      **これから増える全経路で**守り続ける必要が生じる（`CLAUDE.md` §10.5 / `BR-52`
 *      「集めていない情報は漏れない」）。
 *   ② 🔴 ダウンロード名は**署名付き URL のクエリ**（`response-content-disposition`）に載る。
 *      氏名入りの名前を使うと、ブラウザ履歴・リファラ・アクセスログ・Sentry のパンくずに
 *      氏名が現れ、§16.2 の redact では追いきれない。
 *   ③ 画面（`docs/04` §S-008 の版一覧）は **版 / 日時 / 者 / 状態 / 抽出 / 最新版**しか出さない。
 *      利用者は最初からファイル名で版を識別していないので、版番号の名前と齟齬がない。
 *
 * 🔴 したがって名前は**キーだけから決まる**（DB を読まない = ずれようがない）。
 *    形が合わないキーは `null`（推測で埋めない）。
 * 🔴 生成されるのは ASCII の `[a-z-]`・数字・`.` だけであり、ヘッダに入れても
 *    引用符・改行の注入が起こらない（受け取る側の `S3ObjectStore` も同じ形を検査する）。
 */
export function buildSkillSheetDownloadFileName(objectKey: string): string | null {
  const parts = parseSkillSheetObjectKey(objectKey);
  if (parts === null) return null;
  return `${DOWNLOAD_FILE_NAME_PREFIX}${parts.version}.${parts.extension}`;
}

/** `parseSkillSheetObjectKey` が返す構成要素（`buildSkillSheetObjectKey` の入力と同じ形）。 */
export type SkillSheetObjectKeyParts = SkillSheetObjectKeyInput;

/**
 * 🔴 スキルシートのキーを構成要素に分解する（T-05-06。形が合わなければ `null`）。
 *
 * 🔴 用途は 1 つで、**アップロード確定（`POST /api/engineers/{id}/skill-sheets`。#19）が
 *    クライアントの申告した `objectKey` を照合する**ことである。#19 は body でキーを受け取る
 *    唯一の API であり（#18 と違い、確定するのは「どこに置いたか」だから受け取らざるを得ない）、
 *    照合しなければ **他テナント・他エンジニアのプレフィックスのオブジェクトを自分の版として
 *    登録できる**（`CLAUDE.md` §3.1）。
 *
 * 🔴 **これは「リクエスト入力からテナントを決める」ことではない。** 呼び出し側は
 *    `ctx.tenantId` / 経路の `engineerId` と**一致すること**を確かめるためだけに使う
 *    （一致しなければ 404）。ここから得た値を分離キーとして使ってはならない。
 * 🔴 組み立て（`buildSkillSheetObjectKey`）と同じ規約の上で判定する ——
 *    **組み立てた結果と再構成が一致すること**を最後に確かめるため、
 *    ここに規約の写しが増えない（片方だけが緩むことが起こらない）。
 */
export function parseSkillSheetObjectKey(objectKey: string): SkillSheetObjectKeyParts | null {
  if (!isTenantScopedObjectKey(objectKey)) return null;
  const segments = objectKey.split('/');
  if (segments.length !== 6) return null;
  const [, tenantId, kind, engineerId, versionSegment, fileName] = segments as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (kind !== OBJECT_KIND_SEGMENTS.skillSheet) return null;
  if (!UUID_PATTERN.test(engineerId)) return null;
  // 🔴 `0`・先頭ゼロ・符号付きを通さない（`Number.parseInt` は '01' も '1abc' も通す）。
  if (!/^[1-9][0-9]*$/.test(versionSegment)) return null;
  const version = Number(versionSegment);
  const extension = objectKeyExtensionOf(fileName);
  if (extension === null) return null;
  const objectId = fileName.slice(0, fileName.length - extension.length - 1);
  if (!UUID_PATTERN.test(objectId)) return null;

  const parts: SkillSheetObjectKeyParts = {
    tenantId,
    engineerId,
    version,
    objectId,
    extension,
  };
  // 🔴 規約の唯一の出所は `buildSkillSheetObjectKey` である。再構成が一致しないキー
  //    （大文字の拡張子など、組み立て側では作れない形）は通さない。
  return buildSkillSheetObjectKey(parts) === objectKey ? parts : null;
}
