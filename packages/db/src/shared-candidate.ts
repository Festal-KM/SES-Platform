// packages/db/src/shared-candidate.ts
// 🔴 T-08-03: 共有スコープ読み取り（`CLAUDE.md` §3.1 経路 4 の DB 側実装。docs/05 §4.5 / P-A-14）。
//
// 匿名候補の元データ（`Engineer` の 5 項目）は **C3 OWNER_SCOPED** によりホストから読めない。
// したがって候補の生成は**ホストの通常のリクエストコンテキストでは実行しない**。本ファイルが
// その唯一の限定経路であり、次の 4 枚で閉じている:
//
//   ①**GUC** … `app.shared_scope = 'on'` を立てるのは `sharedCandidateScopeSettingsSql` の
//     1 箇所だけで、それを呼ぶのは本ファイルの 1 関数だけである。`withTenant` を含む他のすべての
//     経路が毎回 `'off'` で上書きする（docs/05 §4.7 二重防御テスト #6）
//   ②**DB** … `engineer_shares`（C3）の行はホストに 1 行も見えない。存在の真偽だけを
//     `app_engineer_is_shared()`（`SECURITY DEFINER`。所有者 `app_share_probe`）が返す
//     （migration 20260916000000。二重防御テスト #7）
//   ③**メソッドの形** … `fn` が受け取る `SharedCandidateDb` は**素の Prisma デリゲートを
//     1 つも持たない**。公開するのは用途ごとの専用メソッドだけで、引数・戻り値は**スカラーと
//     固定形の DTO に限る**（`select` / `include` を受け取る型を表面に出さない）。
//     🔴 **「`engineers` のデリゲートを渡さない」では足りない** —— 素のデリゲートが 1 つでもあれば
//     `select: { engineer: { select: { displayName: true, ownerPartnerCompany: … } } }` と
//     **リレーション経由で** ②が開けた行が全列ぶん再び開く（T-08-03 のレビューで実 DB 再現。
//     詳細と「なぜ RLS・Prisma 拡張・型テストのどれも止められないか」は `SharedCandidateDb` の
//     JSDoc に書いた）。**回帰は実 DB テストが全メンバーについて実測する**（docs/05 §4.5）
//   ④**静的** … 呼び出し元の限定。`@ses/db` からの `withSharedCandidateScope` の named import を
//     ESLint が禁じ（`eslint.config.mjs`）、`tests/static/auth-db-callers.test.ts` が
//     `apps/**` の参照元を許可リストで固定する
//
// 🔴 **越境経路は増えていない。** 経路 4 は SP-02 の時点で `engineer_shares` として存在しており、
//    本ファイルはその読み取り側を確定させただけである（docs/05 `P-A-14`）。
//    代替案「`engineer_shares` にホスト向けの追加 SELECT ポリシー」は、行
//    （`partner_company_id` / `shared_by`）がホストに見えて **`BR-06` に抵触する**ため退けられている。
//
// ⚠️ **暫定。[Issue #49](https://github.com/Festal-KM/SES-Platform/issues/49) で確認中**
//    （`CLAUDE.md` §8.6）: 共有中かどうかの述語は `revoked_at IS NULL` **だけ**である
//    （docs/05 §4.5 のとおり。既定 = A「現状維持」）。停止中（`SUSPENDED` / `CLOSING`）の
//    テナントに属するパートナーは `requireExecutable()` により共有を**解除できない**ため
//    （docs/05 §17.2 #7）、「停止中の候補がホストに出続け、かつ本人は下ろせない」組み合わせが
//    実在しうる。🔴 **回答が C（停止中は自動的に無効化）になった場合の変更点は、migration
//    20260916000000 の `app_engineer_is_shared()` の述語 1 箇所だけである** ——
//    本ファイル・呼び出し側・型は変わらない。**判定をここ（アプリ層）へ持ち出さないこと。**
import { getBaseClient } from './client.js';
import { requireHost, type AuthenticatedTenantCtx } from './context.js';
import { tenantScopeExtension } from './extension.js';
import { sharedCandidateScopeSettingsSql, type TenantScopeSettings } from './scope-settings.js';
import { ENGINEER_LIST_ORDER_BY } from './search/index.js';
import type { RemoteMode } from './schema-value-sets.js';

/**
 * Prisma の `Decimal`。
 * 🔴 `@prisma/client` の型を `@ses/db` の**公開 API の値**に出さない（`apps/**` は
 *    `@prisma/client` を import できない。`CLAUDE.md` §3.1）。読み出し側は
 *    `apps/web/lib/format/db-values.ts` の `decimalToNumber` で受ける（既存の台帳読み出しと同形）。
 */
