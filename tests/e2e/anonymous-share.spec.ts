// tests/e2e/anonymous-share.spec.ts
// 🔴 **`CLAUDE.md` §5 Phase 1 の成功条件 3 の証明**（docs/05 §17.3 #5 / #6。
//    `docs/sprints/SP-08-anonymous-share.md` §5 T-08-09。K-4: このテストが無い / 赤のままスプリントを閉じない）:
//
//    「パートナーが共有可にしたエンジニアが**ホストの検索結果に匿名 5 項目でのみ現れ、`Proposal` が
//      作成されるまで実名・所属会社名・スキルシートに到達できない**ことをテストで証明できる」
//
// シナリオ（本ファイルの `test` と 1 対 1。🔴 **直列で状態を引き継ぐ**ため `serial`）:
//   ① パートナー A1 がエンジニア X を登録 → **共有オフ**であることを確認 → 共有可に設定する（`S-015`）
//   ② ホストが `S-016` を開く → **X が匿名 5 項目でのみ現れる**。画面・API（#30 / `#15?projectId=`）の
//      いずれにも実名・所属会社名・社内 ID・営業メモ・スキルシート・詳細な経歴の並びが**含まれない**
//      （🔴 API 応答は JSON を深さ走査する。`tests/isolation/anonymous-candidate-view.test.ts` と同じ手口）
//   ③ 🔴 **`Proposal` が作成される前に実名・所属会社名・スキルシートへ到達できる導線が 1 つも無い**
//      （`F-017 AC-6`。画面・API・URL 直打ちのすべて）
//   ④ ホストが提案依頼を送る（`S-016` → #31）→ A1 が**辞退**（`S-018` → #34。理由を入力）→ ホスト側
//      （`S-017` / #32 / 監査ログ）に理由が現れない。`DECLINED` と `EXPIRED` が区別できる
//      （`EXPIRED` は worker 不在のため `harness/db-admin.ts` のシームで期限到来の前提を作る）
//   ⑤ 別の候補で**応諾**（#33）→ `Proposal(DRAFT)` が 1 件生成され、**その時点で**ホストが `Proposal` に
//      到達でき（#40）、凍結行に実名と最新 CLEAN 版のスキルシートが写っている（`EngineerSnapshot`）
//   ⑥ 同一候補が別の案件の一覧にも現れるとき、**参照子が異なり突合できない**（#30 を 2 案件で）
//   ⑦ パートナー A2 の画面 / API（`S-015` / #32 / `S-018` / #30）に、A1 の共有候補・依頼が
//      **1 件も現れない**（存在・件数とも。A1 の活動の前後で A2 の応答が 1 バイトも変わらない）
//   ⑧ A1 が共有を停止（`S-015`）→ ホストの `S-016` / #30 から**即座に消える**（`cache-control: no-store`）
//
// ============================================================================
// 🔴 本ファイルが守る前提と、他 spec への配慮
// ============================================================================
//   - **外部 API は叩かない。** `APP_ENV=development`（全コネクタがモック。`CLAUDE.md` §11）で、
//     各 test の末尾に `session.outbound.assertNone()` を置く。提案依頼の通知は Phase 1 ではアプリ内表示であり、
//     メールは 1 通も飛ばない（`docs/sprints/SP-08` §6「本スプリントは外部 API を叩かない」）。
//     MinIO への PUT（スキルシートの実体）は E2E ハーネスが自分で起動したコンテナ宛であり
//     （`audit-k7.spec.ts` と同じ経路・同じ理由で Node 側から送る）、外部ではない。
//   - **新しい seed を足さない。** X / Y / Z は test の中で API 経由で作る。seed の ID・アカウントは
//     既存 spec と同じく `support/population.ts` / `support/sessions.ts` から取る。
//   - 🔴 **提案依頼は `publishedProjectId` にだけ発行する。** `projects.mobile.spec.ts`（mobile プロジェクト。
//     本ファイルの後に走る）は `privateProjectId` の共有候補の**先頭行**に依頼を出して取り下げる。
//     `@@unique([tenantId, projectId, engineerId])` により、本ファイルが未公開案件に依頼を残すと
//     あちらが 409 になる。公開案件側は「全共有候補に発行し 409 を許す」形なので、X / Y / Z の
//     終端状態（`DECLINED` / `ACCEPTED` / `EXPIRED`）が残っていても seed の A1 エンジニアへの
//     新規発行（201）が成立し、A1 の一覧に「返答待ち」が現れる（設計どおり）。
//   - **判定を緩めない。** `support/assertions.ts` の閾値・パターンは無改変で、`S-016` / `S-017` / `S-018` に
//     `expectNoBrokenLabels`（T-08-11 の申し送り）を掛ける。
//   - 🔴 **後始末で A1 の台帳を seed の状態に戻す**（`afterAll` → `deleteT0809SyntheticEngineers`）。DB は実行ごとに
//     作り直されるが、同じ実行の中では spec 間で共有される。`isolation.spec.ts` ④ T-05-09 は「A1 の台帳は seed の
//     1 件だけ」を表明しており（アルファベット順で本 spec が先に走る）、増やした側が戻す。途中で落ちても `afterAll` は走る。
//
// ============================================================================
// 🔴 「ホストは X を識別できない」のに、テストはどうやって X の行を掴むか
// ============================================================================
// 参照子（`candidateRef`）は案件スコープの HMAC であり、ホストは**どの参照子が誰か分からない**（設計）。
// テストは**共有元（A1）の操作の前後で #30 の参照子集合を差分**して X の参照子を知る（差分が
// ちょうど 1 件であることも表明する）。これは「X を共有した本人だけが知り得る対応」であり、
// ホストの応答から X を特定したのではない。
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import { isolationSeedCompanyNames } from '@ses/db/seed';
import { t } from '../../packages/i18n/src/index';
import {
  assertEngineerSnapshotFrozen,
  deleteT0809SyntheticEngineers,
  expireProposalRequestByDeadline,
  markSkillSheetClean,
  T0809_SYNTHETIC_ENGINEER_PREFIX,
} from './harness/db-admin';
import { apiRequest, auditLogPeriodQuery, parseJson, type ApiResponse } from './support/api';
import { expectNoBrokenLabels, expectNoHiddenCountHints } from './support/assertions';
import { partnerIds, tenantIds } from './support/population';
import { hostOwner, openTenantSession, partnerSales, type Session } from './support/sessions';

// 🔴 8 シナリオは状態を引き継ぐ（①で作った X を⑧で解除する）。1 つ落ちたら以降を走らせない。
test.describe.configure({ mode: 'serial' });

// 🔴 後始末（冒頭コメント）。合成エンジニア（X / Y / Z）と、そこから CASCADE で辿れる行（共有・依頼・下書き・凍結）を消す。
//    `audit_logs` は残る。落ちた test があっても走る。
test.afterAll(() => {
  deleteT0809SyntheticEngineers(engineers().map((engineer) => engineer.id));
});

// ---------------------------------------------------------------------------
// 合成データ（`BR-47`。値をベタ書きしない: 接頭辞 + 乱数）
// ---------------------------------------------------------------------------

const RUN = randomUUID().slice(0, 8);

/** 実在しない UUID（境界外の 404 と「存在しない」の応答が同一であることの対照）。 */
const ABSENT_UUID = '01999999-9999-7999-8999-999999999999';

/** 本ファイルが作る A1 所属のエンジニア（応答に 1 文字も現れてはならない値を全部持つ）。 */
type SyntheticEngineer = {
  readonly label: 'X' | 'Y' | 'Z';
  readonly id: string;
  readonly displayName: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly preferenceNote: string;
  /** 丸める前の単価（円）。応答には 10 万円刻みの区分（`priceBand`）しか出てはならない。 */
  readonly unitPrice: number;
  /** 丸める前の稼働開始日（`YYYY-MM-DD`）。応答には 5 段階（`availabilityBand`）しか出てはならない。 */
  readonly availableFrom: string;
  /** 辞書 ID。応答には `skills[].name` しか出てはならない（案件をまたいだ突合の材料）。 */
  readonly skillIds: readonly string[];
  readonly skillSheet: { readonly id: string; readonly objectKey: string; readonly fileName: string } | null;
  /**
   * 🔴 T-09-12: 経験内容（`engineer_careers`）4 行の役割 / 業務内容 / 使用技術に埋めた目印。
   *    **細かい経歴の並びは同一人物を案件をまたいで追跡させる代表例**であり（`F-008 AC-7` / `BR-55`）、
   *    ホストの `S-005` / `S-016` の応答 JSON・画面・監査ログのいずれにも 1 文字も現れてはならない。
   */
  readonly careerMarkers: readonly string[];
};

/** 直列で引き継ぐ状態。 */
const state: {
  x: SyntheticEngineer | null;
  y: SyntheticEngineer | null;
  z: SyntheticEngineer | null;
  /** 公開案件 / 未公開案件での X / Y / Z の参照子（共有元の操作の差分で知る）。 */
  refs: { published: Partial<Record<'X' | 'Y' | 'Z', string>>; private: Partial<Record<'X' | 'Y' | 'Z', string>> };
  requests: { x: string | null; y: string | null; z: string | null };
  declineReason: string;
  proposalId: string | null;
  /** ⑦: A1 の活動の前に取った A2 の応答（バイト列で比較する）。 */
  a2Baseline: { requests: string; shares: string } | null;
} = {
  x: null,
  y: null,
  z: null,
  refs: { published: {}, private: {} },
  requests: { x: null, y: null, z: null },
  declineReason: `T0809辞退理由-${RUN}-他案件で内定が出たため`,
  proposalId: null,
  a2Baseline: null,
};

const PUBLISHED_PROJECT_ID = tenantIds(1).publishedProjectId;
const PRIVATE_PROJECT_ID = tenantIds(1).privateProjectId;
const A1 = partnerIds(1, 1);
const A1_COMPANY_NAME = isolationSeedCompanyNames(1).partners[0];

/** 🔴 提案依頼の本文。商流情報（単価・エンド企業名）を含めない（#31 は 422 で弾く）。 */
const REQUEST_MESSAGE = '11 月上旬の開始を希望しています。面談は来週中に設定可能です。';

// ---------------------------------------------------------------------------
// 開示の契約（何が出てよいか）。🔴 実装ではなく設計書から引く
// ---------------------------------------------------------------------------

/**
 * 匿名候補 1 件に現れてよいキー（docs/05 §4.6 `AnonymousCandidateView`。5 項目 + 参照子 + 丸めた更新日）。
 * 🔴 実装の定数（`ANONYMOUS_CANDIDATE_VIEW_KEYS`）を import しない —— E2E は「設計が許した集合」を
 *    独立に持ち、実装側が増えたら**ここで落ちる**ようにする（開示項目の追加は人間の承認事項。`CLAUDE.md` §8.6）。
 *    実装の定数と型の一致は `tests/isolation/anonymous-candidate-view.test.ts` が固定する。
 */
const ANONYMOUS_TOP_LEVEL_KEYS = [
  'candidateRef',
  'skills',
  'yearsBand',
  'priceBand',
  'availabilityBand',
  'prefecture',
  'remoteMode',
  'updatedOn',
] as const;
/** 値オブジェクトの内側だけに現れてよいキー（`skills[].name` / `priceBand.{kind,fromManYen,toManYen}`）。 */
const ANONYMOUS_NESTED_KEYS = ['name', 'kind', 'fromManYen', 'toManYen'] as const;
const ANONYMOUS_ALLOWED_KEYS: ReadonlySet<string> = new Set([...ANONYMOUS_TOP_LEVEL_KEYS, ...ANONYMOUS_NESTED_KEYS]);

