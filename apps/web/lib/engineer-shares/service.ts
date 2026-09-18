// apps/web/lib/engineer-shares/service.ts
// 匿名共有の opt-in / 解除（docs/05 §6.4 #29。`F-016` / `S-015`）。T-08-02 → 🔴 T-11-11 で一覧を
// **検索 3 条件 + カーソルページング**に置き換えた（docs/05 §6.4「#29 の改訂」。T-08-02 の「上限 200 件・
// 検索なし・ページングなし」は、台帳が 200 件を超える取引先で 201 件目以降を共有可にも解除にもできず
// `F-016 AC-2` の実質的な違反だった）。
//
// ============================================================================
// 🔴 ここは越境経路 4（`CLAUDE.md` §3.1）の**入口**である
// ============================================================================
// 経路 4 は「ホストが取引先の人材を能動的に探せる」唯一の経路であり、
// 🔴 **開き方を誤ると台帳を丸ごと読めるのと同じになる。** 本モジュールが守るのは 5 つ:
//
//   ① 🔴 **既定オフは「行の非存在」で表現する**（`F-016 AC-1` / `BR-53`。docs/05 §3.5 の
//      `EngineerShare` のコメント）。boolean 列にしない・既定値を書かない・
//      **エンジニアの登録と同じトランザクションで行を作らない**。本モジュールは
//      `POST /api/engineers`（`#16`）から呼ばれない（呼ばれたら既定オフが崩れる）。
//   ② 🔴 **一括で全件をオンにする経路を作らない**（同上）。公開 API は 1 件単位だけであり、
//      `schemas.ts` に配列を受け取る形が存在しない。
//   ③ 🔴 **主導権は最後まで取引先にある**（`F-016` 関連ロール）。書き込めるのは
//      `PARTNER_ADMIN` / `PARTNER_SALES` だけで、ホスト側ロールは 403 になる
//      （ルートの `requireRole` と、本モジュールの `assertPartnerContext`）。
//   ④ 🔴 **解除は即時に反映される**（`F-016 AC-2`）。`revoked_at` を業務トランザクションで
//      立てるだけであり、ジョブもキューもキャッシュも挟まない。ホスト側の読み取り
//      （`app_engineer_is_shared()`。docs/05 §4.5。T-08-03）は `revoked_at IS NULL` を
//      述語に持つため、コミットした瞬間に候補から外れる。
//   ⑤ 🔴 **他のパートナーは、あるパートナーの共有の存在・件数を知れない**（`F-016 AC-5` /
//      `BR-56`）。母集団を決めるのは `engineer_shares` / `engineers` の RLS（C3
//      OWNER_SCOPED）であり、**本モジュールは `where` に `tenantId` /
//      `partnerCompanyId` / `ownerPartnerCompanyId` を 1 つも書かない**
//      （`lib/engineers/list.ts` と同じ規律。書けば境界の担保が条件式に移る）。
//
// 🔴 **他社のエンジニアを共有対象にできない。** 共有行の `engineer_id` は、
//    「自分の RLS 文脈で実在が確認できたエンジニア」からしか来ない
//    （`readOwnEngineer` が `null` を返せば 404。docs/05 §4.8「見えない ＝ 存在しない」）。
//    防御は 3 枚: ①`engineers` の RLS C3（他パートナー所有の行は見えない）
//    ②`engineer_shares` の `WITH CHECK`（`partner_company_id = app_partner_id()`。
//    docs/05 §4.4「WITH CHECK を C3 の式に絞る 4 表」）③`partnerCompanyId` を
//    **`ctx` からしか取らない**（リクエスト入力に現れる余地が無い）。
//
// 🔴 本モジュールは Next.js / Auth.js に依存しない（`@ses/db` / `@ses/domain` / `@ses/config`
//    のみ）。結合テストがサーバを立てずに同じ経路を実行できるようにするため
//    （`lib/engineers/service.ts` と同じ方針）。
import { ANONYMIZE_ROUNDING } from '@ses/config';
import {
  ENGINEER_LIST_ORDER_BY,
  engineerShareSearchWhere,
  withTenant,
  writeAuditLog,
  type AuthenticatedTenantCtx,
} from '@ses/db';
import {
  anonymizeEngineer,
  type AnonymizedRemoteMode,
  type AnonymizeSkillInput,
  type PrefectureCode,
  type RoundedAnonymousAttributes,
} from '@ses/domain';
import { ForbiddenError, NotFoundError } from '../api/errors';
import { buildCursorPage, takeForCursorPage, type CursorPage } from '../api/pagination';
import { toJstIsoDay } from '../format/datetime';
import { decimalToNumber, toDateOnlyString } from '../format/db-values';
import {
  decodeEngineerShareCursor,
  encodeEngineerShareCursor,
  engineerShareCursorMode,
  type EngineerShareCursor,
  type EngineerShareListQuery,
} from './schemas';

