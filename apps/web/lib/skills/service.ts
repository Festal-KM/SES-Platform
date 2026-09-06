// apps/web/lib/skills/service.ts
// スキル辞書（`GET /api/skills`）・テナント別名と新語候補（`GET /api/skill-aliases`）の読み取りと、
// 採否（`POST /api/skill-aliases/{id}/decide`）。docs/05 §6.4 #23 / #24。`F-010` / `S-009`。T-05-03。
//
// 🔴 **母集団はアプリが決めない。**
//    - `skills`（グローバル辞書）… `CLAUDE.md` §3.1 の射程外 4 表。RLS を持たず、
//      `app_tenant` には **`GRANT SELECT` だけ**がある（migration 20260906000000）。
//      したがって「テナントから編集できない」（`F-010 AC-2` / `BR-02`）は**アプリの `if` ではなく
//      DB 権限**で成立している。本モジュールにも書き込みの経路は 1 つも無い。
//    - `skill_aliases` … RLS の C1（`SELECT` は `app_tenant_id() IS NOT NULL AND
//      (tenant_id = app_tenant_id() OR tenant_id IS NULL)`、書込は `tenant_id = app_tenant_id()`）と、
//      Prisma 拡張の `COLUMN_WITH_GLOBAL_ROWS`（**緩和は読み取りだけ**）が決める。
//      ここに `tenantId` の `where` を書かない（`F-004 AC-1`）。
//
// 🔴 **テナント固有の別名は他テナントに影響しない**（`F-010 AC-2`）。書き込み述語が
//    `tenant_id = app_tenant_id()` に固定されているため、他テナントの別名は 1 行も動かせない。
//
// 🔴 **`skill_aliases` はテナント内で共有される（C1）。パートナースコープで割らない。**
//    `docs/02` 章 4.2 の注記（`F-010` の `PA` / `PS` = `◐`）が根拠である ——
//    「`Skill` と `SkillAlias` は**分類のためのマスタであって業務データではなく**、他パートナーが
//    持ち込んだ情報を含まない。採否の決定はホスト（`OWNER` / `ADMIN` / `SALES`。🔴 `OWNER` は
//    T-06-01 で追加した暫定値。Issue #36 既定 A）が行い、採用後のテナント
//    別名はホストの決定物としてテナント内で共有される」。したがってここに
//    `partner_company_id` の絞り込みを**足さない**（足すと第二境界の設計が本書と食い違う）。
//    そのうえで**人物（起票者・決定者）は返さない** —— 表記は他社情報を含まないが、人物は含む。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` のみ）。結合テストがサーバを
//    立てずに同じ経路を実行できるようにするため（`engineers/service.ts` と同じ方針）。
import {
  uuidV7TimeOf,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
  type SkillAliasOrigin,
  type SkillAliasStatus,
} from '@ses/db';
import {
  ConcurrentUpdateError,
  ForbiddenError,
  GlobalSkillDictionaryReadOnlyError,
  InternalError,
  NotFoundError,
  SkillAliasAlreadyDecidedError,
  ValidationError,
} from '../api/errors';
import {
  decideSkillAliasDecision,
  type SkillAliasDecision,
  type SkillAliasDenialReason,
  type SkillAliasScope,
} from './policy';
import type { SkillAliasListQuery, SkillListQuery } from './schemas';

/**
 * docs/05 §16.1 の `*.update`。
 *
 * 🔴 **`skill_alias.decide` のような独自 action を作らない。** `S-041` の操作種別フィルタ
 *    （`CREATE_UPDATE_DELETE` = `.create` / `.update` / `.delete` の接尾辞一致。
 *    `lib/audit-logs/categories.ts`）から漏れ、**記録されているのに検索で出てこない**状態になる
 *    （`partner_company.suspend` を作らなかったのと同じ理由。docs/05 §16.1）。
 *    採用と却下の区別は `summary.decision` が持つ（`F-010 AC-3`）。
 */
export const SKILL_ALIAS_AUDIT_ACTIONS = {
  update: 'skill_alias.update',
} as const;