/** 5 項目の区分値（docs/02 A-04 / docs/03 §4.13.1。これ以外の粒度が出たら丸めが破れている）。 */
const YEARS_BANDS = ['LT_1Y', 'Y1_3', 'Y3_5', 'Y5_10', 'GTE_10Y'] as const;
const AVAILABILITY_BANDS = ['IMMEDIATE', 'THIS_MONTH', 'NEXT_MONTH', 'MONTH_AFTER_NEXT', 'THREE_MONTHS_OR_LATER'] as const;
const REMOTE_MODES = ['FULL_REMOTE', 'PARTIAL_REMOTE', 'ONSITE_ONLY'] as const;

/**
 * 🔴 匿名候補のどの深さにも現れてはならないキー名（`tests/isolation/anonymous-candidate-view.test.ts` の
 *    `FORBIDDEN_KEYS` と同じ集合。実名・連絡先・所属・営業メモ・社内 ID・辞書 ID・生の更新日時・
 *    丸める前の単価 / 稼働開始日・スキルシート・経歴・スコア / 順位）。
 */
const ANONYMOUS_FORBIDDEN_KEYS = [
  'displayName',
  'contactEmail',
  'contactPhone',
  'affiliationLabel',
  'birthDate',
  'city',
  'preferenceNote',
  'ownerPartnerCompanyId',
  'partnerCompanyId',
  'engineerId',
  'skillId',
  'sortKey',
  'yearsOfExperience',
  'updatedAt',
  'availableFrom',
  'unitPrice',
  'unitPriceMin',
  'unitPriceMax',
  'careers',
  'careerCount',
  'hasCareers',
  'skillSheet',
  'skillSheetId',
  'score',
  'rank',
  'index',
  'id',
] as const;

/**
 * ホストが読む提案依頼 1 件に現れてよいキー（docs/05 §6.5 #32 `HostProposalRequestView` + `project.{id,name}`）。
 * 🔴 `declineReason` / `engineerId` / `partnerCompanyId` / `respondedBy` / `issuedBy` は**型として存在しない**
 *    （`F-018 AC-1`）。ここに無いキーが 1 つでも現れたら落とす。
 */
const HOST_REQUEST_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'id',
  'project',
  'state',
  'message',
  'expiresAt',
  'createdAt',
  'respondedAt',
  'name',
]);

// ---------------------------------------------------------------------------
// 深さ走査（`tests/isolation/anonymous-candidate-view.test.ts` の `collect` と同じ手口）
// ---------------------------------------------------------------------------

const MAX_DEPTH = 8;

type Collected = { readonly keys: string[]; readonly values: string[] };

/** JSON を深さ `MAX_DEPTH` まで辿り、**すべてのキー名とスカラー値**を集める。 */
function collect(value: unknown, depth = 0, acc: Collected = { keys: [], values: [] }): Collected {
  if (depth > MAX_DEPTH) return acc;
  if (value === null || value === undefined) return acc;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    acc.values.push(String(value));
    return acc;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, depth + 1, acc);
    return acc;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      acc.keys.push(key);
      collect(entry, depth + 1, acc);
    }
  }
  return acc;
}

type Marker = { readonly label: string; readonly value: string };

/**
 * 🔴 応答に 1 文字も現れてはならない値（`F-017 AC-1` / `AC-2` / `BR-06` / `BR-55`）。
 *    実名・連絡先・営業メモ・社内 ID・共有元（会社 ID / 社名 / 担当者 ID）・スキルシートの ID /
 *    オブジェクトキー / ファイル名・丸める前の稼働開始日。
 * ⚠️ 丸める前の単価（`650000`）は**数値**であり、HTML ではチャンク名等の数字列と偶然一致しうるため、
 *    JSON にだけ当てる（`forbiddenJsonMarkers`。`support/population.ts` の `hostOnlyProjectApiMarkers` と同じ判断）。
 * ⚠️ 辞書 ID（`skills.id`）は**匿名候補の要素にだけ**当てる（`dictionaryIdMarkers`）。
 */
function forbiddenMarkers(engineers: readonly SyntheticEngineer[]): readonly Marker[] {
  const markers: Marker[] = [
    { label: 'partner_companies.id（共有元）', value: A1.partnerCompanyId },
    { label: 'partner_companies.name（共有元の社名）', value: A1_COMPANY_NAME ?? '' },
    { label: 'users.id（共有元の担当者）', value: A1.userId },
    { label: 'engineer_shares.id（seed の共有行）', value: A1.engineerShareId },
  ];
  for (const engineer of engineers) {
    const tag = `[${engineer.label}]`;
    markers.push(
      { label: `${tag} engineers.display_name（実名）`, value: engineer.displayName },
      { label: `${tag} engineers.contact_email`, value: engineer.contactEmail },
      { label: `${tag} engineers.contact_phone`, value: engineer.contactPhone },
      { label: `${tag} engineers.preference_note（営業メモ）`, value: engineer.preferenceNote },
      { label: `${tag} engineers.id（社内 ID）`, value: engineer.id },
      { label: `${tag} engineers.available_from（具体的な稼働開始日）`, value: engineer.availableFrom },
      // 🔴 T-09-12: 経歴の 3 項目（`F-008 AC-7`。期間は他の候補と偶然一致しうるため目印で見る）。
      ...engineer.careerMarkers.map((value, index) => ({
        label: `${tag} engineer_careers（経歴の${['役割', '業務内容', '使用技術'][index] ?? '項目'}）`,
        value,
      })),
    );
    if (engineer.skillSheet !== null) {
      markers.push(
        { label: `${tag} skill_sheets.id`, value: engineer.skillSheet.id },
        { label: `${tag} skill_sheets.object_key`, value: engineer.skillSheet.objectKey },
        { label: `${tag} skill_sheets.file_name`, value: engineer.skillSheet.fileName },
      );
    }
  }
  return markers.filter((marker) => marker.value !== '');
}

/**
 * 🔴 辞書 ID（`skills.id`。案件をまたいだ突合の材料。`F-017 AC-2`）。**匿名候補の要素（JSON の要素 / 行 / 右パネル）
 *    にだけ**当てる —— スキル辞書は**グローバルなマスタ**であり、`S-016` / `S-005` の検索フォームは辞書全体を
 *    `<select name="skills">` の選択肢（`value` = 辞書 ID）として描き、自社候補（`OwnEngineerView.primarySkills[].skillId`）
 *    も同じ ID を持つ。応答全体に当てると「X の値が漏れた」のではなく「辞書が在る」ことで落ちる（偽陽性）。
 *    匿名候補の内側で辞書 ID が出てはならないことは、キー集合（`skills[]` は `name` だけ）と値の両面で見る。
 */
function dictionaryIdMarkers(engineers: readonly SyntheticEngineer[]): readonly Marker[] {
  return engineers.flatMap((engineer) =>
    engineer.skillIds.map((skillId) => ({ label: `[${engineer.label}] skills.id（辞書 ID）`, value: skillId })),
  );
}

function forbiddenJsonMarkers(engineers: readonly SyntheticEngineer[]): readonly Marker[] {
  return [
    ...forbiddenMarkers(engineers),
    ...engineers.map((engineer) => ({
      label: `[${engineer.label}] engineers.unit_price（丸める前の単価）`,
      value: String(engineer.unitPrice),
    })),
  ];
}

/**
 * 監査ログ（`S-041` / #10）にだけ当てる集合。監査ログは**対象の ID**（`targetId` / `summary.engineerId`）と
 * 実施者の ID を持つのが正しく（`BR-27` / `F-016 AC-4`「実施者・対象・日時」）、ID は禁止値から外す。
 * 残すのは**内容**（実名・連絡先・営業メモ・ファイル名 / オブジェクトキー・丸める前の単価 / 稼働開始日）だけ
 * —— `AuditSummary` の規約「氏名・スキル・単価を載せない」（docs/05 §16.2）そのもの。
 */
function contentMarkers(engineers: readonly SyntheticEngineer[]): readonly Marker[] {
  // ラベルが `xxx.id` / `xxx.id（...）` のもの（対象・実施者・共有元・版の ID）を外す。
  return forbiddenJsonMarkers(engineers).filter((marker) => !/\.id(（|$)/.test(marker.label));
}

/** 走査した禁止値の種類（ラベルの集合。報告用）。 */
const scannedMarkerLabels = new Set<string>();

/**
 * 🔴 応答の**本文全体**（文字列）に禁止値が 0 件、かつ匿名候補の各要素が「5 項目 + 参照子 + 更新日」の
 *    形だけであること（キー集合 ⊆ 許可集合、禁止キー 0 件、区分値が定義された 5 段階 / 3 値）。
 */
function expectAnonymousItemsShaped(source: string, items: readonly unknown[]): readonly string[] {
  const anonymous = items.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && 'candidateRef' in item,
  );
  const refs: string[] = [];
  // 🔴 匿名候補の要素だけを文字列化して、禁止値（辞書 ID を含む）が 0 件であることを見る。
  const known = engineers();
  expectNoForbidden(`${source}（匿名候補の要素）`, JSON.stringify(anonymous), [
    ...forbiddenJsonMarkers(known),
    ...dictionaryIdMarkers(known),
  ]);
  for (const item of anonymous) {
    const collected = collect(item);
    const unexpectedKeys = [...new Set(collected.keys)].filter((key) => !ANONYMOUS_ALLOWED_KEYS.has(key));
    expect(unexpectedKeys, `${source}: 匿名候補に開示 5 項目以外のキーが現れました`).toEqual([]);
    const forbiddenKeys = [...new Set(collected.keys)].filter((key) =>
      (ANONYMOUS_FORBIDDEN_KEYS as readonly string[]).includes(key),
    );
    expect(forbiddenKeys, `${source}: 匿名候補に禁止されたキーが現れました`).toEqual([]);
    // トップレベルの 8 キーは**すべて**存在する（欠けているのは「型が変わった」兆候）。
    expect(Object.keys(item).sort()).toEqual([...ANONYMOUS_TOP_LEVEL_KEYS].sort());

    expect(typeof item.candidateRef).toBe('string');
    refs.push(item.candidateRef as string);
    expect(item.updatedOn, `${source}: updatedOn は JST 暦日（YYYY-MM-DD）だけ`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (item.yearsBand !== null) expect(YEARS_BANDS as readonly unknown[]).toContain(item.yearsBand);
    if (item.availabilityBand !== null) expect(AVAILABILITY_BANDS as readonly unknown[]).toContain(item.availabilityBand);
    if (item.remoteMode !== null) expect(REMOTE_MODES as readonly unknown[]).toContain(item.remoteMode);
    if (item.prefecture !== null) expect(item.prefecture, '都道府県コードだけ（市区町村を含まない）').toMatch(/^\d{2}$/);
    if (item.priceBand !== null) {
      const band = item.priceBand as Record<string, unknown>;
      expect(['RANGE', 'OPEN']).toContain(band.kind);
      // 🔴 10 万円刻み（万円単位で 10 の倍数）。丸める前の値（65）は現れない。
      expect((band.fromManYen as number) % 10, '単価レンジは 10 万円刻み').toBe(0);
      if (band.kind === 'RANGE') expect((band.toManYen as number) % 10).toBe(0);
    }
    for (const skill of item.skills as readonly Record<string, unknown>[]) {
      expect(Object.keys(skill), 'skills[] は辞書名だけ（skillId / sortKey を持たない）').toEqual(['name']);
    }
    expect((item.skills as readonly unknown[]).length, 'スキルは上位 8 件まで').toBeLessThanOrEqual(8);
  }
  return refs;
}

