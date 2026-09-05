// packages/connectors/src/types.ts
// docs/05 §8.1 の共通インタフェースが受け渡す値型を 1 箇所に置く（T-04-01）。
//
// 🔴 ここに置く型の原則（CLAUDE.md §3.4「外部 API 応答を生のまま保存せず、正規化した内部型に
//    変換してから永続化する」）:
//    - サービス固有の語（docusign / envelope / ses / cloudsign / stripe）を型名にも値にも出さない。
//      サービス差異は `packages/connectors/src/{email,scanner,esign,billing}/**` の実装に閉じ込め、
//      ここから外へは正規化済みの内部型だけが出る。
//    - 生 JSON をそのまま表す型を作らない（実装側で Zod parse → この型へ変換する）。
//
// 🔴 依存の制約（CLAUDE.md §2.1）: `packages/connectors` は `@ses/db` / `@ses/ai` に依存できない。
//    そのため、db と connectors の**両方**が知る必要のある型は `packages/domain` に置く
//    （db も connectors も domain には依存してよく、共有点は domain しか無いため）。
//    ✅ T-04-02: `@ses/domain` への workspace 依存を追加し、**`RecipientClass` は
//       `packages/domain/src/recipient/classify.ts` に一本化した**（本ファイルは re-export のみ）。
//    ⚠️ 残りの申し送り（T-09-01）: 3 種の送信トークン型（`SendAttemptToken` / `DispatchToken` /
//       `MeterSubmissionToken`）と `SEND_ENTITY_TYPES` は、`packages/db` が発行する値であり
//       移設先の判断が SP-09（送信の予約）の設計に依存するため、本ファイルに残している。
//       二重定義は `tests/static/connector-selection-mirror.test.ts` が突合する
//       （`SEND_ENTITY_TYPES` ↔ `SEND_ATTEMPT_ENTITY_TYPES` /
//       `SendAttemptToken` のプロパティ名 ↔ docs/05 §10.2）。

/**
 * 起動時 DI（docs/05 §13.1）が選ぶ実装種別。
 *
 * 🔴 `packages/config` の `ConnectorImplementationKind` と**同じ値集合**でなければならない。
 *    上記の依存制約のため import できないので構造的に一致させ、
 *    `tests/static/connector-selection-mirror.test.ts` が両者のリテラル集合を突合する。
 */
export const CONNECTOR_IMPLEMENTATION_KINDS = ['real', 'mock', 'sandboxRecipientScoped'] as const;

export type ConnectorImplementationKind = (typeof CONNECTOR_IMPLEMENTATION_KINDS)[number];

/**
 * `createConnectors` が受け取る選択結果（`packages/config` の `ConnectorSelection` と構造的に一致）。
 *
 * 🔴 `ai` を含まない。AI クライアントは `packages/ai` が `selection.ai` から組み立てる
 *    （`packages/connectors` から `@anthropic-ai/sdk` を import することは CLAUDE.md §3.2 で
 *    禁止されており、`packages/ai` を import することも §2.1 で禁止されている = ここでは作れない）。
 *    `ConnectorSelection` 側は `ai` を持ったままでよい（余剰プロパティは構造的部分型として通る）。
 */
export type ConnectorSelectionInput = {
  readonly email: ConnectorImplementationKind;
  readonly objectStore: ConnectorImplementationKind;
  readonly malwareScanner: ConnectorImplementationKind;
  readonly esign: ConnectorImplementationKind;
  readonly billing: ConnectorImplementationKind;
};

/** `createConnectors` が扱うコネクタ区分（`ConnectorSelectionInput` のキー）。 */
export const CONNECTOR_CATEGORIES = ['email', 'objectStore', 'malwareScanner', 'esign', 'billing'] as const;

export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

// --- メール（docs/05 §8.2）-------------------------------------------------

/**
 * 宛先分類（docs/05 §8.2 / `docs/02` 章 7.6 / CLAUDE.md §11.1）。
 *
 * 🔴 **宣言の唯一の出所は `packages/domain`** である（T-04-02）。ここは re-export であり、
 *    `@ses/connectors` の利用者が `RecipientClass` を追加の import 無しに扱えるようにするためだけに置く。
 * 🔴 判定は `packages/db` の `resolveRecipientClass` が `Membership` / `Invitation` から
 *    機械的に導く。**呼び出し側に自己申告させない。** 既定値を持たせない（省略はコンパイルエラー）。
 */
