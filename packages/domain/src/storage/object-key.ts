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