/** 本文に禁止値が 0 件（`expectNoMarkers` に種類のラベルを添えて、落ちたときに何が漏れたか分かるようにする）。 */
function expectNoForbidden(source: string, haystack: string, markers: readonly Marker[]): void {
  for (const marker of markers) scannedMarkerLabels.add(marker.label.replace(/^\[[XYZ]\] /, ''));
  const sightings = markers.filter((marker) => haystack.includes(marker.value)).map((marker) => marker.label);
  expect(sightings, `${source} に開示してはならない値が現れました`).toEqual([]);
}

// ---------------------------------------------------------------------------
// 前提づくり（API 経由。seed を増やさない）
// ---------------------------------------------------------------------------

function dayAfter(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** `GET /api/skills` から辞書 ID を 2 つ選ぶ（合成データに辞書外の語を作らない。`F-010 AC-2`）。 */
async function pickSkillIds(session: Session): Promise<readonly [string, string]> {
  const body = parseJson(await apiRequest(session.page, '/api/skills')) as {
    readonly items: readonly { readonly id: string; readonly name: string }[];
  };
  const [first, second] = body.items;
  if (first === undefined || second === undefined) {
    throw new Error('seed:isolation のスキル辞書に 2 件以上のスキルがありません。');
  }
  return [first.id, second.id];
}

/**
 * `S-007` 相当（`POST /api/engineers`。#16）で A1 所属のエンジニアを登録する。
 * 🔴 応答に出てはならない値（実名・連絡先・営業メモ・丸める前の単価 / 稼働開始日）を**全部入れる**。
 *    「出ないこと」を示すには、まず DB に在ることが要る（対照は①の `GET /api/engineer-shares` が担う）。
 */
async function registerEngineer(
  partner: Session,
  label: SyntheticEngineer['label'],
  skillIds: readonly [string, string],
  options: { readonly unitPrice: number; readonly availableInDays: number },
): Promise<SyntheticEngineer> {
  const suffix = `${label}-${RUN}`;
  const input = {
    // 🔴 接頭辞は後始末のシーム（`deleteT0809SyntheticEngineers`）が「消してよい行」の条件に使う。
    displayName: `${T0809_SYNTHETIC_ENGINEER_PREFIX}${suffix}`,
    availability: 'STANDBY_SCHEDULED',
    availableFrom: dayAfter(options.availableInDays),
    unitPriceMin: options.unitPrice,
    unitPriceMax: options.unitPrice,
    prefecture: '13',
    remoteMode: 'PARTIAL_REMOTE',
    preferenceNote: `T0809営業メモ-${suffix}-週3リモート希望`,
    contactEmail: `t0809-${suffix.toLowerCase()}@example.test`,
    contactPhone: `090-0809-${RUN.replace(/[^0-9]/g, '').padEnd(4, '7').slice(0, 4)}`,
    skills: [
      { skillId: skillIds[0], yearsOfExperience: 7, level: 4 },
      { skillId: skillIds[1], yearsOfExperience: 3, level: null },
    ],
    // 🔴 T-09-12: 経歴 4 行（1 行は継続中）。役割・業務内容・使用技術のすべてに目印を埋める。
    careers: [
      { periodFrom: '2025-01', periodTo: null, role: `T0912役割-${suffix}-PL`, description: `T0912業務内容-${suffix}-架空の基幹刷新`, technologies: `T0912技術-${suffix}-Go` },
      { periodFrom: '2023-04', periodTo: '2024-12', role: `T0912役割-${suffix}-SE`, description: `T0912業務内容-${suffix}-架空の受発注`, technologies: `T0912技術-${suffix}-TypeScript` },
      { periodFrom: '2021-01', periodTo: '2023-03', role: `T0912役割-${suffix}-PG`, description: `T0912業務内容-${suffix}-架空の会計`, technologies: `T0912技術-${suffix}-Java` },
      { periodFrom: '2019-04', periodTo: '2020-12', role: `T0912役割-${suffix}-テスター`, description: `T0912業務内容-${suffix}-架空の物流`, technologies: `T0912技術-${suffix}-JUnit` },
    ],
  };
  const created = await apiRequest(partner.page, '/api/engineers', { method: 'POST', body: input });
  expect(created.status, `POST /api/engineers（${label}）が失敗しました: ${created.text}`).toBe(201);
  const { id, careers } = parseJson(created) as {
    readonly id: string;
    readonly careers: readonly { readonly periodFrom: string }[];
  };
  // 🔴 #16 の応答は保存後の確定した並び（期間の降順）で 4 行返る（`F-008 AC-5`。サーバ側で確定）。
  expect(careers.map((row) => row.periodFrom)).toEqual(['2025-01', '2023-04', '2021-01', '2019-04']);
  return {
    label,
    id,
    displayName: input.displayName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    preferenceNote: input.preferenceNote,
    unitPrice: options.unitPrice,
    availableFrom: input.availableFrom,
    skillIds,
    skillSheet: null,
    careerMarkers: [`T0912役割-${suffix}`, `T0912業務内容-${suffix}`, `T0912技術-${suffix}`],
  };
}

/**
 * #18 → MinIO へ PUT → #19 → `CLEAN`（K-7 のシーム）→ #22（最新版にする）。
 * 🔴 `audit-k7.spec.ts` の `provisionCleanSkillSheet` と同じ経路・同じ判断（PUT は Node 側から、
 *    `content-length` は外す）。あちらは `is_latest` を要らないが、本ファイルは応諾時の凍結
 *    （`createProposalDraft` は `is_latest = true AND scan_status = 'CLEAN'` の版を写す）を見るため最新版にする。
 */
async function provisionLatestCleanSkillSheet(
  partner: Session,
  engineer: SyntheticEngineer,
): Promise<SyntheticEngineer> {
  const fileName = `T0809-skillsheet-${engineer.label}-${RUN}.pdf`;
  const fileBytes = Buffer.from(`T-08-09 fixture (${engineer.displayName})\n`.repeat(64), 'utf8');
  const ticketResponse = await apiRequest(partner.page, `/api/engineers/${engineer.id}/skill-sheets/upload-url`, {
    method: 'POST',
    body: { fileName, contentType: 'application/pdf', byteSize: fileBytes.byteLength },
  });
  expect(ticketResponse.status, `upload-url（#18）の発行に失敗しました: ${ticketResponse.text}`).toBe(201);
  const ticket = parseJson(ticketResponse) as {
    readonly objectKey: string;
    readonly uploadUrl: string;
    readonly requiredHeaders: Readonly<Record<string, string>>;
  };
  const putHeaders = Object.fromEntries(
    Object.entries(ticket.requiredHeaders).filter(([key]) => key.toLowerCase() !== 'content-length'),
  );
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: putHeaders, body: fileBytes });
  expect(put.status, `MinIO への PUT に失敗しました（status=${put.status}）`).toBeLessThan(300);

  const confirmResponse = await apiRequest(partner.page, `/api/engineers/${engineer.id}/skill-sheets`, {
    method: 'POST',
    body: { objectKey: ticket.objectKey, note: null },
  });
  expect(confirmResponse.status, `確定（#19）に失敗しました: ${confirmResponse.text}`).toBe(201);
  const confirmed = parseJson(confirmResponse) as { readonly id: string; readonly scanStatus: string };
  expect(confirmed.scanStatus).toBe('SCANNING');

  markSkillSheetClean(confirmed.id);
  const latest = await apiRequest(partner.page, `/api/skill-sheets/${confirmed.id}/latest`, { method: 'POST' });
  expect(latest.status, `最新版の指定（#22）に失敗しました: ${latest.text}`).toBe(204);

  return { ...engineer, skillSheet: { id: confirmed.id, objectKey: ticket.objectKey, fileName } };
}

type CandidateListBody = {
  readonly project: Record<string, unknown>;
  readonly items: readonly Record<string, unknown>[];
  readonly total: number;
  readonly nextCursor: string | null;
  readonly phase: string;
};

/** #30 `GET /api/projects/{id}/candidates`（全件。共有候補は `limit` に関係なく全件読んでから並べる）。 */
async function readCandidates(
  host: Session,
  projectId: string,
): Promise<{ readonly response: ApiResponse; readonly body: CandidateListBody; readonly refs: readonly string[] }> {
  const response = await apiRequest(host.page, `/api/projects/${projectId}/candidates?limit=100`);
  expect(response.status, `GET /api/projects/${projectId}/candidates が 200 を返すこと`).toBe(200);
  const body = parseJson(response) as CandidateListBody;
  const refs = body.items.flatMap((item) => (typeof item.candidateRef === 'string' ? [item.candidateRef] : []));
  return { response, body, refs };
}

/**
 * 🔴 共有元の操作の**差分**で参照子を知る（冒頭コメント）。差分がちょうど 1 件であることも表明する
 *    （0 件 = 現れていない、2 件以上 = 他の候補が同時に動いた ＝ どちらも前提が崩れている）。
 */
function exactlyOneNewRef(source: string, before: readonly string[], after: readonly string[]): string {
  const added = after.filter((ref) => !before.includes(ref));
  const removed = before.filter((ref) => !after.includes(ref));
  expect(removed, `${source}: 共有の開始で消えた参照子があります`).toEqual([]);
  expect(added, `${source}: 共有の開始で増えた参照子がちょうど 1 件であること`).toHaveLength(1);
  return added[0] as string;
}

/** `S-015` で共有を開始する（プレビュー → 確認 → 確定 → 再読込）。 */
async function shareViaScreen(partner: Session, engineerId: string): Promise<void> {
  await partner.page.goto('/engineer-shares', { waitUntil: 'domcontentloaded' });
  await expect(partner.page.getByTestId('engineer-share-screen')).toBeVisible();
  await partner.page.getByTestId(`engineer-share-share-${engineerId}`).click();
  await expect(partner.page.getByTestId('engineer-share-share-confirm')).toBeVisible();
  // 🔴 確認ステップは**プレビュー（丸めた後の 5 項目）を見せたうえで**確定させる（`docs/04` §S-015）。
  await expect(partner.page.getByTestId(`engineer-share-preview-${engineerId}`)).toBeVisible();
  await partner.page.getByTestId('engineer-share-confirm-submit').click();
  // 変更後は再読込され、サーバの状態だけが正（`engineer-share-screen.tsx`）。共有中の表に移る。
  await expect(partner.page.getByTestId(`engineer-share-revoke-${engineerId}`)).toBeVisible();
  await expect(partner.page.getByTestId(`engineer-share-share-${engineerId}`)).toHaveCount(0);
}

/** `S-015` で共有を停止する。 */
async function revokeViaScreen(partner: Session, engineerId: string): Promise<void> {
  await partner.page.goto('/engineer-shares', { waitUntil: 'domcontentloaded' });
  await expect(partner.page.getByTestId('engineer-share-screen')).toBeVisible();
  await partner.page.getByTestId(`engineer-share-revoke-${engineerId}`).click();
  await expect(partner.page.getByTestId('engineer-share-revoke-confirm')).toBeVisible();
  await partner.page.getByTestId('engineer-share-confirm-submit').click();
  await expect(partner.page.getByTestId(`engineer-share-share-${engineerId}`)).toBeVisible();
  await expect(partner.page.getByTestId(`engineer-share-revoke-${engineerId}`)).toHaveCount(0);
}