/**
 * docs/05 §16.1 の `*.create` / `*.update`（`F-016 AC-4`「共有の開始・停止が、実施者・対象・
 * 日時とともに監査ログに残る」）。
 *
 * 🔴 **独自 action（`engineer_share.grant` / `.revoke`）を作らない。** `S-041` の操作種別
 *    フィルタは**接尾辞一致**（`CREATE_UPDATE_DELETE` = `.create` / `.update` / `.delete`。
 *    `lib/audit-logs/categories.ts`）であり、独自名は**記録されているのに検索で出てこない**
 *    （`partner_company.suspend` / `skill_alias.decide` を作らなかったのと同じ轍。docs/05 §16.1）。
 *    開始と停止の区別は `summary.operation` に置く。
 */
export const ENGINEER_SHARE_AUDIT_ACTIONS = {
  /** 初めて共有した（`engineer_shares` に行ができた）。 */
  create: 'engineer_share.create',
  /** 解除した / 解除後に共有し直した（既存行の `revoked_at` が動いた）。 */
  update: 'engineer_share.update',
} as const;

/** `summary.operation`（🔴 氏名・スキル・単価を載せない。`AuditSummary` の規約）。 */
export const ENGINEER_SHARE_OPERATIONS = {
  share: 'SHARE',
  revoke: 'REVOKE',
} as const;

export type EngineerShareOperation =
  (typeof ENGINEER_SHARE_OPERATIONS)[keyof typeof ENGINEER_SHARE_OPERATIONS];

/**
 * `S-015` の 1 行（`GET /api/engineer-shares` / `PUT /api/engineers/{id}/share` の応答要素）。
 *
 * 🔴 `displayName` を持つのは、**これが取引先自身の台帳だから**である（`docs/04` §S-015
 *    「氏名（自社内表示）」）。ホスト向けの応答ではない —— ホストが読む型は
 *    `AnonymousCandidateView`（docs/05 §4.6。T-08-04）であり、そちらに氏名のフィールドは無い。
 * 🔴 `previewedFields` は**丸めた後の 5 項目だけ**である（docs/05 §6.4 #29 の「出力」/
 *    `docs/04` §5-2）。丸める前の値を並置して返さない —— 並置すると取引先の画面に
 *    「本当の値」が残り、どちらがホストに見えているのか分からなくなる。
 */
export type EngineerShareCandidateView = {
  readonly engineerId: string;
  readonly displayName: string;
  readonly shared: boolean;
  /** 共有開始日（JST 暦日）。共有していなければ `null`。 */
  readonly sharedOn: string | null;
  /** 🔴 **自社宛の**提案依頼の件数（`docs/04` §S-015）。他社宛は RLS が見せない（`F-018 AC-6`）。 */
  readonly proposalRequestCount: number;
  /**
   * 🔴 **丸めた後の 5 項目だけ。**
   *
   * ⚠️ `docs/04` §S-015 の一覧の列「稼働可能時期」も、ここ（`availabilityBand`）から出す。
   *    台帳の生の稼働可能日（`available_from`）を別の列として並べない —— 同じ画面に
   *    丸める前の値と丸めた後の値が並ぶと（§5-2 の「並置して見せない」）、取引先は
   *    **どちらがホストに見えているのか**を取り違える。これがこの画面の存在理由そのものである。
   */
  readonly previewedFields: RoundedAnonymousAttributes;
};