export type SharedCandidateDecimal = { toString(): string };

/**
 * 匿名候補のスキル 1 件（匿名 5 項目の ①。`docs/02` A-04）。
 *
 * 🔴 **辞書（`Skill`）の行だけ**である。`EngineerSkill.originalLabel`（正規化前の元表記＝
 *    フリーテキスト）を持たない —— 元表記は「その会社の書き方」そのものであり、
 *    共有元の特定につながる（A-04 ①「辞書の正規化済み名称のみ。フリーテキスト不可」）。
 * 🔴 `skillId` / `sortKey` は**並びの決定にだけ**使い、応答には載せない
 *    （`BR-55` / `F-017 AC-2`。載せると案件をまたいで同一人物を突き合わせられる）。
 *    載せないことの担保は T-08-04 の `AnonymousCandidateView` 側にある。
 */
export type SharedCandidateSkill = {
  /** `Skill.id`。`anonymizeEngineer` のタイブレークに要る（出力には載せない）。 */
  readonly skillId: string;
  /** `Skill.sortKey`（docs/05 §3.4「匿名候補のスキル並び（同順の決定的タイブレーク）」）。 */
  readonly sortKey: number;
  /** `Skill.name`（辞書の正規化済み名称）。 */
  readonly name: string;
  /** `EngineerSkill.yearsOfExperience`（`Decimal(4,1)`）。 */
  readonly yearsOfExperience: SharedCandidateDecimal;
};

/**
 * 🔴 共有スコープで読める**すべて**である（docs/05 §4.5 / §4.6.1 の `AnonymizeEngineerInput` と対）。
 *
 * 🔴 **フィールドを増やさないこと。** ここに 1 つ足すことは経路 4 の開示項目を増やすことに
 *    直結し、**人間の承認事項**である（`CLAUDE.md` §8.6 / §3.1 経路 4 の 🔴）。
 *    特に次は「うっかり足せてしまう」ので名前を挙げておく:
 *    - `ownerPartnerCompanyId` … **共有元そのもの**。これが出た時点で `BR-06` 違反である
 *    - `displayName` / `affiliationLabel` / `contactEmail` / `birthDate` … `F-017 AC-1`
 *    - `city` … 市区町村は出さない（A-04 ⑤。丸めて落とすのは
 *      `anonymizeEngineer` の責務だが、**そもそも読まない**のが二重防御の 1 枚目）
 *    - `preferenceNote` / 営業メモ … フリーテキストは一意特定の手がかりになる
 *    - 経歴（`EngineerCareer`） … `F-008 AC-7`。デリゲートも型も持たない
 */
export type SharedCandidateSource = {
  /**
   * `Engineer.id`。
   * 🔴 **応答に載せない**（`F-017 AC-2`）。T-08-04 の `candidateRef`
   *    （`HMAC(secret, projectId ‖ engineerId)`）の材料としてのみ使う。
   */
  readonly engineerId: string;
  /** `Engineer.unitPriceMin`（円）。 */
  readonly unitPriceMin: SharedCandidateDecimal | null;
  /** `Engineer.unitPriceMax`（円）。 */
  readonly unitPriceMax: SharedCandidateDecimal | null;
  /** `Engineer.availableFrom`（`@db.Date`。UTC 深夜の `Date`）。 */
  readonly availableFrom: Date | null;
  /** `Engineer.prefecture`（JIS X 0401 の都道府県コード）。市区町村は含まない。 */
  readonly prefecture: string | null;
  /** `Engineer.remoteMode`。 */
  readonly remoteMode: RemoteMode | null;
  /**
   * `Engineer.updatedAt`（タイムスタンプ）。
   * 🔴 **表示は JST の暦日に丸める**（`docs/03` §4.13.2-2）。丸めるのは呼び出し側の
   *    `toJstIsoDay` であり（docs/05 §4.6.3 の申し送り）、ここでは生の値を返す
   *    —— 暦日の実装を `packages/db` に 2 本目として複製しない。
   */
  readonly updatedAt: Date;
  /** 台帳に登録された**全**スキル（上位 8 件の選別は `anonymizeEngineer` が行う）。 */
  readonly skills: readonly SharedCandidateSkill[];
};

