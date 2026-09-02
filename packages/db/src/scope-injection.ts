// packages/db/src/scope-injection.ts
// 第 2 防御（Prisma Client Extension）の中身のうち、Prisma に依存しない純粋部分。
// docs/05 §4.1 / docs/03 §4.3.1「$allOperations フックで where: { tenantId } を注入する」。
//
// 🔴 Prisma の生成物を import しない。ここを純粋に保つことで、
//    「拡張が何を注入するか」を DB もコンテナも無しにユニットテストで固定できる
//    （RLS が無効化されてもアプリは正常に動くため、機能テストでは第 2 防御の欠落に気づけない）。
//
// 🔴 防御は「読み側（where）」と「書き側（data）」の 2 面ある。where だけを注入しても、
//    既存行の所属を data で書き換える攻撃（行の移動）は止まらない。
//    update / updateMany / updateManyAndReturn / upsert(update 分岐) の data も検査する。
//
// 🔴 書き側の検査は「テナントキー列を書き換えうるネスト write すべて」を対象にする。方向は問わない。
//    子 → 親（Engineer.tenant）だけを塞ぐと、親 → 子（Tenant.engineers）から同じ列を書ける
//    （経路 ⑥。実測で突破された）。

/**
 * 🔴 テナントスコープの注入対象外にできるモデル（CLAUDE.md §3.1 / docs/03 §4.3.1）。
 * ここに追記することは情報境界の前提を変えることであり、人間の承認事項（CLAUDE.md §8.6）。
 */
export const TENANT_SCOPE_EXCLUDED_MODELS = [
  'Skill',
  'Plan',
  'Subscription',
  'PlatformUser',
] as const;

/**
 * テナントキー列がモデルごとに異なる場合の宣言（docs/05 §3.1 の 2 例外）。
 * 既定は `tenantId`。`Announcement`（`targetTenantIds`）は SP-02 で追加する。
 *
 * C0（`SchedulerRun` / `WebhookDelivery` / `EmailEvent` / `ImpersonationSession`）は
 * テナントキーを持たないが、ここには現れない。到達経路が `withSystemScope`（docs/05 §4.4.2）
 * だけであり、本拡張を適用したクライアントからは触らないためである。
 *
 * ⚠️ 既知の gap（`SkillAlias` のグローバル行 ／ docs/05 §4.4 C1 との不一致。code-reviewer 指定、
 * 2026-09-03）: `skill_aliases` は `tenantId` を持つがグローバル行（`tenant_id IS NULL`）を
 * 許容し、第 1 防御（RLS、`docs/05` §4.4 C1）は `SELECT` を `OR tenant_id IS NULL` で許可する
 * 想定（グローバル行も読める）。一方この拡張（第 2 防御）は `withScopedWhere` で
 * 全操作の `where` に無条件で `AND tenantId = <ctx のテナント>` を注入するため、
 * `withTenant` 経由では `tenant_id IS NULL` の行がこの `AND` に一致せず、
 * RLS が許すはずのグローバル行を読めない（**漏れる方向ではなく隠れる方向の gap**。
 * 情報境界としては安全側だが、`F-010 AC-2` の「グローバル辞書をテナントから読める」を
 * 満たさない）。C1 ポリシーを実際に配線する T-02-06 で、`SkillAlias` の読み取り注入だけ
 * `OR tenantId IS NULL` を許すよう緩めるか、モデル単位の注入方式を分けるかを設計判断すること。
 * 書込（`INSERT`/`UPDATE`/`DELETE`）はグローバル行を作らせない意図と一致するため対象外。
 */
const TENANT_KEY_OVERRIDES: Readonly<Record<string, string>> = {
  Tenant: 'id',
};

/** テナントキーを裏付けるリレーションフィールドの既定名。 */
const DEFAULT_TENANT_RELATION = 'tenant';

/**
 * 🔴 テナントキー列を裏付けるリレーションフィールド名の宣言。
 * スカラーキーだけを検査しても、`data: { tenant: { connect: { id: 他テナント } } }` で
 * 同じ列を書き換えられる（実測で突破された経路）。リレーション側も塞ぐ。
 *
 * `null` = そのモデルにはテナントキーを裏付けるリレーションが無い。
 * `Tenant` のテナントキーは自身の `id` であり、外部キーではないため `null`。
 *
 * 🔴 宣言と Prisma スキーマの実体が食い違うと、この防御は静かに無効になる。
 *    `tenant-relation.test.ts` が DMMF を走査して両者の一致を毎回検証する。
 */