/**
 * `GET /api/engineer-shares`（docs/05 §6.4 #29）の応答 = **`{ items, nextCursor }` の 2 キー**。
 * 🔴 `total` / 残件数を持たない（`CursorPage` は `total` を持たない型。docs/05 §4.8 / `docs/04` 申し送り 18-①）。
 *    `view.types.test.ts` が `CursorPage<EngineerShareCandidateView>` との同一性を固定する。
 */
export type EngineerShareListView = CursorPage<EngineerShareCandidateView>;

/** `PUT /api/engineers/{id}/share`（同上）の応答。 */
export type EngineerShareUpdateView = {
  readonly engineerId: string;
  readonly shared: boolean;
  readonly sharedOn: string | null;
  readonly previewedFields: RoundedAnonymousAttributes;
};


/** `withTenant` が `fn` に渡すクライアントのうち、本モジュールが使う部分。 */
type EngineerShareDb = Parameters<Parameters<typeof withTenant<void>>[1]>[0];

/**
 * 🔴 **ホスト文脈からは 1 行も触らせない**（`F-016` 関連ロール「ホスト側ロールはこの設定を
 *    変更できない」）。
 *
 * ルートの `requireRole(['PARTNER_ADMIN','PARTNER_SALES'])` が先に 403 を返すので、
 * 通常はここへ到達しない。それでも置くのは、**ロールと所属は別の軸**だからである ——
 * ロールの一覧を書き換えた誰かが所属の条件まで見直すとは限らず、そのとき
 * 「ホスト所属なのにパートナーロールを持つ」ケースが静かに通る。
 * 🔴 ここが `null` を許すと `partner_company_id` に入れる値が無くなり、RLS の `WITH CHECK`
 *    （`partner_company_id = app_partner_id()` = NULL）で落ちる —— **落ち方を 500 ではなく
 *    403 にする**ためでもある。
 */
function assertPartnerContext(ctx: AuthenticatedTenantCtx): string {
  if (ctx.partnerCompanyId === null) throw new ForbiddenError();
  return ctx.partnerCompanyId;
}

/**
 * 丸めに要る列だけを読む。
 *
 * 🔴 `city` を **`select` している**のは、`anonymizeEngineer` が「受け取って落とす」形で
 *    市区町村を捨てることをテストで証明できるようにするためである
 *    （`packages/domain/src/anonymize/rounding.ts` の `AnonymizeEngineerInput.city`）。
 * 🔴 `birthDate` / `contactEmail` / `contactPhone` / `affiliationLabel` / `preferenceNote` は
 *    **読まない**。丸めても出せない値であり、読めば応答の組み立てを間違えたときに漏れる。
 */
const ENGINEER_SHARE_SOURCE_SELECT = {
  id: true,
  displayName: true,
  availableFrom: true,
  unitPriceMin: true,
  unitPriceMax: true,
  prefecture: true,
  city: true,
  remoteMode: true,
  updatedAt: true,
} as const;

type EngineerShareSourceRow = {
  readonly id: string;
  readonly displayName: string;
  readonly availableFrom: Date | null;
  readonly unitPriceMin: { toString(): string } | null;
  readonly unitPriceMax: { toString(): string } | null;
  readonly prefecture: string | null;
  readonly city: string | null;
  readonly remoteMode: string | null;
  readonly updatedAt: Date;
};

type ShareStateRow = {
  readonly engineerId: string;
  readonly sharedAt: Date;
  readonly revokedAt: Date | null;
};