/** `GET /api/skills`（#23）の 1 件（`S-009` セクション 3 / `S-007` のスキル選択）。 */
export type SkillView = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
};

export type SkillListView = {
  readonly items: readonly SkillView[];
};

/**
 * `GET /api/skill-aliases`（#23）の 1 件（`S-009` セクション 1・2）。
 *
 * 🔴 **起票者（`proposedBy`）・採否者（`decidedBy`）の氏名を出さない。** `skill_aliases` は
 *    C1（テナント全体が読む）であり、パートナー所属の利用者も他社が起票した候補を読む。
 *    そこに人物を添えると、**他社に誰が居るかを知る経路**になる（`CLAUDE.md` §3.1 の 🔴
 *    「パートナー同士が相互に参照できる経路を 1 つも作らない」）。表記そのものは分類のための
 *    マスタであり他社の業務情報を含まないが、人物は含む。
 *    ⚠️ `docs/04` §S-009 の別名テーブルは「作成者」列を挙げているが、上記の理由で出していない
 *    （出すなら「ホスト所属の採否者に限る」等の規則が要り、それは越境設計の変更になる）。
 * 🔴 **`origin` は「AI が提案した正規化先」かどうかの由来表示に使う**（`docs/04` §9 の
 *    「常時 1 行」）。Phase 1 の候補はすべて `HUMAN` である（`AI` は `F-033` が起票する）。
 */
export type SkillAliasView = {
  readonly id: string;
  readonly alias: string;
  readonly status: SkillAliasStatus;
  readonly origin: SkillAliasOrigin;
  /** 🔴 `GLOBAL` = テナントから編集できない行（`F-010 AC-2`）。画面は操作を出さない。 */
  readonly scope: SkillAliasScope;
  /** 正規化先（採用時に確定する。`PROPOSED` / `REJECTED` では `null`）。 */
  readonly skillId: string | null;
  readonly skillName: string | null;
  /**
   * 起票日（`docs/04` §S-009 の「起票日」列）。
   * 🔴 `skill_aliases` に作成時刻の**列は無い**（docs/05 §3.4）。`id` は `@default(uuid(7))` で
   *    採番されるため、その上位 48 bit（採番時刻）を読み替えて出す —— docs/05 §16.5 が
   *    `email_dispatches` の滞留判定で行っているのと同じ扱いであり、**列を勝手に足さない**。
   *    読み替えられない値（v7 でない ID）は `null`（推測で埋めない）。
   */
  readonly proposedAt: string | null;
  readonly decidedAt: string | null;
};

export type SkillAliasListView = {
  readonly items: readonly SkillAliasView[];
};

/** 監査ログに残す実行環境（画面経路も同じ値を渡す）。 */
export type SkillAliasDecisionMeta = {
  readonly ipAddress: string | null;
};

/**
 * `GET /api/skills`（#23）。グローバル辞書の読み取り（`F-008` 処理② / `F-010 AC-2`）。
 *
 * 🔴 並びは `sortKey` 昇順（docs/05 §3.4 の「匿名候補のスキル並びの決定的なタイブレーク」）。
 *    同順は `id` で確定させる（docs/05 §4.8 の決定的順序）。
 * 🔴 `?q=` は業務上の絞り込みであって境界の絞り込みではない（`skills` に境界は無い）。
 */
export async function listSkills(
  ctx: AuthenticatedTenantCtx,
  query: SkillListQuery,
): Promise<SkillListView> {
  const q = query.q ?? '';
  return withTenant(ctx, async (db) => {
    const items = await db.skill.findMany({
      where: q === '' ? {} : { name: { contains: q, mode: 'insensitive' } },
      select: { id: true, name: true, category: true },
      orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
    });
    return { items };
  });
}