/** 共有を開始し、ホストの #30（公開案件 / 未公開案件）の差分で参照子を知る。 */
async function shareAndIdentify(
  partner: Session,
  host: Session,
  engineer: SyntheticEngineer,
): Promise<{ readonly published: string; readonly private: string }> {
  const beforePublished = (await readCandidates(host, PUBLISHED_PROJECT_ID)).refs;
  const beforePrivate = (await readCandidates(host, PRIVATE_PROJECT_ID)).refs;
  await shareViaScreen(partner, engineer.id);
  const afterPublished = (await readCandidates(host, PUBLISHED_PROJECT_ID)).refs;
  const afterPrivate = (await readCandidates(host, PRIVATE_PROJECT_ID)).refs;
  return {
    published: exactlyOneNewRef(`${engineer.label} / 公開案件`, beforePublished, afterPublished),
    private: exactlyOneNewRef(`${engineer.label} / 未公開案件`, beforePrivate, afterPrivate),
  };
}

/** #32 の契約は `{ items, nextCursor }`（`audience` は載せない。呼び出し側は自分の所属を知っている）。 */
type PartnerRequestList = {
  readonly items: readonly {
    readonly id: string;
    readonly state: string;
    readonly engineer: { readonly id: string; readonly displayName: string } | null;
  }[];
};

type HostRequestList = {
  readonly items: readonly Record<string, unknown>[];
  readonly nextCursor: string | null;
};

/** 取引先の #32 から「対象エンジニア → 依頼 ID」を引く（対応を知っているのは共有元だけである）。 */
async function partnerRequestIdFor(partner: Session, engineerId: string): Promise<string> {
  const body = parseJson(await apiRequest(partner.page, '/api/proposal-requests?limit=100')) as PartnerRequestList;
  const item = body.items.find((row) => row.engineer?.id === engineerId);
  if (item === undefined) throw new Error(`A1 の一覧に engineer=${engineerId} 宛の依頼がありません。`);
  return item.id;
}

async function hostRequests(host: Session, query = ''): Promise<{ readonly response: ApiResponse; readonly body: HostRequestList }> {
  const response = await apiRequest(host.page, `/api/proposal-requests?limit=100${query}`);
  expect(response.status, `GET /api/proposal-requests${query} が 200 を返すこと`).toBe(200);
  const body = parseJson(response) as HostRequestList;
  // 🔴 契約は `{ items, nextCursor }` の 2 キーだけ（残件数・総件数を返さない。docs/05 §4.8）。
  expect(Object.keys(body).sort()).toEqual(['items', 'nextCursor']);
  return { response, body };
}

function hostRequestState(body: HostRequestList, requestId: string): unknown {
  const item = body.items.find((row) => row.id === requestId);
  if (item === undefined) throw new Error(`ホストの一覧に依頼 ${requestId} がありません。`);
  return item.state;
}

/** 🔴 ホストの依頼一覧の各要素が `HostProposalRequestView` の形だけであること（辞退理由・依頼先・担当者の欄が無い）。 */
function expectHostRequestItemsShaped(source: string, body: HostRequestList): void {
  for (const item of body.items) {
    const keys = [...new Set(collect(item).keys)];
    const unexpected = keys.filter((key) => !HOST_REQUEST_ALLOWED_KEYS.has(key));
    expect(unexpected, `${source}: ホスト向けの依頼にホスト向けの型に無いキーが現れました`).toEqual([]);
    for (const forbidden of ['declineReason', 'engineerId', 'partnerCompanyId', 'respondedBy', 'issuedBy', 'engineer', 'candidateRef']) {
      expect(keys, `${source}: ${forbidden} が現れました`).not.toContain(forbidden);
    }
  }
}

async function pageHtml(session: Session, path: string): Promise<string> {
  const response = await session.page.goto(path, { waitUntil: 'domcontentloaded' });
  // 🔴 500 系は「越境していない」ではなく「壊れている」。空振りで green にしない。
  expect(response?.status() ?? 0, `${path} が 5xx を返しました`).toBeLessThan(500);
  return session.page.content();
}

/** `fetch` の応答ヘッダも取る（⑧で `cache-control: no-store` を見るため。`support/api.ts` は本文だけ返す）。 */
async function apiRequestWithHeaders(
  session: Session,
  path: string,
): Promise<{ readonly status: number; readonly text: string; readonly cacheControl: string | null }> {
  return session.page.evaluate(async (target) => {
    const response = await fetch(target);
    return {
      status: response.status,
      text: await response.text(),
      cacheControl: response.headers.get('cache-control'),
    };
  }, path);
}

function engineers(): readonly SyntheticEngineer[] {
  return [state.x, state.y, state.z].filter((engineer): engineer is SyntheticEngineer => engineer !== null);
}

function requireEngineer(label: SyntheticEngineer['label']): SyntheticEngineer {
  const engineer = label === 'X' ? state.x : label === 'Y' ? state.y : state.z;
  if (engineer === null) throw new Error(`前のシナリオが ${label} を作っていません（serial の前提が崩れている）。`);
  return engineer;
}

function requireRef(project: 'published' | 'private', label: SyntheticEngineer['label']): string {
  const ref = state.refs[project][label];
  if (ref === undefined) throw new Error(`前のシナリオが ${label} の参照子（${project}）を得ていません。`);
  return ref;
}

function requireRequest(key: 'x' | 'y' | 'z'): string {
  const id = state.requests[key];
  if (id === null) throw new Error(`前のシナリオが依頼 ${key} を発行していません。`);
  return id;
}

// ---------------------------------------------------------------------------
// シナリオ
// ---------------------------------------------------------------------------