/**
 * 1 ページ分のスキルを 1 往復で読む（エンジニアごとに引くと N+1 になる。
 * `lib/engineers/list.ts` の `readPrimarySkills` と同じ形）。
 *
 * 🔴 **上位 8 件の選別をここで行わない。** 選別（経験年数の降順 → `sortKey` → `skillId`）は
 *    `anonymizeEngineer` の中にしかない（`docs/02` A-04 ①）。ここで先に切ると、
 *    丸めの実装が 2 本になる。
 */
async function readAnonymizeSkills(
  db: EngineerShareDb,
  engineerIds: readonly string[],
): Promise<ReadonlyMap<string, readonly AnonymizeSkillInput[]>> {
  const result = new Map<string, AnonymizeSkillInput[]>();
  if (engineerIds.length === 0) return result;

  const rows = await db.engineerSkill.findMany({
    where: { engineerId: { in: [...engineerIds] } },
    select: {
      engineerId: true,
      skillId: true,
      yearsOfExperience: true,
      skill: { select: { name: true, sortKey: true } },
    },
  });

  for (const row of rows) {
    const entry: AnonymizeSkillInput = {
      skillId: row.skillId,
      sortKey: row.skill.sortKey,
      name: row.skill.name,
      yearsOfExperience: Number(row.yearsOfExperience.toString()),
    };
    const bucket = result.get(row.engineerId);
    if (bucket === undefined) result.set(row.engineerId, [entry]);
    else bucket.push(entry);
  }
  return result;
}

/**
 * 自社宛の提案依頼の件数（`docs/04` §S-015 の列）。
 *
 * 🔴 母集団は `proposal_requests` の RLS が決める（依頼先 = 自社の行だけ）。
 *    したがって **同じ候補に他社から依頼が来ているかは数に現れない**（`F-018 AC-6`）。
 * ⚠️ 行が立ち始めるのは T-08-06 / T-08-07 である。Phase 1 の現時点では常に 0 になるが、
 *    列を後から足すと `docs/04` §S-015 の一覧の形が変わるため、初めから数えておく。
 */
async function readProposalRequestCounts(
  db: EngineerShareDb,
  engineerIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const result = new Map<string, number>();
  if (engineerIds.length === 0) return result;

  const rows = await db.proposalRequest.findMany({
    where: { engineerId: { in: [...engineerIds] } },
    select: { engineerId: true },
  });
  for (const row of rows) {
    result.set(row.engineerId, (result.get(row.engineerId) ?? 0) + 1);
  }
  return result;
}

/** 丸めた 5 項目を作る（`anonymizeEngineer` を呼ぶ唯一の場所）。 */
function previewOf(
  row: EngineerShareSourceRow,
  skills: readonly AnonymizeSkillInput[],
  referenceDate: string,
): RoundedAnonymousAttributes {
  return anonymizeEngineer(
    {
      skills,
      unitPriceMinYen: decimalToNumber(row.unitPriceMin),
      unitPriceMaxYen: decimalToNumber(row.unitPriceMax),
      // 🔴 `available_from` は `@db.Date`（時刻を持たない）。TZ 変換を掛けると 1 日ずれる。
      availableFrom: toDateOnlyString(row.availableFrom),
      prefecture: row.prefecture as PrefectureCode | null,
      city: row.city,
      remoteMode: row.remoteMode as AnonymizedRemoteMode | null,
      // 🔴 `updated_at` は `timestamptz`。**JST の暦日**に丸める（docs/05 §4.6.3 の申し送り:
      //    `toJstIsoDay` を通すこと。UTC 切り出しだと JST 0:00〜8:59 の更新が前日になる）。
      updatedOnJst: toJstIsoDay(row.updatedAt),
    },
    { referenceDate },
    ANONYMIZE_ROUNDING,
  );
}

function toCandidateView(
  row: EngineerShareSourceRow,
  share: ShareStateRow | undefined,
  skills: readonly AnonymizeSkillInput[],
  proposalRequestCount: number,
  referenceDate: string,
): EngineerShareCandidateView {
  const shared = share !== undefined && share.revokedAt === null;
  return {
    engineerId: row.id,
    displayName: row.displayName,
    shared,
    sharedOn: shared && share !== undefined ? toJstIsoDay(share.sharedAt) : null,
    proposalRequestCount,
    previewedFields: previewOf(row, skills, referenceDate),
  };
}