export {
  ACCOUNT_MAIL_RECIPIENT_CLASSES,
  EXTERNAL_RECIPIENT_CLASSES,
  HOST_OR_PLATFORM_RECIPIENT_CLASSES,
  isAccountMailRecipientClass,
  isExternalRecipientClass,
  isHostOrPlatformRecipientClass,
  OUTSIDER_RECIPIENT_CLASSES,
  RECIPIENT_CLASSES,
} from '@ses/domain';
export type {
  AccountMailRecipientClass,
  ExternalRecipientClass,
  HostOrPlatformRecipientClass,
  OutsiderRecipientClass,
  RecipientClass,
} from '@ses/domain';

/**
 * 検証済みの送信元ドメイン（docs/05 §8.3）。
 *
 * 🔴 **未検証の状態を表現できない型にする。** `verifiedAt` が必須であり、
 *    「未検証」は `VerifiedSendingDomain | null` の `null` 側でのみ表す。
 *    これにより「未検証なのに送信元として渡す」経路が型で消える。
 */
export type VerifiedSendingDomain = {
  /** 例: `example.co.jp`（テナントの独自ドメイン）。 */
  readonly domain: string;
  /** Custom MAIL FROM。例: `mail.example.co.jp`。 */
  readonly mailFromDomain: string;
  readonly verifiedAt: Date;
};

/**
 * 送信基盤（アカウント）全体の 24 時間ローリング枠（docs/05 §8.1 / §8.3-Q）。
 *
 * 🔴 テナント単位の日次上限（`F-027` の 500 通 / 日）とは**別の枠**である。混同しない。
 * 🔴 取得に失敗したときは throw する（0 を返さない）。呼び出し側は `null` として扱い、
 *    手元のカウンタだけで `decideProviderQuota` を続ける（止めない側に倒さない）。
 */
export type ProviderQuota = {
  readonly max24h: number;
  readonly sentLast24h: number;
  readonly observedAt: Date;
};

// --- オブジェクトストレージ / スキャン（docs/05 §8.1 / §14）------------------

export type PresignedUrl = {
  readonly url: string;
  readonly expiresAt: Date;
  /** PUT のときにクライアントが付ける必要のあるヘッダ（Content-Type 等）。 */
  readonly headers: Readonly<Record<string, string>>;
};

/**
 * 正規化済みのスキャン結果（docs/05 §8.1）。
 *
 * 🔴 プロバイダの生ステータスを `CLEAN` に寄せない（`docs/03` §3.4.3-3）:
 *    `UNSUPPORTED` → `UNSCANNABLE`、`ACCESS_DENIED` / `FAILED` → `FAILED`。
 */
export const SCAN_STATUSES = ['SCANNING', 'CLEAN', 'INFECTED', 'UNSCANNABLE', 'FAILED'] as const;

export type ScanStatus = (typeof SCAN_STATUSES)[number];

// --- 電子署名（docs/05 §8.1 / §8.4）----------------------------------------

/** 🔴 `mock` は非本番専用（`production` では `assertNoMockInProduction` が起動を止める）。 */
export const ESIGN_PROVIDER_KEYS = ['docusign', 'cloudsign', 'mock'] as const;

export type EsignProviderKey = (typeof ESIGN_PROVIDER_KEYS)[number];

/**
 * 復号済みの接続資格情報。
 *
 * 🔴 **ログ・エラー・監査ログ・LLM プロンプトに絶対に出さない**（CLAUDE.md §3.4）。
 *    保存時は `credentialEncrypted`（AES-256-GCM。docs/05 §8.6）であり、この平文の型は
 *    コネクタ実装の引数としてだけ生きる。`console.log` / `JSON.stringify` に渡さない。
 */
export type EsignConnectionSecret = {
  readonly refreshToken: string;
  readonly externalAccountId: string;
  /** 🔴 呼び出し先は接続時に保存した値（アカウントごとに異なる。docs/05 §8.4）。 */
  readonly baseUri: string;
};

/** 🔴 署名者は配列（署名順つき）。「送信先 1 名」を前提にしない（`docs/03` §3.1.10）。 */
export type EsignSigner = {
  readonly role: 'HOST' | 'COUNTERPARTY';
  readonly name: string;
  readonly email: string;
  /** `HOST_FIRST` = 1 / 2、`PARALLEL` = 1 / 1。 */
  readonly routingOrder: number;
};

export type EsignSendInput = {
  readonly connection: EsignConnectionSecret;
  readonly subject: string;
  readonly documentName: string;
  readonly documentBytes: Uint8Array;
};