test.describe('🔴 経路 4（匿名共有と提案依頼）— CLAUDE.md §5 Phase 1 成功条件 3', () => {
  test('① A1 がエンジニア X を登録 → 共有オフを確認 → S-015 で共有可にする（F-016 AC-1）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const partner = await openTenantSession(browser, partnerSales(1, 1));
    const host = await openTenantSession(browser, hostOwner(1));
    const otherPartner = await openTenantSession(browser, partnerSales(1, 2));
    try {
      // 🔴 実行環境は development（全コネクタがモック。`CLAUDE.md` §11）。
      const me = parseJson(await apiRequest(partner.page, '/api/me')) as { env: string; partnerCompanyId: string | null };
      expect(me.env).toBe('development');
      expect(me.partnerCompanyId).toBe(A1.partnerCompanyId);

      // ⑦の前提: A1 が何かする**前**の A2 の応答を取っておく（バイト列で比較する）。
      //    ⚠️ `/api/home` は `changedSince`（応答時刻）を持ち、同一性の比較には使えない（⑦では禁止値の走査だけ）。
      state.a2Baseline = {
        requests: (await apiRequest(otherPartner.page, '/api/proposal-requests?limit=100')).text,
        shares: (await apiRequest(otherPartner.page, '/api/engineer-shares')).text,
      };

      // ホストの #30 の母集団（登録前）。
      const beforeRegister = (await readCandidates(host, PUBLISHED_PROJECT_ID)).refs;
      expect(beforeRegister.length, 'seed:isolation の共有候補（2 パートナー分）が出ていること（対照）').toBeGreaterThanOrEqual(2);

      // X を登録（PII・営業メモ・丸める前の単価 / 稼働開始日を全部入れる）+ スキルシート（最新 CLEAN 版）。
      const skillIds = await pickSkillIds(partner);
      let x = await registerEngineer(partner, 'X', skillIds, { unitPrice: 650_000, availableInDays: 47 });
      x = await provisionLatestCleanSkillSheet(partner, x);
      state.x = x;

      // 🔴 新規登録直後は必ずオフ（`F-016 AC-1` / `BR-53`）。API と画面の両方で見る。
      const shares = parseJson(await apiRequest(partner.page, '/api/engineer-shares')) as {
        items: readonly { engineerId: string; shared: boolean; sharedOn: string | null; displayName: string }[];
      };
      const xShare = shares.items.find((item) => item.engineerId === x.id);
      expect(xShare, '自社の共有設定の一覧に X が出ること（対照。実名は自社の台帳なので出てよい）').toBeDefined();
      expect(xShare?.shared).toBe(false);
      expect(xShare?.sharedOn).toBeNull();
      expect(xShare?.displayName).toBe(x.displayName);

      await partner.page.goto('/engineer-shares', { waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('engineer-share-screen')).toBeVisible();
      await expect(partner.page.getByTestId('engineer-share-not-shared-table')).toBeVisible();
      await expect(partner.page.getByTestId(`engineer-share-share-${x.id}`)).toBeVisible();
      await expect(partner.page.getByTestId(`engineer-share-revoke-${x.id}`)).toHaveCount(0);
      // 🔴 一括で全件をオンにする操作が存在しない（`F-016 AC-1`）: 共有ボタンは行ごとにしか無い。
      await expect(partner.page.locator('[data-testid^="engineer-share-share-"]')).toHaveCount(
        shares.items.filter((item) => !item.shared).length,
      );
      await expectNoBrokenLabels('S-015 匿名共有の設定（共有前）', partner.page);
      expectNoHiddenCountHints('S-015 匿名共有の設定（共有前）', await partner.page.content());

      // 🔴 登録しただけではホストの候補に現れない（既定オフ）。
      const afterRegister = (await readCandidates(host, PUBLISHED_PROJECT_ID)).refs;
      expect([...afterRegister].sort()).toEqual([...beforeRegister].sort());

      // 共有可にする（S-015）→ ホストの #30 に**ちょうど 1 件**増える（＝ X）。公開 / 未公開の両案件で参照子を得る。
      const refs = await shareAndIdentify(partner, host, x);
      state.refs.published.X = refs.published;
      state.refs.private.X = refs.private;

      const sharesAfter = parseJson(await apiRequest(partner.page, '/api/engineer-shares')) as typeof shares;
      const xAfter = sharesAfter.items.find((item) => item.engineerId === x.id);
      expect(xAfter?.shared).toBe(true);
      expect(xAfter?.sharedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      partner.outbound.assertNone();
      host.outbound.assertNone();
      otherPartner.outbound.assertNone();
    } finally {
      await otherPartner.close();
      await host.close();
      await partner.close();
    }
  });

  test('② ホストの S-016 / #30 / #15?projectId= に X が匿名 5 項目でのみ現れる（F-017 AC-1 / AC-3。深さ走査で禁止値 0 件）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const x = requireEngineer('X');
    const xRef = requireRef('published', 'X');
    const host = await openTenantSession(browser, hostOwner(1));
    const jsonMarkers = forbiddenJsonMarkers([x]);
    const htmlMarkers = forbiddenMarkers([x]);
    try {
      // --- API #30 -----------------------------------------------------------
      const candidates = await readCandidates(host, PUBLISHED_PROJECT_ID);
      expect(candidates.refs, 'X の参照子が #30 に出ていること（対照）').toContain(xRef);
      expectNoForbidden('GET /api/projects/{id}/candidates（#30）', candidates.response.text, jsonMarkers);
      expectNoHiddenCountHints('#30', candidates.response.text);
      const shapedRefs = expectAnonymousItemsShaped('#30', candidates.body.items);
      expect(shapedRefs).toContain(xRef);
      // Phase 1: スコア・順位・重みの表示が無い（`F-017 AC-7`）。
      expect(candidates.body.phase).toBe('P1');

      // 🔴 対照: 出してよい値は確かに出ている（走査が「空の応答」を見ていない）。X は 7 年 / 65 万円 / 東京都 /
      //    一部リモート可で登録したので、区分は Y5_10 / 60〜70 万円 / 13 / PARTIAL_REMOTE になる（`F-017 AC-3`）。
      const xItem = candidates.body.items.find((item) => item.candidateRef === xRef) as Record<string, unknown>;
      expect(xItem.yearsBand).toBe('Y5_10');
      expect(xItem.priceBand).toEqual({ kind: 'RANGE', fromManYen: 60, toManYen: 70 });
      expect(xItem.prefecture).toBe('13');
      expect(xItem.remoteMode).toBe('PARTIAL_REMOTE');
      expect((xItem.skills as readonly { name: string }[]).length).toBe(2);

      // --- API #15?projectId= ---------------------------------------------------
      const mixed = await apiRequest(host.page, `/api/engineers?projectId=${PUBLISHED_PROJECT_ID}&limit=100`);
      expect(mixed.status).toBe(200);
      expectNoForbidden('GET /api/engineers?projectId=（#15）', mixed.text, jsonMarkers);
      expectNoHiddenCountHints('#15?projectId=', mixed.text);
      const mixedBody = parseJson(mixed) as { items: readonly Record<string, unknown>[] };
      expect(expectAnonymousItemsShaped('#15?projectId=', mixedBody.items)).toContain(xRef);

      // 🔴 `#15` に `projectId` を渡さなければ匿名候補は 1 件も混ざらない（Issue #50 = A。`S-005` は自社台帳だけ）。
      const ledger = parseJson(await apiRequest(host.page, '/api/engineers?limit=100')) as { items: readonly Record<string, unknown>[] };
      expect(ledger.items.filter((item) => 'candidateRef' in item)).toEqual([]);

      // --- 画面 `S-016` -----------------------------------------------------------
      //    ⚠️ 素の URL は案件の要件を検索条件の初期値にする。条件を 1 つ置いて全件表示にする（`projects.mobile.spec.ts` と同じ）。
      const html = await pageHtml(host, `/projects/${PUBLISHED_PROJECT_ID}/candidates?limit=100`);
      await expect(host.page.getByTestId('candidate-screen')).toBeVisible();
      const xRow = host.page.getByTestId(`candidate-list-row-${xRef}`);
      await expect(xRow).toBeVisible();
      await expect(xRow).toHaveAttribute('data-candidate-kind', 'ANONYMOUS');
      // 🔴 表示名は「共有候補」の一語だけ（氏名・所属会社名・社内 ID を持たない）。
      await expect(host.page.getByTestId(`candidate-list-name-${xRef}`)).toHaveText(t('candidates.kind.anonymous'));
      expectNoForbidden('S-016 候補検索（HTML）', html, htmlMarkers);
      expectNoHiddenCountHints('S-016 候補検索', html);
      await expectNoBrokenLabels('S-016 候補検索', host.page);

      // 行を選ぶ → 右パネルは 5 項目 + 依頼の導線だけ。
      await xRow.click();
      await expect(host.page.getByTestId('candidate-detail-anonymous')).toBeVisible();
      const panelHtml = await host.page.getByTestId('candidate-detail-panel').innerHTML();
      // 🔴 行と右パネルは X の情報だけが描かれる領域なので、辞書 ID も含めた厳しい集合を当てる。
      const strict = [...forbiddenMarkers([x]), ...dictionaryIdMarkers([x])];
      expectNoForbidden('S-016 右パネル（匿名候補）', panelHtml, strict);
      expectNoForbidden('S-016 匿名候補の行', await xRow.innerHTML(), strict);
      for (const field of ['skills', 'years', 'price', 'availability', 'location', 'updated-on']) {
        await expect(host.page.getByTestId('candidate-detail-anonymous').locator(`[data-field="${field}"]`)).toBeVisible();
      }
      await expectNoBrokenLabels('S-016 候補検索（右パネル）', host.page);

      // 🔴 T-11-12: 右パネルを開いた 1440（`xl`）で、最終列「更新日」が横スクロール無しに読める（`docs/04` §S-016
      //    「デスクトップの列幅配分」。`T-08-09` のスクリーンショットでは右パネルに押し出されて読めなかった列）。
      //    ①更新日セルが見えており右端がビューポートの内側 ②表の器（`overflow-x-auto`）が横にスクロールしていない
      //    （①だけでは器に隠れたセルも「ビューポート内」になりうる）③セルの中心に在る要素がセル自身（右パネルに
      //    覆われていない）④右パネルが同時に見えている。判定の閾値は `expectNoHorizontalOverflow` と同じ 1px。
      const originalViewport = host.page.viewportSize();
      await host.page.setViewportSize({ width: 1440, height: 900 });
      try {
        const updatedOn = host.page.getByTestId(`candidate-list-updated-on-${xRef}`);
        await expect(updatedOn).toBeVisible();
        await updatedOn.scrollIntoViewIfNeeded();
        const box = await updatedOn.boundingBox();
        expect(box, '更新日セルの矩形が取れない').not.toBeNull();
        expect(box?.x ?? -1, '更新日セルの左端').toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0), '更新日セルの右端がビューポートの外').toBeLessThanOrEqual(1440);
        const geometry = await updatedOn.evaluate((cell) => {
          const container = cell.closest('div');
          const rect = cell.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            containerOverflow: container === null ? null : container.scrollWidth - container.clientWidth,
            containerRight: container === null ? null : container.getBoundingClientRect().right,
            cellRight: rect.right,
            hitIsCell: hit !== null && (hit === cell || cell.contains(hit)),
          };
        });
        expect(geometry.containerOverflow, '候補テーブルの器が横にスクロールしている').toBeLessThanOrEqual(1);
        expect(geometry.cellRight, '更新日セルが器の外に押し出されている').toBeLessThanOrEqual((geometry.containerRight ?? 0) + 1);
        expect(geometry.hitIsCell, '更新日セルが右パネルに覆われている').toBe(true);
        await expect(host.page.getByTestId('candidate-detail-anonymous')).toBeVisible();
        await expectNoBrokenLabels('S-016 候補検索（1440・右パネルを開いた状態）', host.page);
      } finally {
        if (originalViewport !== null) await host.page.setViewportSize(originalViewport);
      }

      host.outbound.assertNone();
    } finally {
      await host.close();
    }
  });

  test('③ 🔴 Proposal 作成前に実名・所属会社名・スキルシートへ到達できる導線が 1 つも無い（F-017 AC-6。画面・API・URL 直打ち）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const x = requireEngineer('X');
    const xRef = requireRef('published', 'X');
    const sheet = x.skillSheet;
    if (sheet === null) throw new Error('①が X のスキルシートを用意していません。');
    const host = await openTenantSession(browser, hostOwner(1));
    const jsonMarkers = forbiddenJsonMarkers([x]);
    const htmlMarkers = forbiddenMarkers([x]);
    try {
      // --- 画面: 匿名候補の行と右パネルに詳細へのリンクが無い ------------------------------
      await pageHtml(host, `/projects/${PUBLISHED_PROJECT_ID}/candidates?limit=100`);
      const xRow = host.page.getByTestId(`candidate-list-row-${xRef}`);
      await expect(xRow).toBeVisible();
      await expect(xRow.locator('a'), '匿名候補の行にリンクが無い').toHaveCount(0);
      await xRow.click();
      const panel = host.page.getByTestId('candidate-detail-panel');
      await expect(panel.getByTestId('candidate-detail-anonymous')).toBeVisible();
      // 🔴 自社候補にはある「台帳を開く」（`/engineers/{id}`）が匿名候補には**要素ごと無い**。
      await expect(panel.getByTestId('candidate-detail-open-engineer')).toHaveCount(0);
      await expect(panel.locator('a[href^="/engineers/"]')).toHaveCount(0);
      await expect(panel.locator('a[href*="skill-sheet"]')).toHaveCount(0);
      // 依頼の導線だけがある（対照）。
      await expect(panel.getByTestId('candidate-request-open')).toBeVisible();

      // --- API 直叩き（ホスト文脈）: 台帳・スキルシートは「存在しない」 ------------------------
      const unknown = await apiRequest(host.page, `/api/engineers/${ABSENT_UUID}`);
      const engineerApi = await apiRequest(host.page, `/api/engineers/${x.id}`);
      expect(unknown.status).toBe(404);
      expect(engineerApi.status, 'GET /api/engineers/{X}（ホスト文脈）は 404').toBe(404);
      // 🔴 本文まで同一（403 と区別しないだけでなく、理由も区別しない。docs/05 §4.8）。
      expect(engineerApi.text).toBe(unknown.text);

      const downloadUrl = await apiRequest(host.page, `/api/skill-sheets/${sheet.id}/download-url`);
      expect(downloadUrl.status, 'GET /api/skill-sheets/{X の版}/download-url（ホスト文脈）は 404').toBe(404);
      const preview = await apiRequest(host.page, `/api/skill-sheets/${sheet.id}/preview`);
      expect(preview.status, 'GET /api/skill-sheets/{X の版}/preview（ホスト文脈）は 404').toBe(404);

      // 🔴 詳細エンドポイントは**存在しない**（docs/05 §6.8「`GET /api/candidates/{candidateRef}` を作らない」）。
      const candidateDetail = await apiRequest(host.page, `/api/candidates/${xRef}`);
      expect(candidateDetail.status).toBe(404);
      expectNoForbidden('GET /api/candidates/{ref}', candidateDetail.text, jsonMarkers);

      // 🔴 共有設定はホストから読めない・変えられない（主導権は取引先。`F-016` 関連ロール）。
      expect((await apiRequest(host.page, '/api/engineer-shares')).status).toBe(403);
      expect(
        (await apiRequest(host.page, `/api/engineers/${x.id}/share`, { method: 'PUT', body: { shared: false } })).status,
      ).toBe(403);

      // 🔴 自社台帳の検索（#15）に X の氏名を投げても 0 件（名前から台帳へ辿れない）。
      const searched = parseJson(
        await apiRequest(host.page, `/api/engineers?q=${encodeURIComponent(x.displayName)}&limit=100`),
      ) as { items: readonly unknown[]; total: number };
      expect(searched.items).toEqual([]);
      expect(searched.total).toBe(0);

      // 依頼一覧（#32）の応答に X の値は無い（この時点で依頼は 0 件だが、形の検査も併せて掛ける）。
      const requests = await hostRequests(host);
      expectNoForbidden('GET /api/proposal-requests（#32）', requests.response.text, jsonMarkers);
      expectHostRequestItemsShaped('#32', requests.body);

      for (const response of [engineerApi, downloadUrl, preview]) {
        expectNoForbidden('API 直叩き（404 本文）', response.text, jsonMarkers);
      }

      // --- URL 直打ち（ホスト文脈） ----------------------------------------------------------
      //    ⚠️ 直打ちした URL（= X の ID）そのものは Next.js が描画データとして HTML に埋め込む（入力の反射であり
      //    開示ではない）。ここでは ID 以外の全マーカー（実名・連絡先・営業メモ・共有元・スキルシート）を当て、
      //    「ID を知っていても、その先の情報に 1 文字も到達できない」ことを見る。
      const directHitMarkers = htmlMarkers.filter((marker) => !marker.label.includes('engineers.id'));
      const detailHtml = await pageHtml(host, `/engineers/${x.id}`);
      expect(detailHtml).toContain(t('engineers.notFound'));
      // 詳細画面の本体（氏名の見出し・所有区分）は**要素ごと無い**（not-found が描かれている）。
      await expect(host.page.getByTestId('engineer-not-found')).toBeVisible();
      await expect(host.page.getByTestId('engineer-detail-name')).toHaveCount(0);
      await expect(host.page.getByTestId('engineer-detail-headline')).toHaveCount(0);
      expectNoForbidden('URL 直打ち /engineers/{X}', detailHtml, directHitMarkers);

      const sheetsNav = await host.page.goto(`/engineers/${x.id}/skill-sheets`, { waitUntil: 'domcontentloaded' });
      expect(sheetsNav?.status(), 'URL 直打ち /engineers/{X}/skill-sheets は 404').toBe(404);
      expectNoForbidden('URL 直打ち /engineers/{X}/skill-sheets', await host.page.content(), directHitMarkers);

      const candidatePageNav = await host.page.goto(`/candidates/${xRef}`, { waitUntil: 'domcontentloaded' });
      expect(candidatePageNav?.status(), '匿名候補の詳細画面は存在しない（docs/04 §11-2）').toBe(404);
      expectNoForbidden('URL 直打ち /candidates/{ref}', await host.page.content(), htmlMarkers);

      // 🔴 監査ログ（`S-041` / #10）にも X の実名・連絡先・ファイル名は出ない（記録は件数・状態・ID の類だけ）。
      const audit = await apiRequest(host.page, `/api/audit-logs?${auditLogPeriodQuery()}&limit=200`);
      expect(audit.status).toBe(200);
      expectNoForbidden('GET /api/audit-logs（ホスト）', audit.text, contentMarkers([x]));

      host.outbound.assertNone();
    } finally {
      await host.close();
    }
  });

  test('④ 提案依頼（S-016 → #31）→ A1 が辞退（S-018 → #34）→ ホストに理由が現れず、DECLINED と EXPIRED が区別できる（F-018 AC-1 / AC-2 / AC-5）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const x = requireEngineer('X');
    const xRef = requireRef('published', 'X');
    const partner = await openTenantSession(browser, partnerSales(1, 1));
    const host = await openTenantSession(browser, hostOwner(1));
    try {
      // --- 前提: Y（応諾用。⑤）と Z（期限切れ用）を登録して共有する ------------------------------
      const skillIds = await pickSkillIds(partner);
      let y = await registerEngineer(partner, 'Y', skillIds, { unitPrice: 720_000, availableInDays: 52 });
      y = await provisionLatestCleanSkillSheet(partner, y);
      state.y = y;
      const yRefs = await shareAndIdentify(partner, host, y);
      state.refs.published.Y = yRefs.published;
      state.refs.private.Y = yRefs.private;

      const z = await registerEngineer(partner, 'Z', skillIds, { unitPrice: 580_000, availableInDays: 67 });
      state.z = z;
      const zRefs = await shareAndIdentify(partner, host, z);
      state.refs.published.Z = zRefs.published;
      state.refs.private.Z = zRefs.private;

      // --- ホストが X に提案依頼を送る（`S-016` の右パネル → #31） ---------------------------------
      await pageHtml(host, `/projects/${PUBLISHED_PROJECT_ID}/candidates?limit=100`);
      await host.page.getByTestId(`candidate-list-row-${xRef}`).click();
      await expect(host.page.getByTestId('candidate-detail-anonymous')).toBeVisible();
      await host.page.getByTestId('candidate-request-open').click();
      const form = host.page.getByTestId('candidate-request-form');
      await expect(form).toBeVisible();
      // 🔴 確定単価の入力欄が無い（`F-017 AC-4` / `BR-58`）。入力はメッセージと期限の 2 つだけ。
      await expect(form.locator('input[type="number"]')).toHaveCount(0);
      await expect(form.locator('textarea, input')).toHaveCount(2);
      await expectNoBrokenLabels('S-016 提案依頼フォーム', host.page);
      await host.page.getByTestId('candidate-request-message').fill(REQUEST_MESSAGE);
      await host.page.getByTestId('candidate-request-submit').click();
      await expect(host.page.getByTestId('candidate-request-sent')).toBeVisible();

      // Y / Z への依頼は API（#31）で出す（応答は `{ id }` だけ。`engineer_id` / 依頼先を載せない）。
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      for (const [key, ref] of [['y', yRefs.published], ['z', zRefs.published]] as const) {
        const issued = await apiRequest(host.page, '/api/proposal-requests', {
          method: 'POST',
          body: { projectId: PUBLISHED_PROJECT_ID, candidateRef: ref, message: REQUEST_MESSAGE, expiresAt },
        });
        expect(issued.status, `POST /api/proposal-requests（${key}）: ${issued.text}`).toBe(201);
        const body = parseJson(issued) as Record<string, unknown>;
        expect(Object.keys(body)).toEqual(['id']);
        state.requests[key] = body.id as string;
      }
      // X への依頼 ID は**共有元（A1）の一覧**から引く（ホストの一覧には対象エンジニアの情報が無い）。
      state.requests.x = await partnerRequestIdFor(partner, x.id);
      const xReq = requireRequest('x');
      const zReq = requireRequest('z');

      // 🔴 ホストの `S-017`: 候補列は「共有候補」の一語。依頼先の社名・氏名の欄が無い。
      const hostListHtml = await pageHtml(host, '/proposal-requests');
      await expect(host.page.getByTestId('proposal-request-screen')).toBeVisible();
      const xRow = host.page.getByTestId(`proposal-request-row-${xReq}`);
      await expect(xRow).toBeVisible();
      await expect(xRow).toHaveAttribute('data-request-state', 'REQUESTED');
      expectNoForbidden('S-017 提案依頼の一覧（ホスト・依頼直後）', hostListHtml, forbiddenMarkers(engineers()));
      expectNoHiddenCountHints('S-017 提案依頼の一覧（ホスト）', hostListHtml);
      await expectNoBrokenLabels('S-017 提案依頼の一覧（ホスト）', host.page);

      // --- A1 が X の依頼を辞退する（`S-017` → `S-018` → #34。理由を入力） ---------------------------
      await pageHtml(partner, '/proposal-requests');
      await expect(partner.page.getByTestId('proposal-request-screen')).toBeVisible();
      // 取引先の一覧には取り下げの導線が無い（ホスト専用）。
      await expect(partner.page.getByTestId('proposal-request-withdraw')).toHaveCount(0);
      await expectNoBrokenLabels('S-017 提案依頼の一覧（取引先）', partner.page);
      await partner.page.getByTestId(`proposal-request-row-${xReq}`).click();
      await expect(partner.page.getByTestId('proposal-request-detail')).toBeVisible();
      await partner.page.getByTestId('proposal-request-detail-respond').click();
      await expect(partner.page.getByTestId('proposal-request-respond-screen')).toBeVisible();
      await expect(partner.page.getByTestId('proposal-request-respond-screen')).toHaveAttribute('data-request-state', 'REQUESTED');
      // 判断材料（案件・要件・対象エンジニア・開示される項目）が見える（`CLAUDE.md` §13.3）。
      await expect(partner.page.getByTestId('proposal-request-respond-project-name')).toBeVisible();
      await expect(partner.page.getByTestId('proposal-request-respond-requirements-MUST')).toBeVisible();
      await expect(partner.page.getByTestId('proposal-request-respond-engineer-name')).toHaveText(x.displayName);
      await expect(partner.page.getByTestId('proposal-request-respond-disclosure-items').locator('li')).toHaveCount(3);
      await expectNoBrokenLabels('S-018 提案依頼の詳細（取引先）', partner.page);

      await partner.page.getByTestId('proposal-request-respond-decline').click();
      await expect(partner.page.getByTestId('proposal-request-respond-decline-form')).toBeVisible();
      await expectNoBrokenLabels('S-018 辞退フォーム', partner.page);
      await partner.page.getByTestId('proposal-request-respond-decline-reason').fill(state.declineReason);
      await partner.page.getByTestId('proposal-request-respond-decline-submit').click();
      await expect(partner.page.getByTestId('proposal-request-respond-declined')).toBeVisible();

      // 対照: 理由は**自社の記録**として取引先には再表示される（`F-018 AC-1`。ここに在るからこそ「ホストに無い」が意味を持つ）。
      await partner.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('proposal-request-respond-screen')).toHaveAttribute('data-request-state', 'DECLINED');
      await expect(partner.page.getByTestId('proposal-request-respond-recorded-reason-value')).toHaveText(state.declineReason);
      await expect(partner.page.getByTestId('proposal-request-respond-accept')).toHaveCount(0);
      await expect(partner.page.getByTestId('proposal-request-respond-decline')).toHaveCount(0);

      // --- Z の依頼を期限到来で `EXPIRED` にする（worker 不在。`harness/db-admin.ts` のシーム） ------------
      expireProposalRequestByDeadline(zReq);

      // --- ホスト側: 理由が現れず、DECLINED / EXPIRED / REQUESTED が別の状態として見える -------------------
      const all = await hostRequests(host);
      expect(hostRequestState(all.body, xReq)).toBe('DECLINED');
      expect(hostRequestState(all.body, zReq)).toBe('EXPIRED');
      expect(hostRequestState(all.body, requireRequest('y'))).toBe('REQUESTED');
      expect(all.response.text, '#32 に辞退理由が現れました').not.toContain(state.declineReason);
      expectHostRequestItemsShaped('#32（辞退後）', all.body);
      expectNoForbidden('#32（辞退後）', all.response.text, forbiddenJsonMarkers(engineers()));

      // 状態フィルタでも別区分（`F-018 AC-5`。「失効」にまとめない）。
      const declined = await hostRequests(host, '&state=DECLINED');
      const expired = await hostRequests(host, '&state=EXPIRED');
      expect(declined.body.items.map((item) => item.id)).toContain(xReq);
      expect(declined.body.items.map((item) => item.id)).not.toContain(zReq);
      expect(expired.body.items.map((item) => item.id)).toContain(zReq);
      expect(expired.body.items.map((item) => item.id)).not.toContain(xReq);
      expect(declined.response.text).not.toContain(state.declineReason);

      // 画面（`S-017`）: バッジの文言が異なり、詳細パネルにも理由が無い。
      const afterHtml = await pageHtml(host, '/proposal-requests');
      expect(afterHtml, 'S-017（ホスト）に辞退理由が現れました').not.toContain(state.declineReason);
      await expect(host.page.getByTestId(`proposal-request-row-${xReq}`)).toHaveAttribute('data-request-state', 'DECLINED');
      await expect(host.page.getByTestId(`proposal-request-row-${zReq}`)).toHaveAttribute('data-request-state', 'EXPIRED');
      await expect(host.page.getByTestId(`proposal-request-state-${xReq}`)).toHaveText(t('proposalRequests.state.DECLINED'));
      await expect(host.page.getByTestId(`proposal-request-state-${zReq}`)).toHaveText(t('proposalRequests.state.EXPIRED'));
      expect(t('proposalRequests.state.DECLINED')).not.toBe(t('proposalRequests.state.EXPIRED'));
      await host.page.getByTestId(`proposal-request-row-${xReq}`).click();
      await expect(host.page.getByTestId('proposal-request-detail')).toBeVisible();
      expect(await host.page.getByTestId('proposal-request-detail').innerHTML()).not.toContain(state.declineReason);
      // 終端の依頼には取り下げの導線が無い。
      await expect(host.page.getByTestId('proposal-request-withdraw')).toHaveCount(0);
      await expectNoBrokenLabels('S-017 提案依頼の一覧（ホスト・辞退後）', host.page);

      // 🔴 監査ログ（ホスト OWNER が読む `S-041` / #10）にも理由は無い（`summary` に載せない）。実名等も同様。
      const audit = await apiRequest(host.page, `/api/audit-logs?${auditLogPeriodQuery()}&limit=200`);
      expect(audit.status).toBe(200);
      expect(audit.text, '監査ログに辞退理由が現れました').not.toContain(state.declineReason);
      expectNoForbidden('GET /api/audit-logs（ホスト・辞退後）', audit.text, contentMarkers(engineers()));

      partner.outbound.assertNone();
      host.outbound.assertNone();
    } finally {
      await host.close();
      await partner.close();
    }
  });

  test('⑤ 別の候補（Y）で応諾（#33）→ Proposal(DRAFT) が 1 件でき、その時点でホストが到達でき、凍結行に実名とスキルシートが写る（F-018 AC-3）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const y = requireEngineer('Y');
    const yReq = requireRequest('y');
    const sheet = y.skillSheet;
    if (sheet === null) throw new Error('④が Y のスキルシートを用意していません。');
    const partner = await openTenantSession(browser, partnerSales(1, 1));
    const host = await openTenantSession(browser, hostOwner(1));
    try {
      // 応諾前: ホストの一覧では `REQUESTED`。
      expect(hostRequestState((await hostRequests(host)).body, yReq)).toBe('REQUESTED');

      // A1 が `S-018` で応諾する（確認 1 段。開示される 3 項目を列挙）。
      await pageHtml(partner, `/proposal-requests/${yReq}`);
      await expect(partner.page.getByTestId('proposal-request-respond-screen')).toHaveAttribute('data-request-state', 'REQUESTED');
      await expect(partner.page.getByTestId('proposal-request-respond-engineer-name')).toHaveText(y.displayName);
      await partner.page.getByTestId('proposal-request-respond-accept').click();
      const confirm = partner.page.getByTestId('proposal-request-respond-accept-confirm');
      await expect(confirm).toBeVisible();
      await expect(confirm.getByTestId('proposal-request-respond-accept-confirm-items').locator('li')).toHaveCount(3);
      await expectNoBrokenLabels('S-018 応諾の確認', partner.page);
      await partner.page.getByTestId('proposal-request-respond-accept-submit').click();
      await expect(partner.page.getByTestId('proposal-request-respond-accepted')).toBeVisible();
      const proposalId = (await partner.page.getByTestId('proposal-request-respond-accepted-proposal-id').textContent())?.trim() ?? '';
      expect(proposalId).toMatch(/^[0-9a-f-]{36}$/);
      state.proposalId = proposalId;

      // 再訪しても `ACCEPTED` で、同じ下書き ID が示される（サーバの状態だけが正）。
      await partner.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('proposal-request-respond-screen')).toHaveAttribute('data-request-state', 'ACCEPTED');
      await expect(partner.page.getByTestId('proposal-request-respond-accepted-proposal-id')).toHaveText(proposalId);
      await expectNoBrokenLabels('S-018 応諾済み', partner.page);

      // ✅ T-09-01: 応諾後の導線で `S-020`（編集）へ進む。🔴 経路 4 由来の下書きは**提案先が未設定の状態で開き**、
      //    「提案先が未設定です」を明示し、「レビューに出す」が押せない（`docs/04` §S-020 改訂 10。サーバは #39 で 422）。
      await partner.page.getByTestId('proposal-request-respond-open-proposal').click();
      await partner.page.waitForURL(`**/proposals/${proposalId}/edit`, { waitUntil: 'domcontentloaded' });
      await expect(partner.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'DRAFT');
      await expect(partner.page.getByTestId('proposal-editor-recipient-missing')).toBeVisible();
      await expect(partner.page.getByTestId('proposal-editor-origin-notice')).toBeVisible();
      await expect(partner.page.getByTestId('proposal-editor-request-gate')).toBeDisabled();
      await expect(partner.page.getByTestId('proposal-editor-request-gate-blocked')).toBeVisible();
      await expect(partner.page.getByTestId('proposal-editor-recipient-company-name')).toHaveValue('');
      // 凍結情報（氏名は凍結側）と、添付の選択肢（自社の CLEAN 版）が描かれる。
      await expect(partner.page.getByTestId('proposal-editor-freeze-notice')).toBeVisible();
      await expect(partner.page.getByTestId('proposal-editor-section-target')).toContainText(y.displayName);
      await expectNoBrokenLabels('S-020 提案の編集（経路 4 由来・提案先未設定）', partner.page);
      // 🔴 提案先を設定して保存すると「レビューに出す」が押せるようになる（#37 → 保存済みの値で判定）。
      await partner.page.getByTestId('proposal-editor-recipient-company-name').fill('T0809 架空エンド株式会社');
      await partner.page.getByTestId('proposal-editor-recipient-email').fill('t0809-recipient@example.test');
      await partner.page.getByTestId('proposal-editor-save').click();
      await expect(partner.page.getByTestId('proposal-editor-saved')).toBeVisible();
      await expect(partner.page.getByTestId('proposal-editor-request-gate')).toBeEnabled();
      await expect(partner.page.getByTestId('proposal-editor-recipient-missing')).toHaveCount(0);
      await expectNoBrokenLabels('S-020 提案の編集（提案先設定後）', partner.page);
      // 🔴 ホストも同じ下書きに到達でき、エンジニアの情報は凍結側（`S-020` は台帳の現在値を描かない）。
      await pageHtml(host, `/proposals/${proposalId}/edit`);
      await expect(host.page.getByTestId('proposal-editor')).toHaveAttribute('data-proposal-state', 'DRAFT');
      await expect(host.page.getByTestId('proposal-editor-section-target')).toContainText(y.displayName);
      await expectNoBrokenLabels('S-020 提案の編集（ホスト）', host.page);

      // 🔴 ホスト: `S-017` / #32 で `ACCEPTED` を見る。依頼の応答の形は変わらない（依頼先・氏名は依頼側には出ない）。
      const after = await hostRequests(host);
      expect(hostRequestState(after.body, yReq)).toBe('ACCEPTED');
      expectHostRequestItemsShaped('#32（応諾後）', after.body);
      await pageHtml(host, '/proposal-requests');
      await expect(host.page.getByTestId(`proposal-request-row-${yReq}`)).toHaveAttribute('data-request-state', 'ACCEPTED');
      await expect(host.page.getByTestId(`proposal-request-state-${yReq}`)).toHaveText(t('proposalRequests.state.ACCEPTED'));

      // 🔴 ホストは**この時点で** `Proposal` に到達できる（#40 は `proposals` / `review_gates` の C5 が母集団。
      //    存在しない ID は 404、生成された下書きは 200）。到達できる経路が Proposal 側に**だけ**現れた。
      const gateAbsent = await apiRequest(host.page, `/api/proposals/${ABSENT_UUID}/gate`);
      expect(gateAbsent.status).toBe(404);
      const gate = await apiRequest(host.page, `/api/proposals/${proposalId}/gate`);
      expect(gate.status, 'GET /api/proposals/{下書き}/gate（ホスト文脈）が 200 を返すこと').toBe(200);
      const gateBody = parseJson(gate) as Record<string, unknown>;
      expect(typeof gateBody.contentHash).toBe('string');

      // 🔴 凍結行（`EngineerSnapshot`）に Y の実名と最新 CLEAN 版のスキルシートが写っている（DB の表明）。
      //    ホストが凍結情報を読む API（#46 / `S-023`）は SP-09。ここでは「何が開示対象として凍結されたか」を確かめる。
      assertEngineerSnapshotFrozen(proposalId, { displayName: y.displayName, skillSheetId: sheet.id });

      // 🔴 応諾していない X には `Proposal` が無い（辞退 = 開示なし。`DECLINED` を `LOST` と混同しない）。
      await pageHtml(partner, `/proposal-requests/${requireRequest('x')}`);
      await expect(partner.page.getByTestId('proposal-request-respond-screen')).toHaveAttribute('data-request-state', 'DECLINED');
      await expect(partner.page.getByTestId('proposal-request-respond-accepted-proposal-id')).toHaveCount(0);

      partner.outbound.assertNone();
      host.outbound.assertNone();
    } finally {
      await host.close();
      await partner.close();
    }
  });

  test('⑥ 同一候補が別の案件の一覧にも現れるとき、参照子が異なり突合できない（F-017 AC-2 / BR-55）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const host = await openTenantSession(browser, hostOwner(1));
    const all = engineers();
    expect(all.map((engineer) => engineer.label)).toEqual(['X', 'Y', 'Z']);
    try {
      const published = await readCandidates(host, PUBLISHED_PROJECT_ID);
      const privateProject = await readCandidates(host, PRIVATE_PROJECT_ID);
      // 共有は案件スコープではない: 同じ候補集合（X / Y / Z + seed の 2 件）が両案件に出る。
      expect(published.refs.length, '2 件以上の共有候補（比較できる母集団）').toBeGreaterThanOrEqual(3);
      expect(privateProject.refs.length).toBe(published.refs.length);

      // 🔴 参照子は案件ごとに違い、一方の参照子は他方の応答本文に**部分文字列としても**現れない。
      for (const ref of published.refs) {
        expect(privateProject.refs).not.toContain(ref);
        expect(privateProject.response.text, `公開案件の参照子 ${ref} が未公開案件の応答に現れました`).not.toContain(ref);
      }
      for (const ref of privateProject.refs) {
        expect(published.response.text, `未公開案件の参照子 ${ref} が公開案件の応答に現れました`).not.toContain(ref);
      }

      // 🔴 テストだけが知る対応（共有元の操作の差分）で見ても、同一人物の参照子は案件ごとに別値である。
      for (const engineer of all) {
        expect(requireRef('published', engineer.label)).not.toBe(requireRef('private', engineer.label));
        expect(published.refs).toContain(requireRef('published', engineer.label));
        expect(privateProject.refs).toContain(requireRef('private', engineer.label));
      }

      // 🔴 2 案件の応答を突き合わせても、一致するスカラー値は「丸めた 5 項目 + 更新日 + 案件に依らない語」だけであり、
      //    識別子・安定したハッシュ・連番は 1 つも無い（`docs/05` §4.6 線引き表）。匿名候補の要素だけを取り出して比べる。
      const anonymousOf = (body: CandidateListBody) => body.items.filter((item) => 'candidateRef' in item);
      const publishedValues = new Set(collect(anonymousOf(published.body)).values);
      const shared = [...new Set(collect(anonymousOf(privateProject.body)).values)].filter((value) => publishedValues.has(value));
      const allowedShapes = [
        /^\d{4}-\d{2}-\d{2}$/, // updatedOn
        /^\d{1,3}$/, // fromManYen / toManYen / 都道府県コード
        /^(RANGE|OPEN)$/,
        new RegExp(`^(${YEARS_BANDS.join('|')})$`),
        new RegExp(`^(${AVAILABILITY_BANDS.join('|')})$`),
        new RegExp(`^(${REMOTE_MODES.join('|')})$`),
      ];
      const skillNames = new Set(
        anonymousOf(published.body).flatMap((item) => (item.skills as readonly { name: string }[]).map((skill) => skill.name)),
      );
      const suspicious = shared.filter(
        (value) => !skillNames.has(value) && !allowedShapes.some((shape) => shape.test(value)),
      );
      expect(suspicious, '2 案件の応答に共通する値のうち、丸めた 5 項目でも辞書名でもないもの（突合の材料）').toEqual([]);

      // 深さ走査: どちらの応答にも X / Y / Z の禁止値が 0 件。
      const markers = forbiddenJsonMarkers(all);
      expectNoForbidden('#30（公開案件）', published.response.text, markers);
      expectNoForbidden('#30（未公開案件）', privateProject.response.text, markers);
      expectAnonymousItemsShaped('#30（公開案件）', published.body.items);
      expectAnonymousItemsShaped('#30（未公開案件）', privateProject.body.items);

      // 並び順の対応は記録だけする（HMAC の並びは案件ごとに独立で、一致しないことが「望ましい」が保証ではない。
      // 保証されない性質を表明にしない）。
      const order = (refs: readonly string[], project: 'published' | 'private') =>
        all.map((engineer) => refs.indexOf(requireRef(project, engineer.label))).join(',');
      test.info().annotations.push({
        type: 'order',
        description: `X,Y,Z の位置: 公開案件=[${order(published.refs, 'published')}] 未公開案件=[${order(privateProject.refs, 'private')}]`,
      });

      host.outbound.assertNone();
    } finally {
      await host.close();
    }
  });

  test('⑦ パートナー A2 の画面 / API に、A1 の共有候補・依頼が 1 件も現れない（存在・件数とも。F-016 AC-5 / F-018 AC-6 / BR-56）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const baseline = state.a2Baseline;
    if (baseline === null) throw new Error('①が A2 の基準応答を取っていません。');
    const all = engineers();
    const requestIds = [requireRequest('x'), requireRequest('y'), requireRequest('z')];
    const refs = all.flatMap((engineer) => [requireRef('published', engineer.label), requireRef('private', engineer.label)]);
    const markers: readonly Marker[] = [
      ...forbiddenJsonMarkers(all),
      ...requestIds.map((id) => ({ label: 'proposal_requests.id（A1 宛の依頼）', value: id })),
      ...refs.map((ref) => ({ label: 'candidateRef（A1 の共有候補の参照子）', value: ref })),
      { label: 'proposals.id（A1 の応諾で生成された下書き）', value: state.proposalId ?? '' },
      { label: '辞退理由（A1 社内限定）', value: state.declineReason },
    ].filter((marker) => marker.value !== '');
    const a2 = await openTenantSession(browser, partnerSales(1, 2));
    try {
      // 🔴 A1 の活動（登録・共有・依頼・辞退・応諾・期限切れ）の前後で、A2 の応答は 1 バイトも変わらない
      //    （件数バッジ・並び順の変化・示唆を「列挙して否定する」のではなく、バイト列の同一性で否定する。
      //    `isolation.spec.ts` ④(c) と同じ手法）。
      const requests = await apiRequest(a2.page, '/api/proposal-requests?limit=100');
      const shares = await apiRequest(a2.page, '/api/engineer-shares');
      const home = await apiRequest(a2.page, '/api/home');
      expect(requests.status).toBe(200);
      expect(shares.status).toBe(200);
      expect(home.status).toBe(200);
      expect(requests.text, 'A2 の #32 が A1 の活動で変わりました').toBe(baseline.requests);
      expect(shares.text, 'A2 の GET /api/engineer-shares が A1 の活動で変わりました').toBe(baseline.shares);
      for (const response of [requests, shares, home]) {
        expectNoForbidden('A2 の API 応答', response.text, markers);
        expectNoHiddenCountHints('A2 の API 応答', response.text);
      }
      const requestList = parseJson(requests) as PartnerRequestList;
      expect(requestList.items.filter((item) => requestIds.includes(item.id))).toEqual([]);

      // 画面: `S-015`（自社の共有設定）/ `S-017`（自社宛の依頼）。
      const sharesHtml = await pageHtml(a2, '/engineer-shares');
      await expect(a2.page.getByTestId('engineer-share-screen')).toBeVisible();
      expectNoForbidden('A2 の S-015', sharesHtml, forbiddenMarkers(all));
      expectNoHiddenCountHints('A2 の S-015', sharesHtml);
      for (const engineer of all) {
        await expect(a2.page.getByTestId(`engineer-share-row-${engineer.id}`)).toHaveCount(0);
      }
      const requestsHtml = await pageHtml(a2, '/proposal-requests');
      await expect(a2.page.getByTestId('proposal-request-screen')).toBeVisible();
      expectNoForbidden('A2 の S-017', requestsHtml, [...forbiddenMarkers(all), ...markers.filter((m) => m.label.startsWith('proposal_requests') || m.label.startsWith('辞退'))]);
      expectNoHiddenCountHints('A2 の S-017', requestsHtml);
      for (const id of requestIds) {
        await expect(a2.page.getByTestId(`proposal-request-row-${id}`)).toHaveCount(0);
      }

      // 🔴 `S-018` / #33 / #34 を A1 宛の依頼 ID で直打ちしても「存在しない」（404。422 = 状態が合わない、ではない）。
      const unknownPage = await a2.page.goto(`/proposal-requests/${ABSENT_UUID}`, { waitUntil: 'domcontentloaded' });
      expect(unknownPage?.status()).toBe(404);
      for (const id of requestIds) {
        const nav = await a2.page.goto(`/proposal-requests/${id}`, { waitUntil: 'domcontentloaded' });
        expect(nav?.status(), `A2 が A1 宛の依頼 ${id} の S-018 を開けないこと`).toBe(404);
        await expect(a2.page.getByTestId('proposal-request-respond-not-found')).toBeVisible();
        await expect(a2.page.getByTestId('proposal-request-respond-screen')).toHaveCount(0);
        // ⚠️ 直打ちした URL（依頼 ID）は入力の反射として HTML に埋め込まれる。ID 以外の全マーカーを当てる。
        expectNoForbidden(
          'A2 の S-018 直打ち',
          await a2.page.content(),
          markers.filter((marker) => !marker.label.startsWith('proposal_requests.id')),
        );
        const decline = await apiRequest(a2.page, `/api/proposal-requests/${id}/decline`, { method: 'POST', body: { reason: '' } });
        const accept = await apiRequest(a2.page, `/api/proposal-requests/${id}/accept`, { method: 'POST' });
        expect(decline.status, `A2 の decline（A1 宛 ${id}）は 404`).toBe(404);
        expect(accept.status, `A2 の accept（A1 宛 ${id}）は 404`).toBe(404);
      }
      const unknownDecline = await apiRequest(a2.page, `/api/proposal-requests/${ABSENT_UUID}/decline`, { method: 'POST', body: { reason: '' } });
      expect(unknownDecline.status).toBe(404);

      // 🔴 匿名候補（#30 / `#15?projectId=`）は取引先には 1 件も出ない（`F-017 AC-5`）。A2 に公開された案件は無いので
      //    案件そのものが「存在しない」（404）。参照子・X / Y / Z の値も現れない。
      for (const projectId of [PUBLISHED_PROJECT_ID, PRIVATE_PROJECT_ID]) {
        const candidates = await apiRequest(a2.page, `/api/projects/${projectId}/candidates?limit=100`);
        expect(candidates.status).toBe(404);
        expectNoForbidden('A2 の #30', candidates.text, markers);
        const mixed = await apiRequest(a2.page, `/api/engineers?projectId=${projectId}&limit=100`);
        expect(mixed.status).toBe(404);
        expectNoForbidden('A2 の #15?projectId=', mixed.text, markers);
      }
      // A2 の自社台帳（#15）にも X / Y / Z は無い（C3 OWNER_SCOPED）。
      const ledger = await apiRequest(a2.page, '/api/engineers?limit=100');
      expect(ledger.status).toBe(200);
      expectNoForbidden('A2 の #15', ledger.text, markers);
      for (const engineer of all) {
        expect((await apiRequest(a2.page, `/api/engineers/${engineer.id}`)).status).toBe(404);
      }

      a2.outbound.assertNone();
    } finally {
      await a2.close();
    }
  });

  test('⑧ A1 が共有を停止（S-015）→ ホストの S-016 / #30 から即座に消える（F-016 AC-2。キャッシュ無し）', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const x = requireEngineer('X');
    const xRefPublished = requireRef('published', 'X');
    const xRefPrivate = requireRef('private', 'X');
    const partner = await openTenantSession(browser, partnerSales(1, 1));
    const host = await openTenantSession(browser, hostOwner(1));
    try {
      // 対照: 停止の直前まで X は両案件に出ている。
      const beforePublished = await readCandidates(host, PUBLISHED_PROJECT_ID);
      const beforePrivate = await readCandidates(host, PRIVATE_PROJECT_ID);
      expect(beforePublished.refs).toContain(xRefPublished);
      expect(beforePrivate.refs).toContain(xRefPrivate);

      // A1 が `S-015` で停止する。
      await revokeViaScreen(partner, x.id);
      await expectNoBrokenLabels('S-015 匿名共有の設定（停止後）', partner.page);
      const shares = parseJson(await apiRequest(partner.page, '/api/engineer-shares')) as {
        items: readonly { engineerId: string; shared: boolean; sharedOn: string | null }[];
      };
      const xShare = shares.items.find((item) => item.engineerId === x.id);
      expect(xShare?.shared).toBe(false);
      expect(xShare?.sharedOn).toBeNull();

      // 🔴 直後にホストが読む → 消えている（#30 は `cache-control: no-store`。経路上のキャッシュも無い）。
      const afterPublished = await apiRequestWithHeaders(host, `/api/projects/${PUBLISHED_PROJECT_ID}/candidates?limit=100`);
      expect(afterPublished.status).toBe(200);
      expect(afterPublished.cacheControl).toBe('no-store');
      const afterPublishedBody = parseJson({ status: afterPublished.status, text: afterPublished.text }) as CandidateListBody;
      const afterPublishedRefs = afterPublishedBody.items.flatMap((item) =>
        typeof item.candidateRef === 'string' ? [item.candidateRef] : [],
      );
      expect(afterPublishedRefs).not.toContain(xRefPublished);
      expect(afterPublishedRefs.length).toBe(beforePublished.refs.length - 1);
      expect(afterPublishedBody.total).toBe(beforePublished.body.total - 1);
      expect(afterPublished.text).not.toContain(xRefPublished);

      const afterPrivate = await readCandidates(host, PRIVATE_PROJECT_ID);
      expect(afterPrivate.refs).not.toContain(xRefPrivate);
      expect(afterPrivate.refs.length).toBe(beforePrivate.refs.length - 1);

      // `#15?projectId=` からも消える。
      const mixed = await apiRequest(host.page, `/api/engineers?projectId=${PUBLISHED_PROJECT_ID}&limit=100`);
      expect(mixed.status).toBe(200);
      expect(mixed.text).not.toContain(xRefPublished);

      // 画面（`S-016`）: 行そのものが無い（描画されて隠れているのではない）。Y / Z（共有中）は残る（対照）。
      const html = await pageHtml(host, `/projects/${PUBLISHED_PROJECT_ID}/candidates?limit=100`);
      await expect(host.page.getByTestId('candidate-screen')).toBeVisible();
      await expect(host.page.getByTestId(`candidate-list-row-${xRefPublished}`)).toHaveCount(0);
      expect(html).not.toContain(xRefPublished);
      await expect(host.page.getByTestId(`candidate-list-row-${requireRef('published', 'Y')}`)).toBeVisible();
      await expect(host.page.getByTestId(`candidate-list-row-${requireRef('published', 'Z')}`)).toBeVisible();
      expectNoForbidden('S-016（停止後）', html, forbiddenMarkers(engineers()));
      await expectNoBrokenLabels('S-016 候補検索（停止後）', host.page);

      // 🔴 解除された候補には依頼を出せない（参照子を知っていても 404。`candidateRef` は capability ではない）。
      const stale = await apiRequest(host.page, '/api/proposal-requests', {
        method: 'POST',
        body: {
          projectId: PRIVATE_PROJECT_ID,
          candidateRef: xRefPrivate,
          message: REQUEST_MESSAGE,
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        },
      });
      expect(stale.status, '共有解除済みの参照子への依頼は 404（存在を示唆しない）').toBe(404);

      // 走査した禁止値の種類を報告に残す（`E2E Run Report` の「走査した禁止値の種類と件数」）。
      test.info().annotations.push({
        type: 'forbidden-marker-kinds',
        description: `${scannedMarkerLabels.size} 種: ${[...scannedMarkerLabels].join(' / ')}`,
      });

      partner.outbound.assertNone();
      host.outbound.assertNone();
    } finally {
      await host.close();
      await partner.close();
    }
  });
});
