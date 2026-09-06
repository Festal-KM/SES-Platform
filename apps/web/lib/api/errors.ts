// apps/web/lib/api/errors.ts
// docs/05 §15.1 の例外階層と §15.2 の応答フォーマット。
//
// 🔴 本ファイルは T-03-01 で**必要な分だけ**を置いた土台であり、T-03-04 が
//    共通ガードの例外型（`ViewerNotAllowedError` / `TenantNotExecutableError` /
//    `InvalidStateTransitionError`）を同じ階層の上に足した。残り（Quota / Connector / …）も
//    ここに足す。**階層と応答フォーマットを二重に作らない。**
//
// 🔴 `userMessageKey` は `@ses/i18n` の `MessageKey` に型で縛る（BR-32 / CLAUDE.md §3.5）。
//    サーバで文言を組み立てられない（キーしか返せない）ことをコンパイラが保証する。
//
// 🔴 `details` に入れてよいのは `ValidationError` のフィールドパスだけである（docs/05 §15.2）。
//    DB のエラー本文・SQL・スタックトレース・外部 API の生応答を入れない。
import type { SendingDomainDnsRecord } from '@ses/connectors';
import {
  AuditLogWriteError,
  HostOnlyContextError,
  PlatformRoleNotAllowedError,
  TransactionSerializationError,
  TwoFactorRequiredError as DbTwoFactorRequiredError,
} from '@ses/db';
import type {
  TenantLifecycleState,
  TenantSendingDomainState,
  TwoFactorRequirementReason,
} from '@ses/db';
import { InvalidStateTransitionError as DomainInvalidStateTransitionError } from '@ses/domain';
import type { StateMachineEntity } from '@ses/domain';
import type { MessageKey } from '@ses/i18n';

export type ErrorLogLevel = 'warn' | 'error';

/** docs/05 §15.2 の応答ボディ。 */
export type ApiErrorBody = {
  readonly error: {
    readonly code: string;
    readonly messageKey: MessageKey;
    readonly retryable: boolean;
    readonly details?: readonly string[];
    /**
     * 🔴 docs/05 §15.2 の `params?`。**`messageKey` に添える構造化データ**である（T-04-05 で実装）。
     *
     * 🔴 `details` の代わりに使わない —— `details` は `ValidationError` のフィールドパス専用であり、
     *    そこに DB のエラー本文・SQL・外部 API の生応答を入れてはならない（同節）。
     *    `params` に載せてよいのは「利用者が次の行動を取るために必要で、かつ秘匿でない値」だけである。
     *    現在の唯一の用途は `SendingDomainNotVerifiedError` の DNS レコード（DNS に公開する値であり
     *    秘匿ではない。`F-022 AC-7` が「設定すべき DNS レコードが実行者に表示される」ことを要求する）。
     */
    readonly params?: Readonly<Record<string, unknown>>;
  };
};

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  abstract readonly userMessageKey: MessageKey;
  readonly logLevel: ErrorLogLevel = 'warn';
  readonly retryable: boolean = false;
  /** 🔴 `ValidationError` のフィールドパスのみ。 */
  readonly details?: readonly string[];
  /** 🔴 §15.2 の `params?`。秘匿でない構造化データだけを載せる。 */
  readonly params?: Readonly<Record<string, unknown>>;
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION';
  readonly httpStatus = 400;
  readonly userMessageKey: MessageKey = 'error.validation';
  override readonly details: readonly string[];

  constructor(details: readonly string[]) {
    super('リクエストの検証に失敗しました。');
    this.name = 'ValidationError';
    this.details = details;
  }
}

/**
 * 401。🔴 サインインの失敗理由（存在しない / パスワード不一致 / 無効化）を**区別しない**
 * （docs/04 §S-001「メールアドレスが存在しないとパスワードが違うを区別しない」）。
 */
export class AuthenticationError extends AppError {
  // 🔴 派生（TwoFactorCodeInvalidError）が別のコードを名乗れるよう、リテラル型に固定しない。
  readonly code: string = 'UNAUTHENTICATED';
  readonly httpStatus = 401;
  readonly userMessageKey: MessageKey = 'error.unauthenticated';

  constructor() {
    super('認証されていません。');
    this.name = 'AuthenticationError';
  }
}

export class ForbiddenError extends AppError {
  // 🔴 派生（ViewerNotAllowedError / TwoFactorRequiredError）が別のコードを名乗れるようにする。
  readonly code: string = 'FORBIDDEN';
  readonly httpStatus = 403;
  readonly userMessageKey: MessageKey = 'error.forbidden';

  constructor() {
    super('この操作を実行する権限がありません。');
    this.name = 'ForbiddenError';
  }
}

/**
 * 🔴 `VIEWER` が実行系（承認 / 送信 / ダウンロード / エクスポート）を呼んだ
 *    （docs/05 §15.1 / §6.2 / `BR-31` / `F-004 AC-6`）。403。
 *
 * 🔴 `ForbiddenError` と別コードにする理由: `VIEWER` の拒否は**ロールの設計どおりの結果**であり、
 *    「権限が足りない（＝ 昇格すれば実行できる）」とは別の意味を持つ。画面は文言を出し分ける
 *    （`error.viewer.notAllowed`）。区別しても情報境界は緩まない —— 自分のロールは本人が知っている。
 */
