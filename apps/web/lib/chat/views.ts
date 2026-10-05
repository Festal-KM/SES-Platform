// apps/web/lib/chat/views.ts
// `S-031` チャット（越境経路 3）の**応答の形と、行への写し**（純粋関数）。
// `docs/04` §S-031 / `docs/05` §6.5 #50 / #51 / §4.4 C6 / `F-038` / `CLAUDE.md` §3.1 経路 3。
//
// ============================================================================
// 🔴 このファイルが守るもの
// ============================================================================
//   ① 🔴 **母集団を決めるのはこのファイルではない。** 見える／見えないは `thread_participants` の
//      行の有無（RLS の C6）だけが決める（`read.ts` の 🔴）。ここは「読めた行をどう写すか」だけを持つ。
//   ② 🔴 **他社の示唆を型に持たない。** スレッドの総件数・他社の件数・未読件数・他パートナーの社名を
//      表す項目が**存在しない**（`CLAUDE.md` §3.1 の 🔴「パートナー同士が相互に参照できる経路を
//      1 つも作らない」/ `F-038 AC-1`「他パートナーはスレッドの存在・件数・最終更新のいずれも
//      知り得ない」）。`CHAT_*_KEYS` がその集合を固定し、分離テストがキー集合を突き合わせる。
//   ③ 🔴 **ホストの商流（単価・エンド企業名・粗利）を 1 項目も持たない**（`BR-67`）。右の関連情報に
//      出すのは「対象（案件名）/ 相手 / 参加会社」だけである。
//   ④ 🔴 **未読を作らない。** `messages` に既読の列が無い（`packages/db/prisma/schema.prisma` の
//      `Message`）。実体の無い数を画面に出すと「見たのに消えない」を作る（サイドバーのバッジを
//      置かなかったのと同じ判断）。**列を足すのはモデルの変更であり本タスクの範囲外。**
//   ⑤ 🔴 **添付を持たない。** `CLAUDE.md` §3.4 が「ウイルススキャンが `CLEAN` になるまで共有 URL を
//      発行しない」と定めており、スキャンの配線（`file_scan_results` / `CHAT_ATTACHMENT` のゲート）
//      まで含めると別タスクになる。**口（`attachmentKey`）を型に持たせない** —— 持たせると
//      「スキャン前のキーを返す」経路が生まれる。
//
// 🔴 純粋関数のみ（`@ses/db` / `@ses/i18n` / 現在時刻に依存しない）。クライアントの島が
//    **型だけ**を読めるようにするためである（`tests/static/client-db-boundary.test.ts`）。

/** `chat_threads.kind`（CHECK の 2 値）。 */
export const CHAT_THREAD_KINDS = ['PROJECT', 'COMPANY'] as const;
export type ChatThreadKind = (typeof CHAT_THREAD_KINDS)[number];

/** 対象案件の参照（名前が読めなければ `null` を入れる。下の 🔴）。 */
export type ChatProjectRef = {
  readonly id: string;
  readonly name: string;
};

/**
 * スレッド一覧の 1 行（`docs/04` §S-031 セクション 1「対象（案件 / 企業）/ 相手会社 / 最終更新」）。
 *
 * 🔴 **`未読` の項目が無い**（上の ④）。
 * 🔴 **`partnerCompanyId` を載せない** —— 画面が必要とするのは表示名だけであり、ID を返すと
 *    「他社の ID を総当たりする」入力面を増やすことになる。
 */
export type ChatThreadListItem = {
  readonly id: string;
  readonly kind: ChatThreadKind;
  /**
   * 🔴 対象案件。**読めないときは `null`** である（取引先に公開されていない案件に紐づくスレッドでは
   *    `projects` の RLS（C4）が行を返さない）。`null` を「案件が無い」と書き分けないのが肝で、
   *    画面は `kind` で「案件 / 企業間」を言い、名前は読めたときだけ出す。
   */
  readonly project: ChatProjectRef | null;
  /**
   * 相手の会社名。ホストから見れば取引先の社名、取引先から見れば**ホスト企業（テナント）の商号**。
   * 🔴 どちらも「自分が当事者である関係の相手」であり、第三者の社名ではない。
   * 🔴 **読めないときは `null`**（既定値で埋めない。埋めると「誰との会話か分からない」ことが
   *    画面から消える）。画面は `t('chat.counterparty.unknown')` を出す。
   */
  readonly counterpartyName: string | null;
  /** 最終更新（ISO 8601）。メッセージが 1 件も無ければ `null`。 */
  readonly lastMessageAt: string | null;
};

/** 会話の 1 件（`docs/04` §S-031 セクション 2）。 */
export type ChatMessageView = {
  readonly id: string;
  readonly sentAt: string;
  /**
   * 送信者の表示名。🔴 **読めなければ `null`**（`users` の C8 DIRECTORY。退会・他パートナーの利用者）。
   * 既定値で埋めない —— 埋めると「誰が書いたか分からない」ことが画面から消える。
   */
  readonly senderName: string | null;
  /** 送信者の会社名（自社 / 相手のどちらか。スレッドには 2 社しか居ない。`F-038 AC-2`）。読めなければ `null`。 */
  readonly senderCompanyName: string | null;
  /** 🔴 自社の発言か。**寄せ・色の判定を画面に書かせない**ための値である。 */
  readonly own: boolean;
  /** 本文。🔴 `PURGED` / 保持期間削除で本文が消えた行は `null`（`F-064 AC-2`）。 */
  readonly body: string | null;
};