/** `EngineerShareListQuery` のうち、母集団と並びを決める部分（`limit` を除く）。 */
/**
 * 一覧の検索条件。`cursor` は**復号済み**（`decodeEngineerShareCursor`）。
 * 🔴 復号は `withTenant` の**外**で行う（T-12-17 ②）—— 形が不正なカーソル（400）のためにトランザクションと
 *    `SET LOCAL` を開かない。
 */
type EngineerShareListCriteria = Pick<EngineerShareListQuery, 'q' | 'availableBy' | 'shared'> & {
  readonly cursor: EngineerShareCursor | undefined;
};

/**
 * `shared=true` の駆動表 `engineer_shares` のキーセット述語（`shared_at DESC, engineer_id DESC` の「その後ろ」）。
 * 🔴 Prisma の `cursor: { id } + skip: 1` を使わない —— 境目の行が解除・削除されても次ページが空にならない
 *    （T-05-09 の ID カーソルの弱点〔行が消えると 0 件〕を本画面に持ち込まない。1 件ずつ解除する画面では
 *    **境目の行が消えるのが通常動作**である）。
 */
function sharedKeysetAfter(cursor: EngineerShareCursor) {
  return {
    OR: [
      { sharedAt: { lt: cursor.at } },
      { sharedAt: cursor.at, engineerId: { lt: cursor.engineerId } },
    ],
  };
}

/** `engineers` のキーセット述語（`updated_at DESC, id DESC` の「その後ろ」）。 */
function updatedKeysetAfter(cursor: EngineerShareCursor) {
  return {
    OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { lt: cursor.engineerId } }],
  };
}

/**
 * 共有中の行を駆動表にして 1 ページ分を並びのまま得る（`shared=true`）。
 *
 * 🔴 `engineers` 側からは to-many の列（`shared_at`）で `orderBy` できないため、`engineer_shares` を先に読む。
 *    `@@unique([tenantId, engineerId])` により `engineer_id` で全順序になる。共有し直すと `shared_at` が
 *    更新される（`setEngineerShare`）ので「最近共有した人が先」。
 * 🔴 `where` に書くのは `revoked_at IS NULL`・検索条件・キーセットだけである。母集団は `engineer_shares` /
 *    `engineers` の RLS（C3）が決め、リレーション条件は `EXISTS` 副問い合わせに落ちて RLS がそのまま効く。
 */
async function readSharedPage(
  db: EngineerShareDb,
  criteria: EngineerShareListCriteria,
  limit: number,
): Promise<CursorPage<ShareStateRow>> {
  const cursor = criteria.cursor;
  const rows = await db.engineerShare.findMany({
    where: {
      revokedAt: null,
      engineer: engineerShareSearchWhere({ q: criteria.q, availableBy: criteria.availableBy }),
      ...(cursor === undefined ? {} : sharedKeysetAfter(cursor)),
    },
    select: { engineerId: true, sharedAt: true, revokedAt: true },
    orderBy: [{ sharedAt: 'desc' }, { engineerId: 'desc' }],
    take: takeForCursorPage(limit),
  });
  return buildCursorPage(rows, limit, (row) =>
    encodeEngineerShareCursor('s', { at: row.sharedAt, engineerId: row.engineerId }),
  );
}

/**
 * `engineers` を駆動表にして 1 ページ分を得る（`shared=false` と省略）。並びは `ENGINEER_LIST_ORDER_BY`
 * （`updated_at DESC, id DESC`。`S-005` と同じ）。
 * 🔴 `shared=false` は `engineerShares: { none: { revokedAt: null } }` を AND する —— 既定オフは「行の非存在」
 *    （T-08-02 ①）のままであり、boolean 列を足さない。
 * 🔴 **共有状態でグループ分けしない**（`すべて` で共有中を先に固めない。`docs/04` §S-015）。
 */