export class ViewerNotAllowedError extends ForbiddenError {
  override readonly code = 'VIEWER_NOT_ALLOWED';
  override readonly userMessageKey: MessageKey = 'error.viewer.notAllowed';

  constructor() {
    super();
    this.name = 'ViewerNotAllowedError';
  }
}

/**
 * 🔴 `PLATFORM_SUPPORT` が `PLATFORM_OWNER` 専用の操作を要求した（403。`CLAUDE.md` §10.1 /
 *    `BR-44` / docs/02 章 5.4「`PLATFORM_SUPPORT` の要求は 403」）。T-03-10。
 *
 * 🔴 `ForbiddenError` と別コードにする理由: これは**ロール設計どおりの結果**であり、
 *    運営者本人は自分のロールを知っている。「`PLATFORM_OWNER` に依頼する」という次の行動へ
 *    導くために区別する（`ViewerNotAllowedError` と同じ考え方）。情報境界は緩まない。
 */
export class PlatformOwnerRequiredError extends ForbiddenError {
  override readonly code = 'PLATFORM_OWNER_REQUIRED';
  override readonly userMessageKey: MessageKey = 'error.admin.ownerRequired';

  constructor() {
    super();
    this.name = 'PlatformOwnerRequiredError';
  }
}

/**
 * 🔴 2 要素認証が未充足（docs/05 §15.1 / §6.2 / `BR-30` / `F-003 AC-2`）。403。
 *
 * `resolveTenantCtx`（packages/db）が投げた `TwoFactorRequiredError` を API 応答へ写像する。
 * 🔴 `reason` は**遷移先を決めるためだけ**の情報である（設定ウィザードか、コード入力か）。
 *    参照範囲・権限には一切影響しない。
 */
export class TwoFactorRequiredError extends ForbiddenError {
  override readonly code = 'TWO_FACTOR_REQUIRED';
  override readonly userMessageKey: MessageKey = 'error.2fa.required';

  constructor(readonly reason: TwoFactorRequirementReason) {
    super();
    this.name = 'TwoFactorRequiredError';
  }
}

/**
 * 🔴 2 要素認証のコードが一致しない（401）。docs/05 §15.1 の `AuthenticationError` 配下に置く
 *    （同節が `ForbiddenError` 配下に `ViewerNotAllowedError` 等を並べているのと同じ入れ子）。
 *
 * 🔴 「TOTP が違う」と「リカバリコードが違う」を区別しない（どちらも同じ応答）。
 *    区別すると、どちらの要素が有効かを試行から推測できてしまう。
 */
export class TwoFactorCodeInvalidError extends AuthenticationError {
  override readonly code = 'TWO_FACTOR_CODE_INVALID';
  override readonly userMessageKey: MessageKey = 'error.2fa.invalidCode';

  constructor() {
    super();
    this.name = 'TwoFactorCodeInvalidError';
  }
}

/**
 * 🔴 2 要素認証の試行回数が上限に達した（429）。docs/04 §S-001「ロックアウトは残り時間を明示」。
 *
 * docs/05 §15.1 の `QuotaExceededError`（429）と同じ段に置く。**コードを検証せずに拒否した**ことを
 * 表すため、`AuthenticationError`（コードが違う）とは別の型にする。
 * 🔴 応答からは「資格情報があるか」「TOTP とリカバリコードのどちらが有効か」を推測させない
 *    （返すのは残り時間だけ）。残り時間は `Retry-After` ヘッダで返す（本文の形は §15.2 のまま）。
 */
export class TwoFactorThrottledError extends AppError {
  readonly code = 'TWO_FACTOR_THROTTLED';
  readonly httpStatus = 429;
  readonly userMessageKey: MessageKey = 'error.2fa.throttled';
  override readonly retryable = true;

  constructor(readonly retryAfterSeconds: number) {
    super('2 要素認証の試行回数が上限に達しました。');
    this.name = 'TwoFactorThrottledError';
  }
}

/**
 * 409。docs/05 §15.1 の `ConflictError` 段。
 * 🔴 T-03-04 が `TenantNotExecutableError` 等を同じ段に足す。**409 の基底を二重に作らない。**
 */
export class ConflictError extends AppError {
  readonly code: string = 'CONFLICT';
  readonly httpStatus = 409;
  readonly userMessageKey: MessageKey = 'error.conflict';