/** 参加会社の 1 行（`thread_participants`。越境経路 3 の唯一の根拠）。 */
export type ChatParticipantView = {
  /** 会社名。ホスト側の行はテナントの商号。読めなければ `null`。 */
  readonly companyName: string | null;
  /** ホスト（`partner_company_id IS NULL`）の行か。 */
  readonly isHost: boolean;
  readonly joinedAt: string;
  /** 退出済みなら ISO 8601。参加中は `null`。 */
  readonly leftAt: string | null;
};

/** 右の関連情報（`docs/04` §S-031 セクション 3）。 */
export type ChatThreadDetailView = {
  readonly id: string;
  readonly kind: ChatThreadKind;
  readonly project: ChatProjectRef | null;
  readonly counterpartyName: string | null;
  /**
   * 🔴 **`thread_participants` の RLS（C5 PARTY）が返した行だけ**を並べる。
   *    取引先の文脈ではホストの行（`partner_company_id IS NULL`）が見えないため 1 行になる。
   *    🔴 **見えない行を補わない**（補うと「アプリが越境の判断をしている」ことになる）。
   */
  readonly participants: readonly ChatParticipantView[];
};

// ---------------------------------------------------------------------------
// 🔴 キー集合（分離テストが応答と突き合わせる。型だけでは実行時の形を固定できない）
// ---------------------------------------------------------------------------

export const CHAT_THREAD_LIST_ITEM_KEYS = ['id', 'kind', 'project', 'counterpartyName', 'lastMessageAt'] as const;

export const CHAT_MESSAGE_VIEW_KEYS = ['id', 'sentAt', 'senderName', 'senderCompanyName', 'own', 'body'] as const;

export const CHAT_PARTICIPANT_VIEW_KEYS = ['companyName', 'isHost', 'joinedAt', 'leftAt'] as const;

export const CHAT_THREAD_DETAIL_VIEW_KEYS = ['id', 'kind', 'project', 'counterpartyName', 'participants'] as const;

/**
 * 🔴 **チャットの応答に 1 度も現れてはならないキー**（分離テストが応答 JSON を深さ優先で走査する）。
 *    商流（`BR-67`）/ 未読（実体が無い）/ 添付（スキャン未配線）/ 他社の ID を表す語を列挙する。
 */
export const CHAT_FORBIDDEN_RESPONSE_KEYS = [
  'unitPrice',
  'offeredUnitPrice',
  'endClientName',
  'margin',
  'unread',
  'unreadCount',
  'readAt',
  'attachmentKey',
  'attachmentScanStatus',
  'reviewGateId',
  'partnerCompanyId',
  'ownerPartnerCompanyId',
  'senderPartnerCompanyId',
  'senderUserId',
  'total',
] as const;

// ---------------------------------------------------------------------------
// 写し（純粋関数）
// ---------------------------------------------------------------------------

/** `chat_threads` の 1 行のうち、写しに使う列（`read.ts` の `select` と対）。 */
export type ChatThreadRow = {
  readonly id: string;
  readonly kind: string;
  readonly projectId: string | null;
  readonly lastMessageAt: Date | null;
};

/** 行の外から渡す参照（案件名・相手の社名）。 */
export type ChatThreadDeps = {
  readonly project: ChatProjectRef | null;
  readonly counterpartyName: string | null;
};

/** 🔴 `kind` の CHECK を信じず、未知の値は握り潰さず落とす（`toCountByState` と同じ作法）。 */
export function asChatThreadKind(value: string): ChatThreadKind {
  if (!(CHAT_THREAD_KINDS as readonly string[]).includes(value)) {
    throw new RangeError(`chat_threads.kind が未知の値です（${value}）。`);
  }
  return value as ChatThreadKind;
}

export function chatThreadListItem(row: ChatThreadRow, deps: ChatThreadDeps): ChatThreadListItem {
  return {
    id: row.id,
    kind: asChatThreadKind(row.kind),
    project: deps.project,
    counterpartyName: deps.counterpartyName,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
  };
}

export function chatThreadDetailView(
  row: ChatThreadRow,
  deps: ChatThreadDeps & { readonly participants: readonly ChatParticipantView[] },
): ChatThreadDetailView {
  return {
    id: row.id,
    kind: asChatThreadKind(row.kind),
    project: deps.project,
    counterpartyName: deps.counterpartyName,
    participants: deps.participants,
  };
}

/** `messages` の 1 行のうち、写しに使う列（`read.ts` の `select` と対）。 */
export type ChatMessageRow = {
  readonly id: string;
  readonly senderUserId: string;
  readonly senderPartnerCompanyId: string | null;
  readonly body: string | null;
  readonly sentAt: Date;
};

export type ChatMessageDeps = {
  /** 送信者の表示名（読めなければ `null`）。 */
  readonly senderName: string | null;
  /** 送信者の会社名（読めなければ `null`）。 */
  readonly senderCompanyName: string | null;
  /**
   * 🔴 読み手の所属（`ctx.partnerCompanyId`。ホストは `null`）。
   *    **リクエスト入力から渡してはならない**（`CLAUDE.md` §3.1）。
   */
  readonly viewerPartnerCompanyId: string | null;
};

export function chatMessageView(row: ChatMessageRow, deps: ChatMessageDeps): ChatMessageView {
  return {
    id: row.id,
    sentAt: row.sentAt.toISOString(),
    senderName: deps.senderName,
    senderCompanyName: deps.senderCompanyName,
    // 🔴 「自社か」は会社で決める（スレッドには 2 社しか居ない。`F-038 AC-2`）。利用者単位にすると
    //    同僚の発言が「相手の発言」として寄せられる。
    own: row.senderPartnerCompanyId === deps.viewerPartnerCompanyId,
    body: row.body,
  };
}