async function readLedgerPage(
  db: EngineerShareDb,
  criteria: EngineerShareListCriteria,
  limit: number,
): Promise<CursorPage<EngineerShareSourceRow>> {
  const cursor = criteria.cursor;
  const rows = await db.engineer.findMany({
    where: {
      AND: [
        engineerShareSearchWhere({ q: criteria.q, availableBy: criteria.availableBy }),
        ...(criteria.shared === 'false' ? [{ engineerShares: { none: { revokedAt: null } } }] : []),
        ...(cursor === undefined ? [] : [updatedKeysetAfter(cursor)]),
      ],
    },
    select: ENGINEER_SHARE_SOURCE_SELECT,
    orderBy: [...ENGINEER_LIST_ORDER_BY],
    take: takeForCursorPage(limit),
  });
  return buildCursorPage(rows, limit, (row) =>
    encodeEngineerShareCursor('u', { at: row.updatedAt, engineerId: row.id }),
  );
}

/**
 * `GET /api/engineer-shares`（docs/05 §6.4「#29 の改訂」/ `S-015` のセクション 2〜5）。
 *
 * 🔴 返すのは**自社の台帳だけ**である（`engineers` / `engineer_shares` の RLS C3）。**検索はその自社行に対して
 *    生値で評価する**（`engineerShareSearchWhere`。匿名候補の丸め後の区分に対する評価〔`anonymous-candidates.ts`〕
 *    とは無関係で、`withSharedCandidateScope` も使わない）。他社の行は `q` に一致しても 1 件も返らない（`F-016 AC-5`）。
 * 🔴 応答は `{ items, nextCursor }` の 2 キー。**総件数・残件数を返さない**（docs/05 §4.8）。
 * 🔴 並びはサーバで確定する（画面はソートし直さない）: `shared=true` → `shared_at DESC, engineer_id DESC` /
 *    それ以外 → `updated_at DESC, id DESC`。駆動表は前者が `engineer_shares`、後者が `engineers`。
 * 🔴 一覧と共有状態を**同じトランザクション**で読む。別々に読むと、解除の直後に
 *    「一覧には出ているが共有中の印が残っている」中間状態が見える。
 * 🔴 `previewedFields` の契約（丸め後の 7 フィールド）は変えない。`readAnonymizeSkills` / `readProposalRequestCounts`
 *    は**ページ分（≤ 200 件）だけ**を 1 往復ずつ（N+1 なし）。
 *
 * @param referenceDate 丸めの基準日（JST の `YYYY-MM-DD`）。🔴 `packages/domain` に
 *        現在時刻を持ち込まないための注入（docs/05 §4.6.1）。呼び出し側が `toJstIsoDay` で作る。
 */