const TENANT_RELATION_OVERRIDES: Readonly<Record<string, string | null>> = {
  Tenant: null,
};

/**
 * 🔴 逆リレーション（親 → 子）の宣言。
 *
 * `Engineer.tenant`（子 → 親）を塞いでも、**同じ `engineers.tenant_id` 列は
 * `Tenant.engineers`（親 → 子）からも書ける**。
 * `tenant.update({ where: { id: 自テナント }, data: { engineers: { connect: { id: 他テナントの行 } } } })`
 * は自テナントの行しか触っていないように見えて、他テナントの行を自テナントへ引き寄せる
 * （実測で突破された経路）。
 *
 * 🔴 したがって検査対象は「自モデルのテナントキーを裏付けるリレーション」ではなく、
 *    **テナントキー列を書き換えうるネスト write すべて（方向を問わない）**である。
 *
 * ここに挙げるのは「そのフィールドへのネスト write が**他モデルの**テナントキー列を
 * 書き換えうるリレーション」。値の形（`connect` / `set` / `create` / …）では場合分けしない。
 *
 * 🔴 射程外 4 モデル（`TENANT_SCOPE_EXCLUDED_MODELS`）はそもそも注入を行わないため、
 *    ここに宣言しても効かない。射程外モデルにこの種のリレーションが生えることは
 *    新たな越境経路の追加であり、人間の承認事項（`CLAUDE.md` §3.1 / §8.6）。
 *
 * 🔴 宣言漏れはこの防御を静かに無効化する。`tenant-relation.test.ts` が DMMF を
 *    逆方向に走査し、未宣言の逆リレーションが増えたら落とす（SP-02 の 56 表拡張への恒久対策）。
 *
 * 🔴 T-02-01: docs/05 §3.3 の 6 表（User / Membership / PartnerCompany / Invitation /
 *    TenantSendingDomain の `tenant` リレーション。加えて Engineer は T-01-04 から）を追加した。
 * 🔴 T-02-02: docs/05 §3.4 / §3.5 の 10 表（SkillAlias / EngineerSkill / SkillSheet /
 *    SkillSheetExtraction / FileScanResult / Project / ProjectRequirement / ProjectVisibility /
 *    MatchCandidate / EngineerShare の `tenant` リレーション）を追加した。
 */
const TENANT_KEY_MOVING_RELATION_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  Tenant: [
    'engineers',
    'users',
    'memberships',
    'partnerCompanies',
    'invitations',
    'sendingDomains',
    'skillAliases',
    'engineerSkills',
    'skillSheets',
    'skillSheetExtractions',
    'fileScanResults',
    'projects',
    'projectRequirements',
    'projectVisibilities',
    'matchCandidates',
    'engineerShares',
  ],
};

const EXCLUDED = new Set<string>(TENANT_SCOPE_EXCLUDED_MODELS);

/** where だけを持つ操作（読み取りと削除）。data を持たないため書き側の検査は要らない。 */
const WHERE_ONLY_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'delete',
  'deleteMany',
  'aggregate',
  'count',
  'groupBy',
]);

/** 🔴 where と data の両方を持つ更新操作。where の注入だけでは行の移動を止められない。 */
const UPDATE_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

/** data だけを持つ操作。 */
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

/** where と create と update をすべて持つ操作。 */
const UPSERT_OPERATIONS = new Set(['upsert']);

/** 🔴 呼び出し側が ctx と異なるテナントキーで書き込もうとしたことを示す。 */
export class CrossTenantWriteError extends Error {
  constructor(tenantKey: string) {
    super(
      `書き込みデータの ${tenantKey} が認証コンテキストのテナントと一致しません。` +
        '分離キーはリクエスト入力から受け取れません（CLAUDE.md §3.1）。',
    );
    this.name = 'CrossTenantWriteError';
  }
}

/**
 * 🔴 書き込みデータが、テナントキー列を書き換えうるリレーションに触れたことを示す。
 * 対象は順方向（`Engineer.tenant`）と逆方向（`Tenant.engineers`）の両方である。
 * スカラーキーだけを検査してもリレーション経由（`connect` / `set` / `create` /
 * `connectOrCreate` / `disconnect`）で行を他テナントへ移せるため、リレーションへの書き込みは
 * 値の中身を問わず一律拒否する。テナントキーの値を決めるのは拡張だけである。
 */
export class TenantRelationWriteError extends Error {
  constructor(relation: string) {
    super(
      `書き込みデータがテナントのリレーション ${relation} に触れています。` +
        'テナントキーは認証コンテキストからのみ決まります（CLAUDE.md §3.1）。',
    );
    this.name = 'TenantRelationWriteError';
  }
}