/** `skill_aliases` から読む列（🔴 `proposedBy` / `decidedBy` を読まない。上の型のコメント参照）。 */
const SKILL_ALIAS_SELECT = {
  id: true,
  tenantId: true,
  alias: true,
  status: true,
  origin: true,
  skillId: true,
  decidedAt: true,
  // 🔴 `skills` は射程外の 4 表であり、テナントの次元を持たない（ネスト読みで境界が
  //    緩む余地が無い）。`engineers/service.ts` の `readEngineerSkills` と同じ扱いにする。
  skill: { select: { name: true } },
} as const;

type SkillAliasRow = {
  readonly id: string;
  readonly tenantId: string | null;
  readonly alias: string;
  readonly status: string;
  readonly origin: string;
  readonly skillId: string | null;
  readonly decidedAt: Date | null;
  readonly skill: { readonly name: string } | null;
};

function toSkillAliasView(row: SkillAliasRow): SkillAliasView {
  return {
    id: row.id,
    alias: row.alias,
    status: row.status as SkillAliasStatus,
    origin: row.origin as SkillAliasOrigin,
    scope: row.tenantId === null ? 'GLOBAL' : 'TENANT',
    skillId: row.skillId,
    skillName: row.skill?.name ?? null,
    proposedAt: uuidV7TimeOf(row.id)?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

/**
 * `GET /api/skill-aliases`（#23）。テナント別名 + グローバル別名 + 新語候補。
 *
 * 🔴 グローバル行（`tenant_id IS NULL`）が混ざるのは**仕様である**（RLS の C1 の `SELECT` が
 *    `OR tenant_id IS NULL` を許す。docs/05 §4.4）。画面は `scope` で区別し、グローバル行には
 *    採否の操作を出さない（`F-010 AC-2`「テナントから編集できない」）。
 * 🔴 並びは表記の昇順（同順は `id`）。**採否で並びが変わらない**ようにする ——
 *    決めた瞬間に行が飛ぶと、続けて次を決めるときに取り違える（docs/05 §4.8 の決定的順序）。
 * 🔴 ページングを持たない（#23 の response が `{ items }`）。
 */
export async function listSkillAliases(
  ctx: AuthenticatedTenantCtx,
  query: SkillAliasListQuery,
): Promise<SkillAliasListView> {
  const q = query.q ?? '';
  return withTenant(ctx, async (db) => {
    const rows: readonly SkillAliasRow[] = await db.skillAlias.findMany({
      where: {
        ...(q === '' ? {} : { alias: { contains: q, mode: 'insensitive' as const } }),
        ...(query.status === undefined ? {} : { status: query.status }),
      },
      select: SKILL_ALIAS_SELECT,
      orderBy: [{ alias: 'asc' }, { id: 'asc' }],
    });
    return { items: rows.map(toSkillAliasView) };
  });
}

/** 拒否理由 → HTTP（`lib/members/service.ts` の `denialError` と同じ形）。 */
function denialError(reason: SkillAliasDenialReason): Error {
  switch (reason) {
    case 'ACTOR_ROLE_NOT_ALLOWED':
      return new ForbiddenError();
    case 'GLOBAL_ROW':
      return new GlobalSkillDictionaryReadOnlyError();
    case 'ALREADY_DECIDED':
      return new SkillAliasAlreadyDecidedError();
    case 'SKILL_REQUIRED':
    case 'SKILL_NOT_ALLOWED':
      return new ValidationError(['body.skillId']);
    default:
      // 🔴 網羅漏れを握り潰さない（`SkillAliasDenialReason` が増えたらここで気づく）。
      return new InternalError();
  }
}

export type SkillAliasDecisionInput = {
  readonly id: string;
  readonly decision: SkillAliasDecision;
  readonly skillId: string | null;
};

/**
 * `POST /api/skill-aliases/{id}/decide`（#24。`F-010 AC-1`〜`AC-3`）。
 *
 * 🔴 **採用されるまで検索の正規化に使われない**（`F-010 AC-1`）。この関数だけが
 *    `status` を `PROPOSED` から動かし、`skill_id`（正規化先）を埋める。起票（`F-008` の
 *    `newSkillLabels`）は `skill_id = NULL` の `PROPOSED` を作るだけであり、
 *    **辞書（`Skill`）には 1 行も足さない**（`F-010 AC-2`）。
 *
 * 🔴 監査は**業務トランザクションの内側**で書く（`withApiRoute` の `audit` オプションではない。
 *    `changeMemberRole` と同じ判断）。理由は 2 つ:
 *    ①`F-010 AC-3` は「採用・却下が残る」ことであり、**実際には起きなかった採否**
 *      （404 / 409 / 403）の記録を残さない
 *    ②`summary` に載せる「決定前の状態」と「正規化先」は、行を読むまで分からない
 *    記録できなければ更新も成立しない（同一トランザクション。`F-005`）。
 *
 * 🔴 更新は**条件付き UPDATE（CAS）**である。`where` に読んだ `status`（`PROPOSED`）を含める
 *    ため、並行して他者が決着させていれば 0 件になり **409** を返す（`docs/04` §S-009
 *    「候補が他者に採用済み → 『すでに採用されました』」）。**サーバ側で自動再試行しない。**
 */
export async function decideSkillAlias(
  ctx: AuthenticatedTenantCtx,
  input: SkillAliasDecisionInput,
  meta: SkillAliasDecisionMeta,
): Promise<void> {
  await withTenant(ctx, async (db) => {
    // 🔴 母集団は RLS の C1 が決める。`where` にテナント条件を書かない。見えなければ 404（§4.8）。
    const row = await db.skillAlias.findFirst({
      where: { id: input.id },
      select: { id: true, tenantId: true, status: true, origin: true },
    });
    if (row === null) throw new NotFoundError();

    const verdict = decideSkillAliasDecision(
      ctx.role,
      { scope: row.tenantId === null ? 'GLOBAL' : 'TENANT', status: row.status },
      { decision: input.decision, skillId: input.skillId },
    );
    if (!verdict.allowed) throw denialError(verdict.reason);

    // 🔴 正規化先はグローバル辞書に実在するものだけ（`F-008` の `assertSkillsExist` と同じ規律）。
    //    実在しない ID を許すと FK 違反が 500 になり、「入力の誤り」が障害に見える。
    if (input.skillId !== null) {
      const skill = await db.skill.findFirst({
        where: { id: input.skillId },
        select: { id: true },
      });
      if (skill === null) throw new ValidationError(['body.skillId']);
    }

    const decidedAt = new Date();
    const updated = await db.skillAlias.updateMany({
      // 🔴 CAS。読んだ状態を条件に含める（並行して決着していたら 0 件になる）。
      //    テナントの述語は Prisma 拡張が `tenant_id = ctx` として注入し、RLS の
      //    `UPDATE` ポリシーも同じ述語を要求する ＝ グローバル行はここでも 0 件になる。
      where: { id: row.id, status: 'PROPOSED' },
      data: {
        status: input.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
        // 🔴 `REJECT` は正規化先を持たない（`policy.ts` が `skillId !== null` を弾いている）。
        skillId: input.skillId,
        decidedBy: ctx.userId,
        decidedAt,
      },
    });
    if (updated.count !== 1) {
      // 行そのものが消えている（並行削除）なら 404、状態が変わっているなら 409。
      const current = await db.skillAlias.findFirst({
        where: { id: row.id },
        select: { id: true },
      });
      throw current === null ? new NotFoundError() : new ConcurrentUpdateError();
    }

    await writeAuditLog(db, {
      action: SKILL_ALIAS_AUDIT_ACTIONS.update,
      actorKind: 'USER',
      actorId: ctx.userId,
      targetType: 'SkillAlias',
      targetId: row.id,
      // 🔴 **別名の表記そのものを載せない。** 利用者の自由入力であり、氏名などが
      //    紛れ込みうる（`AuditLog.summary` に PII を入れない。docs/05 §16.2）。
      //    残すのは「何を決めたか」と「どこへ正規化したか」の ID だけである。
      summary: {
        decision: input.decision,
        skillId: input.skillId,
        origin: row.origin,
      },
      ipAddress: meta.ipAddress,
      deviceKind: ctx.deviceKind,
    });
  });
}