/** `listSharedEngineers` の絞り込み。🔴 **分離キーは受け取らない**（ctx からのみ来る）。 */
export type SharedCandidateQuery = {
  /**
   * 対象を特定のエンジニアに限る。
   * 🔴 **共有停止の即時反映（`F-016 AC-2`）の再確認はこれで行う** —— 既存の `MatchCandidate` の
   *    `engineerId` を渡し、**返って来たものだけ**を候補として残す。返らなかったものは
   *    その時点で共有が切れている（`revoked_at` が入った瞬間にポリシーが外れる）。
   */
  readonly engineerIds?: readonly string[];
  /** 取得上限。省略時は無制限（呼び出し側がページングを持つまでの間の安全弁）。 */
  readonly take?: number;
};

/** `replaceAnonymousCandidates` が書く 1 行。🔴 スカラーだけを受け取る（`select` を持ち込まない）。 */
export type AnonymousCandidateRow = {
  /** 共有スコープで読んだ `SharedCandidateSource.engineerId` をそのまま渡す。 */
  readonly engineerId: string;
  /** 算出時刻（`MatchCandidate.computedAt`）。🔴 現在時刻を `packages/db` の中で取らない。 */
  readonly computedAt: Date;
};

/**
 * 🔴 `fn` が受け取るクライアント（docs/05 §4.5）。
 *
 * 🔴 **素の Prisma デリゲートを 1 つも置かない。** これは「`engineers` のデリゲートを渡さない」
 *    では**足りない**（T-08-03 のコードレビューで実 DB の漏洩として再現された）:
 *
 *      db.matchCandidate.findMany({ select: { engineer: { select: {
 *        displayName: true, ownerPartnerCompanyId: true,
 *        ownerPartnerCompany: { select: { name: true } } } } } })
 *
 *    本スコープは `engineers` / `engineer_skills` の**行**を意図的に開けるため、
 *    **どのモデルであれ素のデリゲートを 1 つ渡した時点で、`select` / `include` の引数型が残り、
 *    リレーション経由でその行が全列ぶん再び開く**（上の例では共有エンジニアの実名と
 *    共有元パートナー会社の ID・社名が実際に取得できた ＝ `BR-06` 違反であり、
 *    `CLAUDE.md` §7 の「匿名候補の身元露出 0 件」「パートナー間の相互参照 0 件」に直撃する）。
 *
 * 🔴 **既存の 3 枚はこれを止められない**（だから形そのもので止める）:
 *    - **RLS は列を制限できない**（行を通した時点で全列が読める）
 *    - **Prisma 拡張（第 2 防御）の `$allOperations` フックは、ネストしたリレーション読み取りでは
 *      走らない**（`extension.ts` の「既知の射程外」）
 *    - **型テスト（`@ts-expect-error db.engineer`）は構造上リレーション経由を捕まえられない**
 *      （`db.engineer` は確かに存在しないので、テストは緑のまま素通りする）
 *
 * 🔴 したがって公開するのは**用途ごとの専用メソッドだけ**であり、引数・戻り値は
 *    **スカラーと固定形の DTO に限る**。`select` / `include` を受け取る型を、この型の表面に
 *    1 つも出さないこと。**回帰は実 DB テスト**（`tests/isolation/shared-candidate-scope.test.ts`）が
 *    全メンバーについて「PII / 共有元が 1 文字も返らない」ことを実測して固定する。
 *
 * 🔴 候補の書き込みを**このスコープの中**に置く理由（docs/05 §4.4「その行は … 専用の
 *    『共有スコープ読み取り』で作る」）: 読み取りと生成が別トランザクションだと、
 *    その間に共有が解除された行を書き込みうる。`MatchCandidate` 自体は **C2 HOST_ONLY** であり、
 *    パートナーからは 1 件も見えない。
 */
export type SharedCandidateDb = {
  /** 案件（`projectId`）の実在をこのスコープの入口で確認済みであることを示す。 */
  readonly projectId: string;
  readonly listSharedEngineers: (
    query?: SharedCandidateQuery,
  ) => Promise<readonly SharedCandidateSource[]>;
  /**
   * この案件の**匿名候補**（`MatchCandidate.isAnonymous = true`）を、渡された集合で置き換える。
   *
   * 🔴 **置き換え（delete → create）にする理由**: 共有が解除された候補を消すのと、まだ共有中の
   *    候補を作るのを**同じ 1 トランザクションで確定させる**ため。差分更新にすると
   *    「消し忘れた 1 件」が候補一覧に残り、`F-016 AC-2`（解除の即時反映）が破れる。
   * 🔴 **自社候補（`isAnonymous = false`）には触れない**（Phase 2 の `match.build` が別に持つ）。
   *
   * @returns 作成した行数。
   */
  readonly replaceAnonymousCandidates: (
    rows: readonly AnonymousCandidateRow[],
  ) => Promise<number>;
  /** この案件の匿名候補の `engineerId` の一覧（昇順）。🔴 返すのは ID だけである。 */
  readonly listAnonymousCandidateEngineerIds: () => Promise<readonly string[]>;
  /** この案件の匿名候補の件数。🔴 返すのは数値だけである。 */
  readonly countAnonymousCandidates: () => Promise<number>;
};