export async function listEngineerShares(
  ctx: AuthenticatedTenantCtx,
  query: EngineerShareListQuery,
  referenceDate: string,
): Promise<EngineerShareListView> {
  assertPartnerContext(ctx);
  // 🔴 カーソルの復号は `withTenant` の手前（T-12-17 ②）。不正な形は 400 になるだけで、DB には触れない。
  const criteria: EngineerShareListCriteria = {
    q: query.q,
    availableBy: query.availableBy,
    shared: query.shared,
    cursor: query.cursor === undefined ? undefined : decodeEngineerShareCursor(query.cursor, query.shared),
  };

  return withTenant(ctx, async (db) => {
    let engineers: readonly EngineerShareSourceRow[];
    let shareOf: ReadonlyMap<string, ShareStateRow>;
    let nextCursor: string | null;

    if (engineerShareCursorMode(criteria.shared) === 's') {
      const page = await readSharedPage(db, criteria, query.limit);
      const ids = page.items.map((row) => row.engineerId);
      const sources =
        ids.length === 0
          ? []
          : await db.engineer.findMany({
              where: { id: { in: ids } },
              select: ENGINEER_SHARE_SOURCE_SELECT,
            });
      // 🔴 `engineer_shares` 側の順序を保って組み立てる（`IN` の結果順に依存しない）。
      const sourceOf = new Map<string, EngineerShareSourceRow>(sources.map((row) => [row.id, row]));
      engineers = ids.flatMap((id) => {
        const row = sourceOf.get(id);
        return row === undefined ? [] : [row];
      });
      shareOf = new Map(page.items.map((row) => [row.engineerId, row]));
      nextCursor = page.nextCursor;
    } else {
      const page = await readLedgerPage(db, criteria, query.limit);
      engineers = page.items;
      nextCursor = page.nextCursor;
      if (criteria.shared === 'false' || engineers.length === 0) {
        shareOf = new Map();
      } else {
        const shares = await db.engineerShare.findMany({
          where: { engineerId: { in: engineers.map((row) => row.id) }, revokedAt: null },
          select: { engineerId: true, sharedAt: true, revokedAt: true },
        });
        shareOf = new Map(shares.map((row) => [row.engineerId, row]));
      }
    }

    const engineerIds = engineers.map((row) => row.id);
    const [skills, requestCounts] = await Promise.all([
      readAnonymizeSkills(db, engineerIds),
      readProposalRequestCounts(db, engineerIds),
    ]);

    return {
      items: engineers.map((row) =>
        toCandidateView(
          row,
          shareOf.get(row.id),
          skills.get(row.id) ?? [],
          requestCounts.get(row.id) ?? 0,
          referenceDate,
        ),
      ),
      nextCursor,
    };
  });
}

/**
 * 🔴 台帳が 1 件でもあるか（`S-015` の初回空〔台帳 0 件〕の判定。docs/05 §6.4「#29 の改訂」の「初回空の判定」）。
 *
 * 応答に `total` / `ledgerEmpty` を足さない（2 キーの契約）ため、`page.tsx` が API とは**別に**これを読み、
 * `docs/04` §S-015 の空状態（台帳 0 件 / 条件なし 0 件 / 条件あり 0 件）を出し分ける。
 * 🔴 自社の台帳の有無（RLS C3 の自社行）であり、境界の情報ではない。**API-only の利用者には存在しない値**である。
 */
export async function hasAnyEngineer(ctx: AuthenticatedTenantCtx): Promise<boolean> {
  assertPartnerContext(ctx);
  return withTenant(ctx, async (db) => {
    const row = await db.engineer.findFirst({ select: { id: true } });
    return row !== null;
  });
}

/** 監査ログに載せる補助情報（IP はリクエストから、端末種別は ctx から）。 */
export type EngineerShareMeta = {
  readonly ipAddress: string | null;
};

/**
 * `PUT /api/engineers/{id}/share`（docs/05 §6.4 #29 / `F-016` 処理①③④）。
 *
 * 🔴 **冪等である。** 既に共有中のエンジニアを再度 `shared: true` にしても行は動かず、
 *    **監査ログも書かない** —— 起きなかった操作を記録すると、`S-041` の「誰がいつ共有を
 *    始めたか」が同じ操作の繰り返しで埋まる（`skill_sheet.*` を `audit` オプションではなく
 *    業務トランザクション内で書いているのと同じ判断。docs/05 §16.1）。
 * 🔴 監査ログは**業務トランザクションの内側**（`writeAuditLog`）で書く。書けなければ
 *    トランザクションごと巻き戻り、**共有も成立しない**（`F-005` / `F-012 AC-2`）。
 * 🔴 **解除に取り消しの猶予を置かない**（`F-016 AC-2`「即時に反映され」）。
 *    ジョブにもキューにも載せない。
 */