  constructor(message = '現在の状態では実行できません。') {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * 🔴 テナントのライフサイクル状態が実行系を許さない（docs/05 §15.1 / §6.2 /
 *    `F-004 AC-7`〜`AC-9`）。409。
 *
 * 🔴 これは**ロールの権限より優先する**（`F-004` 処理⑤）。`OWNER` でも拒否される。
 * 🔴 `userMessageKey` を状態ごとに変える（`F-004 AC-9`「拒否の理由が利用者に表示される」）。
 *    どの状態にどのキーを割り当てるかは `lib/api/guards.ts` の 1 つの表が決める
 *    （**この型は判定を持たない**。判定の出所が 2 箇所に分かれると、片方だけ緩む）。
 */
export class TenantNotExecutableError extends ConflictError {
  override readonly code = 'TENANT_NOT_EXECUTABLE';
  override readonly userMessageKey: MessageKey;

  constructor(
    /** 🔴 応答ボディには載せない（内部ログ用。docs/05 §15.2）。 */
    readonly lifecycleState: TenantLifecycleState,
    userMessageKey: MessageKey,
  ) {
    super(`テナントの状態（${lifecycleState}）では実行系の操作を行えません。`);
    this.name = 'TenantNotExecutableError';
    this.userMessageKey = userMessageKey;
  }
}

/**
 * 🔴 所属する取引先企業が停止されている（`F-007 AC-2` / docs/05 §6.2）。409。T-04-07。
 *
 * 🔴 `TenantNotExecutableError`（テナントのライフサイクル）と**別のコードにする**理由:
 *    止まっている単位が違い、解除できる主体も違う（テナントの停止は `PLATFORM_OWNER`、
 *    取引先の停止はホストの `OWNER` / `ADMIN`）。同じコードに畳むと、利用者も運営者も
 *    「誰に何を頼めば解けるのか」が分からなくなる。
 * 🔴 これは**実行系だけ**の拒否である（`F-007 AC-2`「提案作成・送信・チャット投稿ができなく
 *    なり、既存データは削除されない」）。閲覧・エクスポートは止めない。
 * 🔴 ホストが停止中の取引先へ**新しいアカウントを招く**ことも拒否する（#14）。
 *    許すと配下アカウントが増え続け、停止の意味が実質的に失われる。
 */
export class PartnerCompanySuspendedError extends ConflictError {
  override readonly code = 'PARTNER_COMPANY_SUSPENDED';
  override readonly userMessageKey: MessageKey = 'error.partnerCompany.suspended';

  constructor() {
    super('この取引先は停止されているため、実行系の操作を行えません。');
    this.name = 'PartnerCompanySuspendedError';
  }
}

/**
 * 🔴 同時に実行された操作と競合した（409）。T-04-09。
 *
 * 出所は 2 つあり、いずれも**同じ事実**（＝ 自分が読んだ状態が、書く前に他者に書き換えられた）を指す:
 *   ① 条件付き UPDATE（CAS）が 0 件だった —— 読んだ値を `where` に含めているため、
 *      値が変わっていれば 0 件になる（`lib/members/service.ts`）。
 *   ② `Serializable` の直列化失敗（`TransactionSerializationError`。PostgreSQL の `40001`）。
 *
 * 🔴 **500 に潰さない。** 利用者から見れば「画面を更新してやり直せば済む」ことであり、
 *    障害率の指標に混ぜると監視が誤検知する（`CLAUDE.md` §4.2「失敗と保留を混同しない」）。
 * 🔴 **サーバ側で自動再試行しない。** 判定（例: 最後の `OWNER` か）をやり直さずに書き直すと、
 *    守ろうとしている不変条件がその場で破れる。
 */
export class ConcurrentUpdateError extends ConflictError {
  override readonly code = 'CONCURRENT_UPDATE';
  override readonly userMessageKey: MessageKey = 'error.concurrentUpdate';
  override readonly retryable = true;

  constructor() {
    super('同時に実行された操作と競合しました。');
    this.name = 'ConcurrentUpdateError';
  }
}

/**
 * 🔴 無効化済みの所属に対してロール変更を要求した（409）。T-04-09。
 *
 * 無効化からの復帰は招待の再発行（#14）であり、ロールの付け直しではない。
 * ⚠️ **無効化そのものは冪等**である（すでに無効化済みなら 204。#13 の停止・再開と同じ規律）。
 */
export class MemberRevokedError extends ConflictError {
  override readonly code = 'MEMBER_REVOKED';
  override readonly userMessageKey: MessageKey = 'error.member.revoked';

  constructor() {
    super('この所属はすでに無効化されています。');
    this.name = 'MemberRevokedError';
  }
}

/**
 * 🔴 対象のアカウントが実行者の所属の外にある（`F-002 AC-4`。docs/05 §6.7 #84 / #85）。403。T-04-09。
 *
 * 🔴 404 にしない理由: このコードが返るのは**ホストの `OWNER` / `ADMIN` がパートナー配下の
 *    `Membership` を操作しようとした**ときだけである。ホストはその行を一覧（#83）で見られる立場
 *    （RLS の C5）なので、存在を隠す意味が無く、「取引先自身の `PARTNER_ADMIN` が行う操作である」
 *    という次の行動を伝えるほうが価値が高い。
 * 🔴 逆向き（`PARTNER_ADMIN` → 他社 / ホスト）は**行が 1 つも見えない**ため、この型に到達する前に
 *    404 になる（`F-002 AC-4`「他社および自社（ホスト）のアカウントは一覧にも現れない」）。
 */
export class MemberOutOfScopeError extends ForbiddenError {
  override readonly code = 'MEMBER_OUT_OF_SCOPE';
  override readonly userMessageKey: MessageKey = 'error.member.outOfScope';

  constructor() {
    super();
    this.name = 'MemberOutOfScopeError';
  }
}

/**
 * 🔴 新語候補の採否がすでに決まっている（409。`F-010 AC-1`。docs/05 §6.4 #24）。T-05-03。
 *
 * 🔴 `ConcurrentUpdateError`（並行更新）と**別のコードにする**理由: `docs/04` §S-009 の
 *    状態の齟齬は「候補が他者に採用済み → **『すでに採用されました』**」であり、利用者の
 *    次の行動（やり直す／画面を更新して結果を確認する）が違う。
 * 🔴 404 に畳まない —— 候補の行は一覧（#23）に見えている立場の利用者にしか返らない。
 */
export class SkillAliasAlreadyDecidedError extends ConflictError {
  override readonly code = 'SKILL_ALIAS_ALREADY_DECIDED';
  override readonly userMessageKey: MessageKey = 'error.skillAlias.alreadyDecided';

  constructor() {
    super('この新語候補の採否はすでに決まっています。');
    this.name = 'SkillAliasAlreadyDecidedError';
  }
}

/**
 * 🔴 グローバル辞書（`Skill` / `tenant_id IS NULL` の `SkillAlias`）をテナントから
 *    編集しようとした（403。`F-010 AC-2` / `BR-02` の射程）。T-05-03。
 *
 * 🔴 404 にしない理由: グローバル行は `S-009` のセクション 3 に**読み取り専用として
 *    表示されている**（RLS の `SELECT` だけが `OR tenant_id IS NULL` を許す）。見えている行に
 *    「存在しない」と答えると、利用者は自分の操作が届いていないのか対象が消えたのかを
 *    区別できない。ここで隠すべき情報は無い（グローバル辞書はテナントに属さないマスタである）。
 * 🔴 これは 3 層目の拒否である。1 層目は RLS の `UPDATE` ポリシー、2 層目は Prisma 拡張の
 *    書込述語であり、どちらも 0 件更新にする。**理由を返すためにこの型がある。**
 */
export class GlobalSkillDictionaryReadOnlyError extends ForbiddenError {
  override readonly code = 'GLOBAL_SKILL_DICTIONARY_READ_ONLY';
  override readonly userMessageKey: MessageKey = 'error.skillAlias.globalReadOnly';

  constructor() {
    super();
    this.name = 'GlobalSkillDictionaryReadOnlyError';
  }
}

/**
 * 🔴 アップロードの確定（#19）で、申告された `objectKey` に**実体が無かった**（409）。T-05-06。
 *
 * 🔴 400 にしない理由: 入力の形は正しい（我々が #18 で発行したキーの形をしている）。起きたのは
 *    「置いたと申告されたが S3 に無い」という**状態の食い違い**であり、利用者の次の行動は
 *    「もう一度アップロードする」である（入力を直すことではない）。
 * 🔴 **実体が無いまま行を作らない。** 作ると、台帳に「開けない版」が並び、`UsageCounter` にも
 *    存在しないバイト数が載る（docs/05 §14.3 の突き合わせが恒久的にずれる）。
 */
export class SkillSheetObjectMissingError extends ConflictError {
  override readonly code = 'SKILL_SHEET_OBJECT_MISSING';
  override readonly userMessageKey: MessageKey = 'error.skillSheet.objectMissing';

  constructor() {
    super('アップロードされたファイルが見つかりません。');
    this.name = 'SkillSheetObjectMissingError';
  }
}

/**
 * 🔴 `CLEAN` でない版に対して、最新版への切替を要求した（409。`F-011` 処理③ / `BR-26`）。T-05-06。
 *
 * 🔴 画面（`S-008`）には**導線が無い**（`F-011 AC-1`）。この型が返るのは API を直接呼んだ場合か、
 *    画面を開いたままスキャン結果が動いた場合である。**「無視して切り替える」経路は無い。**
 * 🔴 403 にしない: ロールの問題ではない（`OWNER` でも同じ）。対象の状態の問題である。
 */
export class SkillSheetNotCleanError extends ConflictError {
  override readonly code = 'SKILL_SHEET_NOT_CLEAN';
  override readonly userMessageKey: MessageKey = 'error.skillSheet.notClean';

  constructor() {
    super('この版は検査に合格していないため、最新版にできません。');
    this.name = 'SkillSheetNotCleanError';
  }
}

/**
 * 🔴 ウイルス検査に合格していないファイルのダウンロードを要求した（409）。T-05-07。
 *
 * 🔴 `SkillSheetNotCleanError`（＝ 最新版にできない）と**畳まない**。止めている操作が違い、
 *    利用者が次に取る行動も違う（あちらは「別の版を選ぶ」、こちらは「そもそも渡さない」）。
 *    文言を 1 つにすると、隔離されたファイルのダウンロードを断るときに
 *    「最新版にできません」と表示されることになる。
 * 🔴 スキルシート専用にしない —— 発行経路（`issueDownloadUrl`）は契約書（#82。SP-17）や
 *    返却データ（#78）でも同じであり、判定も 1 箇所である（`lib/storage/download.ts`）。
 */
export class FileNotCleanError extends ConflictError {
  override readonly code = 'FILE_NOT_CLEAN';
  override readonly userMessageKey: MessageKey = 'error.file.notClean';

  constructor() {
    super('このファイルはウイルス検査に合格していないため、ダウンロードできません。');
    this.name = 'FileNotCleanError';
  }
}

/**
 * 🔴 提案に凍結添付された版を削除しようとした（409）。T-05-06（Iteration 2）。
 *
 * 🔴 **これは「順序の事故」を防ぐための事前チェックである。** 版の削除は
 *    ①S3 の実体 → ②`UsageCounter` の減算 → ③行 + 監査 の順で進む（`docs/03` §4.12）。
 *    `engineer_snapshots.skill_sheet_id` の FK（`ON DELETE RESTRICT`）が守るのは**③の行だけ**で
 *    あり、①が先に走る以上、**FK が発火したときには実体がすでに消えている**。
 *    `EngineerSnapshot` は越境経路 2（提案時点の凍結情報）の証跡であり、
 *    復元できない形で失うと「誰に何を提案したか」を後から説明できなくなる
 *    （`CLAUDE.md` §7 の説明責任）。したがって**①より前**に止める。
 * 🔴 FK は最終防衛線として残る（事前チェックと③の間に凍結が入る競合をカバーする）。
 *    **どちらか一方にしない。**
 */
export class SkillSheetReferencedError extends ConflictError {
  override readonly code = 'SKILL_SHEET_REFERENCED';
  override readonly userMessageKey: MessageKey = 'error.skillSheet.referenced';

  constructor() {
    super('この版は提案に添付されているため削除できません。');
    this.name = 'SkillSheetReferencedError';
  }
}

/**
 * 🔴 検査中（`SCANNING`）の版に対して削除を要求した（409）。T-05-06。
 *
 * 検査中のオブジェクトを消すと、後から届くスキャン結果の適用が `SCAN_TARGET_NOT_FOUND` になり
 * （docs/05 §9.6）、**本物の取りこぼしと区別できない雑音**が `A-005` に流れ込む。
 * 待てば必ず確定する（`scan.poll` が滞留を拾う）ため、`retryable` は `true` にする。
 */
export class SkillSheetScanInProgressError extends ConflictError {
  override readonly code = 'SKILL_SHEET_SCAN_IN_PROGRESS';
  override readonly userMessageKey: MessageKey = 'error.skillSheet.scanInProgress';
  override readonly retryable = true;

  constructor() {
    super('検査中の版は操作できません。');
    this.name = 'SkillSheetScanInProgressError';
  }
}

/**
 * 🔴 招待を受諾できない（docs/05 §6.3 #7。`acceptedAt` の CAS が 0 件）。
 *
 * 受諾済み / 取消済み / 期限切れ / トークン不一致 / 同時受諾に負けた、を**区別しない**。
 * 区別すると、無効なトークンを総当たりした側に「そのトークンは実在する」ことが伝わる。
 * 画面（`S-002`）が出し分ける文言は `#6` の応答（トークンを持つ本人にだけ返る）から決める。
 */
export class InvitationNotAcceptableError extends ConflictError {
  override readonly code = 'INVITATION_NOT_ACCEPTABLE';
  override readonly userMessageKey: MessageKey = 'error.invitation.notAcceptable';

  constructor() {
    super('この招待は受諾できません。');
    this.name = 'InvitationNotAcceptableError';
  }
}

/**
 * 🔴 同じ `provisioningRequestId` での開設要求がすでに処理済み（409。docs/05 §10.7）。T-03-10。
 *
 * `Tenant.provisioningRequestId` の `UNIQUE` が冪等の担保であり、**重複テナントを作らない**
 * ことがこのエラーの目的である（重複が生まれると、分離が正しく効いたまま業務が 2 つに割れる）。
 */
export class TenantProvisioningConflictError extends ConflictError {
  override readonly code = 'TENANT_PROVISIONING_CONFLICT';
  override readonly userMessageKey: MessageKey = 'error.admin.provisioning.duplicateRequest';

  constructor() {
    super('この開設要求はすでに処理済みです。');
    this.name = 'TenantProvisioningConflictError';
  }
}

/**
 * 422。docs/05 §15.1 の `UnprocessableError` 段。
 * 🔴 T-03-04 以降が `InvalidStateTransitionError` / `SendingDomainNotVerifiedError` を同じ段に足す。
 */
export class UnprocessableError extends AppError {
  readonly code: string = 'UNPROCESSABLE';
  readonly httpStatus = 422;
  readonly userMessageKey: MessageKey = 'error.unprocessable';

  constructor(message = 'この内容では処理できません。') {
    super(message);
    this.name = 'UnprocessableError';
  }
}

/**
 * 🔴 `CLAUDE.md` §4.2 の遷移表に無い状態遷移（docs/05 §15.1 / §15.3 / `BR-33`）。422。
 *
 * 🔴 **状態機械そのものは `packages/domain` に 1 つだけある。** ここにあるのは
 *    その例外（`@ses/domain` の `InvalidStateTransitionError`）を HTTP に写像する型である。
 *    `packages/domain` は何にも依存できない（`CLAUDE.md` §2.1）ため `AppError` を継承できず、
 *    写像は API 境界の責務になる（`toAppError` が唯一の変換点）。**判定を二重に持たない。**
 */
export class InvalidStateTransitionError extends UnprocessableError {
  override readonly code = 'INVALID_STATE_TRANSITION';
  override readonly userMessageKey: MessageKey = 'error.state.invalidTransition';

  constructor(
    /** 🔴 いずれも応答ボディには載せない（内部ログ用。docs/05 §15.2）。 */
    readonly entity: StateMachineEntity,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${entity}: ${from} -> ${to} は遷移表にありません。`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * 🔴 開設時の環境と初期状態の組み合わせが `docs/02` 章 5.4 の規則に反する（422）。T-03-10。
 *
 * 「見込み客の試用として開設すれば `SANDBOX`、本契約として開設すれば `ACTIVE`。
 *  `demo` 環境のテナントは `ACTIVE` として扱う」。判定の本体は
 * `packages/domain` の `isValidTenantCreation`（**この型は判定を持たない**）。
 */
export class TenantProvisioningInvalidError extends UnprocessableError {
  override readonly code = 'TENANT_PROVISIONING_INVALID';
  override readonly userMessageKey: MessageKey = 'error.admin.provisioning.invalidCombination';

  constructor() {
    super('環境と契約の初期状態の組み合わせが不正です。');
    this.name = 'TenantProvisioningInvalidError';
  }
}

/**
 * 🔴 送信元の独自ドメインが未検証（docs/05 §6.2 / §8.3 / §15.1 / `BR-51` / `BR-71` /
 *    `F-001 AC-4` / `F-022 AC-7`）。**422**。T-04-05。
 *
 * 🔴 **これは障害ではなく「設定未了」である。** 対象の状態を進めてはならない
 *    （`Proposal` は `APPROVED` のまま、`Contract` は `DRAFT` のまま）。`SUBMIT_FAILED` /
 *    `SEND_FAILED` と混ぜると、成約率と障害率の両方の指標が汚れる（`CLAUDE.md` §4.2）。
 * 🔴 **共通ドメインへフォールバックしない**（`BR-51`）。フォールバックは
 *    「成功したように見えて違反している」壊れ方を生む。
 * 🔴 応答に**設定すべき DNS レコード**を載せる（`F-022 AC-7` / `F-001 AC-4`「理由と設定すべき
 *    DNS レコードが実行者に表示される」）。DKIM の CNAME と MAIL FROM の MX / TXT は
 *    **DNS に公開する値であり秘匿ではない**（`packages/connectors` の `SendingDomainDnsRecord`）。
 *    伏せると利用者が設定できず、`S-036` へ移動しないと理由が分からなくなる。
 */
export class SendingDomainNotVerifiedError extends UnprocessableError {
  override readonly code = 'SENDING_DOMAIN_NOT_VERIFIED';
  override readonly userMessageKey: MessageKey = 'error.sendingDomain.unverified';
  override readonly params: Readonly<Record<string, unknown>>;

  constructor(detail: SendingDomainNotVerifiedDetail) {
    super('送信元ドメインが未検証のため、取引先へ届く送信は実行できません。');
    this.name = 'SendingDomainNotVerifiedError';
    this.params = { ...detail };
  }
}

/**
 * `SendingDomainNotVerifiedError` が応答に載せる内容（docs/04 `S-036` の提示項目と同じ形）。
 *
 * 🔴 `state === null` / `domain === null` は「まだ 1 件も登録していない」を表す
 *    （`TenantSendingDomainState` に値を足さない。DB の CHECK は 4 値のままである）。
 * 🔴 文言ではなく**キー**を返す（`CLAUDE.md` §3.5 / `BR-32`）。
 */
export type SendingDomainNotVerifiedDetail = {
  readonly domain: string | null;
  readonly state: TenantSendingDomainState | null;
  readonly failureReasonKey: MessageKey | null;
  readonly dkimRecords: readonly SendingDomainDnsRecord[];
  readonly mailFromRecords: readonly SendingDomainDnsRecord[];
};

/**
 * 🔴 招待先のメールアドレスの利用者が、すでにそのテナントに存在する（`users` の
 *    `@@unique([tenantId, email])`。docs/05 §3.3）。422。
 *
 * なぜ 404 / 409 に畳まず存在を明かすか: このエラーを受け取るのは**招待を発行できる
 * `OWNER` / `ADMIN`**（`F-002` 関連ロール）だけであり、自テナントのメンバー一覧を
 * 見られる立場である。したがって情報境界（`CLAUDE.md` §3.1）の観点で新たに漏れるものは無く、
 * 「招待ではなくロール変更が要る」という次の行動を伝えられる方が価値が高い。
 * 🔴 **未認証経路（#6 / #7）ではこの型を使わない**（そちらは常に 409 で理由を区別しない）。
 */
export class InvitationEmailAlreadyMemberError extends UnprocessableError {
  override readonly code = 'INVITATION_EMAIL_ALREADY_MEMBER';
  override readonly userMessageKey: MessageKey = 'error.invitation.emailAlreadyMember';

  constructor() {
    super('このメールアドレスの利用者はすでにこのテナントに存在します。');
    this.name = 'InvitationEmailAlreadyMemberError';
  }
}

/**
 * 🔴 自分自身の所属を操作しようとした（422）。T-04-09。
 *
 * 自己昇格（`ADMIN` → `OWNER`）と自己ロックアウト（自分を無効化して復旧できなくする）の
 * 両方を、同じ 1 つの規則で塞ぐ（`lib/members/policy.ts`）。
 */
export class MemberSelfManagementError extends UnprocessableError {
  override readonly code = 'MEMBER_SELF_MANAGEMENT';
  override readonly userMessageKey: MessageKey = 'error.member.selfManagement';

  constructor() {
    super('自分自身のロール変更・無効化はできません。');
    this.name = 'MemberSelfManagementError';
  }
}

/**
 * 🔴 付与しようとしたロールが対象の所属と噛み合わない（422）。T-04-09。
 *
 * `memberships` の CHECK 制約（`(role IN (PARTNER_*)) = (partner_company_id IS NOT NULL)`）と
 * 同じ規律である。DB でも弾かれるが、**理由が伝わる形で先に断る**ために型を分ける。
 */
export class MemberRoleNotAssignableError extends UnprocessableError {
  override readonly code = 'MEMBER_ROLE_NOT_ASSIGNABLE';
  override readonly userMessageKey: MessageKey = 'error.member.roleNotAssignable';

  constructor() {
    super('この所属に付与できるロールではありません。');
    this.name = 'MemberRoleNotAssignableError';
  }
}

/**
 * 🔴 最後の有効な `OWNER` を降格・無効化しようとした（422）。T-04-09。
 *
 * `OWNER` が 1 人も居ないテナントは契約者・支払者が不在であり（`CLAUDE.md` §10.1）、
 * テナント側の操作では復旧できない（運営者の関与が要る）。**不可逆な事故を作らない**ために止める。
 */
export class MemberLastOwnerError extends UnprocessableError {
  override readonly code = 'MEMBER_LAST_OWNER';
  override readonly userMessageKey: MessageKey = 'error.member.lastOwner';

  constructor() {
    super('最後の OWNER を降格・無効化することはできません。');
    this.name = 'MemberLastOwnerError';
  }
}

/**
 * 🔴 パスワード再設定トークンが無効（docs/05 §6.3 #5b「トークン列の CAS で 1 回限り、
 *    期限超過は 400」）。
 *
 * 不一致・期限切れ・使用済みを**区別しない**（区別するとトークンの実在が漏れる）。
 */
export class PasswordResetTokenInvalidError extends AppError {
  readonly code = 'PASSWORD_RESET_TOKEN_INVALID';
  readonly httpStatus = 400;
  readonly userMessageKey: MessageKey = 'error.passwordReset.invalidToken';

  constructor() {
    super('パスワード再設定のリンクが無効です。');
    this.name = 'PasswordResetTokenInvalidError';
  }
}

/**
 * 429。docs/05 §15.1 の `QuotaExceededError` 段。
 * 🔴 これは**障害ではなく上限到達**である。`retryable` を安易に true にしない ——
 *    どうすれば解消するかは上限の種類ごとに違う（AI の日次は翌日、ストレージは削除するまで）。
 */
export class QuotaExceededError extends AppError {
  readonly code: string = 'QUOTA_EXCEEDED';
  readonly httpStatus = 429;
  readonly userMessageKey: MessageKey = 'error.quota.exceeded';

  constructor(message = '利用量の上限に達しました。') {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

/**
 * 🔴 ストレージ上限に達しているため、アップロード用の署名付き URL を**発行しなかった**
 *    （docs/05 §14.2 / docs/03 §4.5 / `F-027`）。429。T-05-04。
 *
 * 🔴 **「発行してから失敗させる」ではない。** 発行すると S3 側には書けてしまい、
 *    `UsageCounter`（正）と実体がずれる。ずれたカウンタは停止判定と月末原価の両方の根拠を失う。
 * 🔴 応答に**残量も上限値も載せない**。パートナー所属の利用者もこの経路を通る（`F-011` の
 *    関連ロール）ため、テナントの保管量が読み取れる形にしない（`F-027 AC-1`「パートナーには
 *    停止の事実と理由だけ」）。文言も「管理者に連絡する」という次の行動だけを示す。
 * 🔴 `retryable = false`。時間を置いても解消しない（削除するか上限を上げるまで）。
 */
export class StorageLimitExceededError extends QuotaExceededError {
  override readonly code = 'STORAGE_LIMIT_EXCEEDED';
  override readonly userMessageKey: MessageKey = 'error.quota.storage';

  constructor() {
    super('ストレージの上限に達しているため、アップロードを開始できません。');
    this.name = 'StorageLimitExceededError';
  }
}

/**
 * 🔴 アップロードしようとしたファイルが `UPLOAD_MAX_BYTES` を超えている（docs/05 §14.2 ④）。413。
 *
 * 🔴 `ValidationError`（400）と分ける理由: 入力の書式は正しく、**大きさだけ**が問題である。
 *    画面は「ファイルを分割する / 圧縮する」という別の行動へ導く必要がある。
 * 🔴 判定はサーバで行う（画面の `accept` 属性や JS の事前チェックは迂回できる）。署名に
 *    `Content-Length` を焼き込むため、申告より大きいものは S3 側でも通らない（二重防御）。
 */
export class UploadTooLargeError extends AppError {
  readonly code = 'UPLOAD_TOO_LARGE';
  readonly httpStatus = 413;
  readonly userMessageKey: MessageKey = 'error.upload.tooLarge';
  override readonly params: Readonly<Record<string, unknown>>;

  constructor(maxBytes: number) {
    super(`アップロードできる上限（${maxBytes} バイト）を超えています。`);
    this.name = 'UploadTooLargeError';
    // 🔴 上限値は秘匿ではない（画面に出す固定の設定値であり、テナントの利用状況を含まない）。
    this.params = { maxBytes };
  }
}

/** 🔴 境界外の ID も必ずこれ（403 と区別しない。docs/05 §4.8）。対象 ID を含めない。 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
  readonly userMessageKey: MessageKey = 'error.notFound';

  constructor() {
    super('対象が見つかりません。');
    this.name = 'NotFoundError';
  }
}

/**
 * 🔴 「見えない ＝ 存在しない」を**呼び出し側で書き分けさせない**ための唯一のヘルパ
 *    （docs/05 §4.8 / `F-004 AC-4`）。
 *
 * 境界の外の ID は `withTenant` の中で **RLS と Prisma 拡張が 0 件に落とす**ため、
 * ハンドラの手元には `null` として届く。そこで 403 を返すか 404 を返すかを各ハンドラが
 * 判断する構造にすると、いつか「存在はするが権限が無い」と答える実装が混ざる。
 * **`null` を受け取ったら必ず 404** に畳む経路をここに 1 本だけ用意する。
 */
export function requireFound<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new NotFoundError();
  return value;
}

export class InternalError extends AppError {
  readonly code = 'INTERNAL';
  readonly httpStatus = 500;
  readonly userMessageKey: MessageKey = 'error.internal';
  override readonly logLevel: ErrorLogLevel = 'error';

  constructor(message = '内部エラーが発生しました。') {
    super(message);
    this.name = 'InternalError';
  }
}

/**
 * 🔴 監査ログの書き込みに失敗した（docs/05 §15.1 / §15.5 / F-005 / F-012 AC-2）。
 *    **これを捕捉して操作を続行してはならない。** 呼び出し側はトランザクションを
 *    ロールバックし、対象操作を成立させない（T-03-05 が `withApiRoute` に組み込む）。
 */
export class AuditWriteFailedError extends AppError {
  readonly code = 'AUDIT_WRITE_FAILED';
  readonly httpStatus = 500;
  readonly userMessageKey: MessageKey = 'error.internal';
  override readonly logLevel: ErrorLogLevel = 'error';

  constructor(readonly action: string) {
    super(`監査ログの書き込みに失敗しました（action=${action}）。操作は成立させません。`);
    this.name = 'AuditWriteFailedError';
  }
}

/** 未知の例外は内部エラーへ写像する（原因を応答に載せない。docs/05 §15.2）。 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  // 🔴 packages/db 側の監査書き込み失敗は、専用の型として保つ（500 に潰して原因を失わない）。
  if (error instanceof AuditLogWriteError) return new AuditWriteFailedError(error.action);
  // 🔴 2FA 未充足は 403 として利用者に返す（500 に潰すと、設定すれば解決することが伝わらない）。
  if (error instanceof DbTwoFactorRequiredError) return new TwoFactorRequiredError(error.reason);
  // 🔴 T-03-10: `PLATFORM_OWNER` 専用操作を `PLATFORM_SUPPORT` が要求した ＝ **403**
  //    （docs/02 章 5.4 / `BR-44`）。404 に畳まない（運営者は対象テナントを一覧で見られる立場）。
  if (error instanceof PlatformRoleNotAllowedError) return new PlatformOwnerRequiredError();
  // 🔴 T-04-09: 直列化失敗（PostgreSQL の `40001`。Prisma の `P2034`）は **409**。
  //    500 に潰すと「やり直せば済むこと」が障害として記録され、監視が誤検知する。
  if (error instanceof TransactionSerializationError) return new ConcurrentUpdateError();
  // 🔴 ホスト専用の経路にパートナー文脈が入った ＝ **404**（403 と区別しない。docs/05 §4.8 /
  //    packages/db の `HostOnlyContextError` のコメント）。403 にすると「その機能は存在するが
  //    あなたには使えない」ことが伝わり、ホスト側の業務の存在を示唆する。
  if (error instanceof HostOnlyContextError) return new NotFoundError();
  // 🔴 遷移表に無い状態遷移は **422**（サイレントに無視しない。docs/05 §15.3 / `BR-33`）。
  if (error instanceof DomainInvalidStateTransitionError) {
    return new InvalidStateTransitionError(error.entity, error.from, error.to);
  }
  return new InternalError();
}

export function toApiErrorBody(error: AppError): ApiErrorBody {
  return {
    error: {
      code: error.code,
      messageKey: error.userMessageKey,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(error.params === undefined ? {} : { params: error.params }),
    },
  };
}

export function errorResponse(error: unknown): Response {
  const appError = toAppError(error);
  return Response.json(toApiErrorBody(appError), {
    status: appError.httpStatus,
    // 🔴 残り時間は標準ヘッダで返す（本文の形は §15.2 のまま変えない）。
    headers:
      appError instanceof TwoFactorThrottledError
        ? { 'retry-after': String(appError.retryAfterSeconds) }
        : {},
  });
}