/**
 * 🔴 共有スコープの入口で案件が見つからなかった（docs/05 §4.8「見えない ＝ 存在しない」）。
 *
 * **0 件を返さずに落とす。** 匿名候補は「案件に対して」出すものであり、案件が特定できない
 * まま共有スコープを開くと、`app.shared_scope = 'on'` のトランザクションが
 * 「何のためでもなく」開かれる（監査でも説明できない）。API 境界は **404** に写像する。
 */
export class SharedCandidateProjectNotFoundError extends Error {
  constructor() {
    super(
      '共有スコープを開く対象の案件が見つかりません（docs/05 §4.5 / §4.8）。' +
        '404 として扱ってください（「見えない ＝ 存在しない」）。',
    );
    this.name = 'SharedCandidateProjectNotFoundError';
  }
}

function scopedClient(scope: TenantScopeSettings) {
  return getBaseClient().$extends(
    tenantScopeExtension({ tenantId: scope.tenantId, partnerCompanyId: scope.partnerCompanyId }),
  );
}

type ScopedClient = ReturnType<typeof scopedClient>;
type ScopedTransactionClient = Parameters<Parameters<ScopedClient['$transaction']>[0]>[0];

/**
 * 🔴 匿名候補の素データを読む唯一のクエリ。
 *
 * - `ownerPartnerCompanyId: { not: null }` … **自社スコープと共有スコープを 2 本のクエリに分ける**
 *   （`docs/03` `program-design` 申し送り 18 / SP-08 T-08-05）。共有スコープが `'on'` の
 *   トランザクションでは C3（自社分）と追加ポリシー（共有分）が **OR** で合成されるため、
 *   絞らないと自社エンジニアまで「匿名候補」として混ざる。
 *   🔴 絞りに使うだけで、**値は 1 度も読まない**（`select` に含めない）。
 * - 並びは `ENGINEER_LIST_ORDER_BY`（`updated_at desc, id desc`）。`F-009` の決定的順序と
 *   **同じ 1 つの宣言**を使う —— 2 本になると自社分と共有分でマージ順が食い違う。
 */
async function listSharedEngineers(
  tx: ScopedTransactionClient,
  query: SharedCandidateQuery,
): Promise<readonly SharedCandidateSource[]> {
  const engineers = await tx.engineer.findMany({
    where: {
      ownerPartnerCompanyId: { not: null },
      ...(query.engineerIds === undefined ? {} : { id: { in: [...query.engineerIds] } }),
    },
    select: {
      id: true,
      unitPriceMin: true,
      unitPriceMax: true,
      availableFrom: true,
      prefecture: true,
      remoteMode: true,
      updatedAt: true,
    },
    orderBy: [...ENGINEER_LIST_ORDER_BY],
    ...(query.take === undefined ? {} : { take: query.take }),
  });
  if (engineers.length === 0) return [];

  // 🔴 スキルは別クエリで引く（`include` にすると `engineers` の select が広がりやすい）。
  //    `engineer_skills` にも共有スコープの追加ポリシーが効く（migration 20260916000000）。
  const skills = await tx.engineerSkill.findMany({
    where: { engineerId: { in: engineers.map((engineer) => engineer.id) } },
    select: {
      engineerId: true,
      yearsOfExperience: true,
      skill: { select: { id: true, name: true, sortKey: true } },
    },
    // 🔴 全順序で返す。上位 8 件の選別と並びは `anonymizeEngineer`（`経験年数 desc → sortKey asc →
    //    skillId asc`）が決めるが、**DB の返す順に依存しない**ことをここでも明示しておく
    //    （依存すると、索引の選ばれ方が変わっただけで表示スキルが入れ替わる）。
    orderBy: [{ skillId: 'asc' }],
  });

  const skillsByEngineer = new Map<string, SharedCandidateSkill[]>();
  for (const row of skills) {
    const bucket = skillsByEngineer.get(row.engineerId) ?? [];
    bucket.push({
      skillId: row.skill.id,
      sortKey: row.skill.sortKey,
      name: row.skill.name,
      yearsOfExperience: row.yearsOfExperience,
    });
    skillsByEngineer.set(row.engineerId, bucket);
  }

  return engineers.map((engineer) => ({
    engineerId: engineer.id,
    unitPriceMin: engineer.unitPriceMin,
    unitPriceMax: engineer.unitPriceMax,
    availableFrom: engineer.availableFrom,
    prefecture: engineer.prefecture,
    remoteMode: engineer.remoteMode as RemoteMode | null,
    updatedAt: engineer.updatedAt,
    skills: skillsByEngineer.get(engineer.id) ?? [],
  }));
}