export async function setEngineerShare(
  ctx: AuthenticatedTenantCtx,
  engineerId: string,
  shared: boolean,
  meta: EngineerShareMeta,
  referenceDate: string,
): Promise<EngineerShareUpdateView> {
  const partnerCompanyId = assertPartnerContext(ctx);

  return withTenant(ctx, async (db) => {
    // 🔴 母集団は `engineers` の RLS（C3）が決める。**他パートナー所有・ホスト所有の
    //    エンジニアはここで `null` になり 404 になる**（docs/05 §4.8）。
    //    ここに `where: { ownerPartnerCompanyId: ctx.partnerCompanyId }` を書かない。
    const engineer = await db.engineer.findFirst({
      where: { id: engineerId },
      select: ENGINEER_SHARE_SOURCE_SELECT,
    });
    if (engineer === null) throw new NotFoundError();

    const existing = await db.engineerShare.findFirst({
      where: { engineerId: engineer.id },
      select: { id: true, engineerId: true, sharedAt: true, revokedAt: true },
    });
    const currentlyShared = existing !== null && existing.revokedAt === null;

    const now = new Date();

    if (shared !== currentlyShared) {
      if (existing === null) {
        // 🔴 既定オフは「行の非存在」。**初めての共有でだけ行ができる**（`F-016 AC-1`）。
        // 🔴 `partnerCompanyId` / `sharedBy` はいずれも認証コンテキスト由来である。
        await db.engineerShare.create({
          data: {
            tenantId: ctx.tenantId,
            engineerId: engineer.id,
            partnerCompanyId,
            sharedAt: now,
            revokedAt: null,
            sharedBy: ctx.userId,
          },
          select: { id: true },
        });
      } else {
        // 🔴 `update` ではなく `updateMany` を使う（`updateEngineer` と同じ理由）。スコープは
        //    第 2 防御が注入した `where` と RLS が決め、アプリは `id` 以外の条件を書かない。
        // 🔴 `partner_company_id` を `data` に載せない（共有元は付け替えない。DB 側でも
        //    C3 の `WITH CHECK` が `app_partner_id()` 以外への付け替えを拒否する）。
        //    解除は `revoked_at` を立てるだけ、再共有は `revoked_at` を戻して開始日を更新する。
        const updated = await db.engineerShare.updateMany({
          where: { id: existing.id },
          data: shared
            ? { revokedAt: null, sharedAt: now, sharedBy: ctx.userId }
            : { revokedAt: now },
        });
        // 境界外・不存在は 404（`updateEngineer` と同じ。ここに到達するのは同時実行のときだけ）。
        if (updated.count === 0) throw new NotFoundError();
      }

      await writeAuditLog(db, {
        action:
          existing === null
            ? ENGINEER_SHARE_AUDIT_ACTIONS.create
            : ENGINEER_SHARE_AUDIT_ACTIONS.update,
        actorKind: 'USER',
        actorId: ctx.userId,
        targetType: 'EngineerShare',
        targetId: engineer.id,
        // 🔴 氏名・スキル・単価・稼働可能時期を 1 つも載せない（§16.2 の `summary` の規約）。
        //    残すのは「どちらへ動いたか」だけである。
        summary: {
          operation: shared ? ENGINEER_SHARE_OPERATIONS.share : ENGINEER_SHARE_OPERATIONS.revoke,
          engineerId: engineer.id,
        },
        ipAddress: meta.ipAddress,
        deviceKind: ctx.deviceKind,
      });
    }

    // 🔴 応答は**書いた値の再読み取り**から作る（書いたつもりの値から組み立てない）。
    //    同じトランザクションの中なので、これが「いまホストから見えている状態」そのものである。
    const [row, skills] = await Promise.all([
      db.engineerShare.findFirst({
        where: { engineerId: engineer.id },
        select: { engineerId: true, sharedAt: true, revokedAt: true },
      }),
      readAnonymizeSkills(db, [engineer.id]),
    ]);
    const isShared = row !== null && row.revokedAt === null;
    return {
      engineerId: engineer.id,
      shared: isShared,
      sharedOn: isShared && row !== null ? toJstIsoDay(row.sharedAt) : null,
      previewedFields: previewOf(engineer, skills.get(engineer.id) ?? [], referenceDate),
    };
  });
}