/** 拡張が扱い方を知らない操作に遭遇したことを示す。🔴 素通しさせないための fail-closed。 */
export class UnscopedOperationError extends Error {
  constructor(model: string, operation: string) {
    super(
      `テナントスコープを注入できない操作です: ${model}.${operation}。` +
        'packages/db/src/scope-injection.ts の操作分類に追加してください（素通しは許容しません）。',
    );
    this.name = 'UnscopedOperationError';
  }
}

/** モデル名から注入先のテナントキー列名を返す。`null` は注入対象外（射程外 4 モデル）。 */
export function tenantKeyOf(model: string): string | null {
  if (EXCLUDED.has(model)) return null;
  return TENANT_KEY_OVERRIDES[model] ?? 'tenantId';
}

/**
 * モデル名からテナントキーを裏付けるリレーションフィールド名を返す。
 * `null` は「そのリレーションが無い」（= 射程外モデル、または `Tenant`）。
 */
export function tenantRelationOf(model: string): string | null {
  if (EXCLUDED.has(model)) return null;
  const override = TENANT_RELATION_OVERRIDES[model];
  return override === undefined ? DEFAULT_TENANT_RELATION : override;
}

/**
 * モデル名から「そのフィールドへのネスト write が**他モデルの**テナントキー列を
 * 書き換えうる」リレーションフィールド名（逆リレーション）を返す。
 * 宣言の引き当てのみを行う（射程の判断は `tenantKeyOf` が済ませている）。
 */
export function tenantKeyMovingRelationsOf(model: string): readonly string[] {
  return TENANT_KEY_MOVING_RELATION_OVERRIDES[model] ?? [];
}

/**
 * 🔴 書き込み `data` で検査すべきリレーションフィールド名の全体。
 * 順方向（自モデルのテナントキーを裏付ける）と逆方向（他モデルのテナントキーを書き換えうる）を
 * 束ねる。**どちらか一方だけを見ると、もう片方が素通しの経路になる**（経路 ④ と経路 ⑥）。
 */
function guardedRelationsOf(model: string): readonly string[] {
  const forward = tenantRelationOf(model);
  const inverse = tenantKeyMovingRelationsOf(model);
  return forward === null ? inverse : [forward, ...inverse];
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : {};
}

/**
 * where に `AND: [..., { [tenantKey]: tenantId }]` を足す。
 *
 * 🔴 最上位へのマージ（上書き）にしない理由: 上書きは呼び出し側の条件を静かに書き換える。
 *    `deleteMany({ where: { tenantId: 他テナント } })` が「何も消さない」ではなく
 *    「自テナントの行を全部消す」に化けうる。`AND` なら条件は**狭まる方向にしか動かない**ため、
 *    他テナントを指定したクエリは必ず 0 件になる（docs/05 §4.7 #3「0 件」/ §4.8「見えない ＝ 存在しない」）。
 *
 * 🔴 `AND` に入れても `findUnique` は壊れない。呼び出し側の一意フィールドは最上位に残り、
 *    `AND` は追加のフィルタとして評価される（Prisma の extendedWhereUnique）。
 */
function withScopedWhere(args: UnknownRecord, tenantKey: string, tenantId: string): UnknownRecord {
  const where = asRecord(args['where']);
  const existing = where['AND'];
  const and = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
  return { ...args, where: { ...where, AND: [...and, { [tenantKey]: tenantId }] } };
}

/**
 * 🔴 テナントキー列を書き換えうるリレーションへの書き込みを一律拒否する（方向を問わない）。
 *
 * 値の形（`connect` / `set` / `create` / `connectOrCreate` / `disconnect` / `update` / …）で
 * 場合分けしない。場合分けは Prisma のネスト書き込み構文が増えるたびに穴が空くうえ、
 * 「自テナントへの connect」だけを許しても得られるものが無い（スカラーキーは拡張が確定させる）。
 *
 * 🔴 宣言されたフィールド名だけを見る。「オブジェクト値を一律拒否」にはしない
 *    （Json 列・DateTime・スカラーの `{ set: … }` が正当なオブジェクト値として来るため）。
 *    宣言と Prisma スキーマの実体の一致は `tenant-relation.test.ts` が毎回検証する。
 */
function assertNoTenantRelationWrite(record: UnknownRecord, relations: readonly string[]): void {
  for (const relation of relations) {
    if (record[relation] !== undefined) {
      throw new TenantRelationWriteError(relation);
    }
  }
}