/**
 * この案件の匿名候補（`MatchCandidate.isAnonymous = true`）を、渡された集合で置き換える。
 *
 * 🔴 `select` / `include` を受け取らない（`SharedCandidateDb` の 🔴 を参照）。戻り値も件数だけである。
 * 🔴 自社候補（`isAnonymous = false`）は `deleteMany` の条件から外してある。
 */
async function replaceAnonymousCandidates(
  tx: ScopedTransactionClient,
  tenantId: string,
  projectId: string,
  rows: readonly AnonymousCandidateRow[],
): Promise<number> {
  await tx.matchCandidate.deleteMany({ where: { projectId, isAnonymous: true } });
  if (rows.length === 0) return 0;
  const created = await tx.matchCandidate.createMany({
    data: rows.map((row) => ({
      tenantId,
      projectId,
      engineerId: row.engineerId,
      isAnonymous: true,
      computedAt: row.computedAt,
    })),
  });
  return created.count;
}

/** この案件の匿名候補の `engineerId`（昇順）。🔴 返すのは ID の配列だけである。 */
async function listAnonymousCandidateEngineerIds(
  tx: ScopedTransactionClient,
  projectId: string,
): Promise<readonly string[]> {
  const rows = await tx.matchCandidate.findMany({
    where: { projectId, isAnonymous: true },
    select: { engineerId: true },
    orderBy: [{ engineerId: 'asc' }],
  });
  return rows.map((row) => row.engineerId);
}

/**
 * 匿名候補の生成だけに許す限定経路（docs/05 §4.5）。
 *
 * 🔴 `ctx` は `resolveTenantCtx` / `systemTenantCtx` でしか作れない ＝ 分離キーが
 *    リクエスト入力から来る経路が無い（`CLAUDE.md` §3.1）。
 * 🔴 **ホスト文脈であることを実行時に検証する**（`requireHost`）。パートナーがこの経路を
 *    通れると、他社の共有候補を読めることになり `CLAUDE.md` §3.1 の 🔴（パートナー間の
 *    相互参照）に直結する。**型（`AuthenticatedTenantCtx`）だけに頼らず、必ず弾く。**
 * 🔴 `projectId` の実在を**スコープを開いた直後に**確認する（fail-closed）。
 *
 * @param projectId 匿名候補を出す対象の案件。`candidateRef`（T-08-04）の案件スコープと同じ単位。
 */
export async function withSharedCandidateScope<T>(
  ctx: AuthenticatedTenantCtx,
  projectId: string,
  fn: (db: SharedCandidateDb) => Promise<T>,
): Promise<T> {
  requireHost(ctx);
  const scope: TenantScopeSettings = {
    tenantId: ctx.tenantId,
    // 🔴 ホストであることは `requireHost` が確定させた。空文字で明示する（docs/05 §4.3 規約 2）。
    partnerCompanyId: null,
    actorUserId: ctx.userId,
  };
  return scopedClient(scope).$transaction(async (tx) => {
    await tx.$queryRaw(sharedCandidateScopeSettingsSql(scope));
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (project === null) throw new SharedCandidateProjectNotFoundError();
    // 🔴 ここで渡すオブジェクトのメンバーは**すべて専用メソッド**である。
    //    `tx` の素のデリゲート（`tx.matchCandidate` 等）を 1 つも載せないこと。
    return fn({
      projectId: project.id,
      listSharedEngineers: (query) => listSharedEngineers(tx, query ?? {}),
      replaceAnonymousCandidates: (rows) =>
        replaceAnonymousCandidates(tx, ctx.tenantId, project.id, rows),
      listAnonymousCandidateEngineerIds: () => listAnonymousCandidateEngineerIds(tx, project.id),
      countAnonymousCandidates: () =>
        tx.matchCandidate.count({ where: { projectId: project.id, isAnonymous: true } }),
    });
  });
}