/** 🔴 氏名・メールを持たない（正規化の規約。docs/05 §8.1）。 */
export type NormalizedSigner = {
  readonly role: 'HOST' | 'COUNTERPARTY';
  readonly routingOrder: number;
  readonly status: 'PENDING' | 'SIGNED' | 'DECLINED';
  readonly signedAt: Date | null;
};

/**
 * 正規化済みの署名状態（docs/05 §8.1）。
 *
 * 🔴 `Contract` の状態を増やさない: 一部未署名（`PENDING`）は `UNDER_REVIEW` のまま、
 *    全署名者完了（`SIGNED`）で `EXECUTED`。
 */
export type NormalizedEsignStatus =
  | { readonly kind: 'PENDING'; readonly signers: readonly NormalizedSigner[] }
  | { readonly kind: 'SIGNED'; readonly signedAt: Date; readonly signers: readonly NormalizedSigner[] }
  | { readonly kind: 'DECLINED'; readonly at: Date }
  | { readonly kind: 'WITHDRAWN'; readonly at: Date }
  | { readonly kind: 'UNKNOWN' };

// --- 課金（docs/05 §8.1 / §5.10 / §9.8）------------------------------------

export type Period = { readonly startsAt: Date; readonly endsAt: Date };

/**
 * 金額は 10 進の文字列で受け渡す。
 *
 * 🔴 `number`（IEEE754）で持たない。`Prisma.Decimal` を使わないのは、`packages/connectors` が
 *    `@prisma/client` に依存できない（CLAUDE.md §2.1 / §3.1）ためである。DB 型への変換は
 *    呼び出し側（`apps/*` → `packages/db`）が行う。
 */
export type DecimalString = string;

export type MeterEventInput = {
  readonly customerId: string;
  /** Stripe の Meter Event 名（超過の単位ごと。docs/05 §5.10）。 */
  readonly eventName: string;
  /** 超過**件数**（金額ではない。`BR-24` / CLAUDE.md §2 課金）。 */
  readonly value: number;
};

// --- 送信の予約トークン（docs/05 §10.1 / §10.2）-----------------------------

/**
 * `SendAttempt` の対象エンティティ（docs/05 §10.1 / §3.9）。
 *
 * 🔴 **`packages/db` の `SEND_ATTEMPT_ENTITY_TYPES` と、マイグレーションの CHECK 制約と、
 *    同じ値集合でなければならない**（`idempotencyKey()` がこの値から冪等キーを組み立て、
 *    その行が `send_attempts` の CHECK を通る必要がある）。
 *    ジョブ名は `send.interview-invite` だが、エンティティ種別は `'INTERVIEW'` である。混同しない。
 *    `tests/static/connector-selection-mirror.test.ts` が両者を突合する。
 */
export const SEND_ENTITY_TYPES = ['PROPOSAL', 'INTERVIEW', 'CONTRACT'] as const;

export type SendEntityType = (typeof SEND_ENTITY_TYPES)[number];

declare const SendAttemptTokenBrand: unique symbol;

/**
 * 🔴 **外部から構築できない**（docs/05 §10.2）。CAS 成功 + `SendAttempt` の INSERT 成功のときだけ
 *    `packages/db` の `reserveSendAttempt` が返す。`EmailSender.send` / `EsignProvider.createAndSend`
 *    が必須引数に取るため、**予約を経ない外部送信はコンパイルできない**。
 */
export type SendAttemptToken = {
  readonly idempotencyKey: string;
  readonly attemptSeq: number;
  readonly entityType: SendEntityType;
  readonly entityId: string;
  readonly [SendAttemptTokenBrand]: true;
};

declare const DispatchTokenBrand: unique symbol;

/**
 * 🔴 運用メール（`email.dispatch` / `account.mail`）用のトークン。`EmailDispatch` 行の作成に
 *    成功したときだけ `packages/db` が返す。`dedupeKey` の `UNIQUE` が「再試行しても 1 通」を担保する。
 */
export type DispatchToken = {
  readonly dispatchId: string;
  readonly dedupeKey: string;
  readonly [DispatchTokenBrand]: true;
};

declare const MeterSubmissionTokenBrand: unique symbol;

/** 🔴 `BillingMeterSubmission` に INSERT できた実行だけが Stripe を呼ぶ（docs/05 §9.8）。 */
export type MeterSubmissionToken = {
  readonly submissionId: string;
  readonly identifier: string;
  readonly [MeterSubmissionTokenBrand]: true;
};