/**
 * 更新データのスカラー値を取り出す。
 * 🔴 Prisma のスカラー更新は素の値と `{ set: value }` の 2 形をとる
 *    （`StringFieldUpdateOperationsInput`）。片方だけ検査すると、もう片方が素通しの経路になる。
 *    どちらでもない形（`{ increment: … }` 等）は解釈できないため fail-closed 側に倒す。
 */
function updateTargetValue(supplied: unknown): { readonly known: boolean; readonly value: unknown } {
  if (typeof supplied !== 'object' || supplied === null || Array.isArray(supplied)) {
    return { known: true, value: supplied };
  }
  const record = supplied as UnknownRecord;
  if ('set' in record) return { known: true, value: record['set'] };
  return { known: false, value: supplied };
}

/** 🔴 書き込みデータがテナントキーを他テナントへ動かそうとしていないことを確かめる。 */
function assertTenantKeyNotMoved(
  record: UnknownRecord,
  tenantKey: string,
  tenantId: string,
): void {
  const supplied = record[tenantKey];
  if (supplied === undefined) return; // 未指定 = 変更しない。正常系。
  const target = updateTargetValue(supplied);
  if (!target.known || (target.value !== undefined && target.value !== tenantId)) {
    throw new CrossTenantWriteError(tenantKey);
  }
}

/** create 系の 1 行分。テナントキーを ctx の値で確定させる。 */
function scopedRow(
  row: unknown,
  tenantKey: string,
  tenantId: string,
  relations: readonly string[],
): UnknownRecord {
  const record = asRecord(row);
  assertNoTenantRelationWrite(record, relations);
  // 🔴 書き込みには「狭める」が無いため、値を確定させるしかない。呼び出し側が別テナントを
  //    指定していたら静かに書き換えず、明示的に落とす（CLAUDE.md §3.1「分離キーはリクエスト
  //    入力から受け取らない」/ 事故を握り潰さない）。
  assertTenantKeyNotMoved(record, tenantKey, tenantId);
  return { ...record, [tenantKey]: tenantId };
}

function withScopedData(
  data: unknown,
  tenantKey: string,
  tenantId: string,
  relations: readonly string[],
): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => scopedRow(row, tenantKey, tenantId, relations));
  }
  return scopedRow(data, tenantKey, tenantId, relations);
}

/**
 * update 系の data。🔴 create と違い、値を書き足さず「動かそうとしていないこと」だけを検査する。
 * 未指定はそのモデルの所属を変えない正常系であり、そこへ `tenantId` を注入すると
 * `updateMany` の意味（一致した全行の該当列を更新する）を変えてしまうため。
 */
function verifiedUpdateData(
  data: unknown,
  tenantKey: string,
  tenantId: string,
  relations: readonly string[],
): unknown {
  if (Array.isArray(data)) {
    for (const row of data) {
      const record = asRecord(row);
      assertNoTenantRelationWrite(record, relations);
      assertTenantKeyNotMoved(record, tenantKey, tenantId);
    }
    return data;
  }
  const record = asRecord(data);
  assertNoTenantRelationWrite(record, relations);
  assertTenantKeyNotMoved(record, tenantKey, tenantId);
  return data;
}

/**
 * 1 回の Prisma 操作の引数にテナントスコープを注入した新しい引数を返す（引数は破壊しない）。
 * `model` が射程外なら引数をそのまま返す。
 */
export function injectTenantScope(params: {
  model: string;
  operation: string;
  args: unknown;
  tenantId: string;
}): unknown {
  const { model, operation, args, tenantId } = params;
  const tenantKey = tenantKeyOf(model);
  if (tenantKey === null) return args;
  const relations = guardedRelationsOf(model);

  const record = asRecord(args);

  if (WHERE_ONLY_OPERATIONS.has(operation)) {
    return withScopedWhere(record, tenantKey, tenantId);
  }

  if (UPDATE_OPERATIONS.has(operation)) {
    const scoped = withScopedWhere(record, tenantKey, tenantId);
    return { ...scoped, data: verifiedUpdateData(record['data'], tenantKey, tenantId, relations) };
  }

  if (CREATE_OPERATIONS.has(operation)) {
    return { ...record, data: withScopedData(record['data'], tenantKey, tenantId, relations) };
  }

  if (UPSERT_OPERATIONS.has(operation)) {
    const scoped = withScopedWhere(record, tenantKey, tenantId);
    return {
      ...scoped,
      create: withScopedData(record['create'], tenantKey, tenantId, relations),
      update: verifiedUpdateData(record['update'], tenantKey, tenantId, relations),
    };
  }

  throw new UnscopedOperationError(model, operation);
}
