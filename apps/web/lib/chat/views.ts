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
//   ⑤ 🔴 **添付のキーを持たない。** ✅ 2026-10-27（`F-038` 改訂 12 ⑫）: 社内だけの部屋の添付は
//      `attachment`（種類・大きさ・検査の状態だけ）で表す。**オブジェクトキー・ファイル名・共有 URL を型に持たせない**
//      —— 共有 URL は押すたびに #51q（`issueDownloadUrl`）が出す。🔴 `CLEAN` でない添付の発言は送った本人にしか
//      届かない（RLS の RESTRICTIVE ポリシー + `isChatMessageVisibleToViewer`）。
//
// 🔴 純粋関数のみ（`@ses/db` / `@ses/i18n` / 現在時刻に依存しない）。クライアントの島が
//    **型だけ**を読めるようにするためである（`tests/static/client-db-boundary.test.ts`）。
import { chatAttachmentKindOf, type ChatAttachmentKind, type ScanStatus } from '@ses/domain';
import { chatOwnText } from './quote';
import { messageSnippet } from './thread-tree';

/** `chat_threads.kind`（CHECK の 4 値。DM / GROUP は 2026-10-16・#128）。 */
export const CHAT_THREAD_KINDS = ['PROJECT', 'COMPANY', 'DM', 'GROUP'] as const;
export type ChatThreadKind = (typeof CHAT_THREAD_KINDS)[number];
/**
 * 今の一覧・会話の画面が扱う部屋の種類（会社グループ・スレッド）。
 * ✅ 2026-10-16（#128）: DM / GROUP は DB に足したが、画面は次の段で作る。それまで一覧・会話の読み出しは
 *    この 2 種類に絞る（DM / GROUP は取引先を持たないことがあり、会社ごとの木に載せられないため）。
 */
export const COMPANY_ROOM_KINDS = ['PROJECT', 'COMPANY'] as const satisfies readonly ChatThreadKind[];

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
  /**
   * ✅ 2026-10-22（紺野「自分が入ってるチャットにも共通で表示しないと」）: 送信者の**今の**ひとこと状態。
   * 🔴 読めるかは RLS（`chat_user_statuses` の読み = users の C8 DIRECTORY）が決める。読めない・無ければ `null`。
   * 送った時点の状態ではない（発言に凍結しない）—— 「いま連絡してよいか」の判断材料だから。
   */
  readonly senderStatus?: string | null;
  /** 🔴 自社の発言か。**寄せ・色の判定を画面に書かせない**ための値である。 */
  readonly own: boolean;
  /**
   * 🔴 読み手本人の発言か（2026-10-14、チャットレーン）。会話型の並べ方で**自分だけを右に寄せる**ための値
   * （同僚の発言は `own` でも左に置く）。`mine` なら必ず `own` である。
   */
  readonly mine: boolean;
  /**
   * ✅ 2026-10-16: リアクション（種類ごとの件数と「自分が付けたか」）。🔴 **誰が付けたか（利用者 ID）は載せない**。
   * 付いていなければ空配列（読みの経路は必ず埋める。省略可なのは手で組むテスト用の値のため）。
   */
  readonly reactions?: readonly ChatReactionSummary[];
  /** ✅ 2026-10-16: 送った本人が編集したか（「編集済み」の印）。 */
  readonly edited?: boolean;
  /** ✅ 2026-10-16: 送った本人が削除したか（本文は `null`。保持期限による削除〔`purged`〕とは書き分ける）。 */
  readonly deleted?: boolean;
  /**
   * ✅ 2026-10-22: 読み手本人がこの発言を保存しているか（`chat_saved_messages`）。🔴 本人の栞だけ（誰が保存したかは載せない）。
   * 読みの経路は必ず埋める。省略可なのは手で組むテスト用の値のため。
   */
  readonly saved?: boolean;
  /** 本文。🔴 `PURGED` / 保持期間削除で本文が消えた行は `null`（`F-064 AC-2`）。案件カードだけの発言は空文字。 */
  readonly body: string | null;
  /**
   * ✅ 2026-10-23（紺野）: 発言に貼った案件（案件カード）。貼っていない・発言が消えた（削除・保持期限）なら `null`。
   * 🔴 **読む人の RLS で読み直した結果**である。読めなければ `{ visible: false }` だけ（案件名も ID も載せない）。
   * 読みの経路は必ず埋める。省略可なのは手で組むテスト用の値のため。
   */
  readonly attachedProject?: ChatAttachedProjectView | null;
  /**
   * ✅ 2026-10-27（`F-038` 改訂 12 ⑫）: 添えたファイル（社内だけの部屋）。無い・発言が消えた（削除・保持期限）なら `null`。
   * 🔴 種類・大きさ・検査の状態だけ（キー・ファイル名・URL を載せない）。`CLEAN` でないものは送った本人にしか届かない。
   * 読みの経路は必ず埋める。省略可なのは手で組むテスト用の値のため。
   */
  readonly attachment?: ChatAttachmentView | null;
};

/** ✅ 2026-10-27: 添えたファイル（`ChatMessageView.attachment`）。 */
export type ChatAttachmentView = {
  /** 出し方の分類（画像は縮めて出す / PDF は埋め込み / そのほかは札）。 */
  readonly kind: ChatAttachmentKind;
  readonly contentType: string;
  readonly byteSize: number;
  /** ウイルス検査の状態。🔴 `CLEAN` 以外が届くのは送った本人だけ。 */
  readonly scanStatus: ScanStatus;
};

export const CHAT_ATTACHMENT_VIEW_KEYS = ['kind', 'contentType', 'byteSize', 'scanStatus'] as const;

/**
 * ✅ 2026-10-27（`docs/05` §6.5 #51r）: 部屋の「ファイル」の一覧の 1 行（`CLEAN` のものだけ・新しい順）。
 * 🔴 キー・ファイル名・URL・送った人の利用者 ID を載せない。件数は返さない。
 */
export type ChatAttachmentListItem = {
  readonly messageId: string;
  readonly kind: ChatAttachmentKind;
  readonly contentType: string;
  readonly byteSize: number;
  /** 送った人の表示名（`users` の C8 で読めなければ `null`）。 */
  readonly senderName: string | null;
  readonly sentAt: string;
};

export const CHAT_ATTACHMENT_LIST_ITEM_KEYS = ['messageId', 'kind', 'contentType', 'byteSize', 'senderName', 'sentAt'] as const;

/**
 * ✅ 2026-10-26（紺野の決定 2026-10-22）: 部屋のアナウンス（LINE のアナウンス。1 部屋 1 件。`chat_thread_announcements`）。
 * 🔴 **読めるかは RLS が決める**（その部屋が読める人だけ。`lib/chat/announcement.ts` ①）。
 * 🔴 **設定した人の利用者 ID を載せない**（名前だけ。`senderUserId` と同じ）。
 */
export type ChatAnnouncementView = {
  /** 固定した発言（この部屋の発言。読み込み済みならその位置へ移る）。 */
  readonly messageId: string;
  /** 固定した発言の日時（ISO。読み込んでいないときに「いつの発言か」を示す）。 */
  readonly messageSentAt: string;
  /** 発言の冒頭。🔴 送った本人が消した・保持期限で本文が消えた発言は `null`（本文を出さない）。 */
  readonly snippet: string | null;
  /** 設定した人の表示名（`users` の C8。読めなければ `null`）。 */
  readonly setByName: string | null;
  /** 設定した日時（ISO）。 */
  readonly setAt: string;
};

export const CHAT_ANNOUNCEMENT_VIEW_KEYS = ['messageId', 'messageSentAt', 'snippet', 'setByName', 'setAt'] as const;

/** アナウンスの帯に出す本文の冒頭の長さ（文字数。1〜2 行に収まる程度）。 */
export const CHAT_ANNOUNCEMENT_SNIPPET_LENGTH = 60;

/** アナウンスの帯に出す本文の冒頭（改行・連続した空白は 1 つの空白にする）。🔴 本文が無ければ `null`。 */
export function chatAnnouncementSnippet(body: string | null): string | null {
  if (body === null) return null;
  return messageSnippet(chatOwnText(body), '', CHAT_ANNOUNCEMENT_SNIPPET_LENGTH);
}

/** `chat_thread_announcements` の行と、固定した発言の行（RLS 越しに読めたもの）を写す。 */
export function chatAnnouncementView(
  row: { readonly messageId: string; readonly setAt: Date },
  deps: {
    readonly message: { readonly sentAt: Date; readonly body: string | null; readonly deletedAt: Date | null; readonly purgedAt: Date | null };
    readonly setByName: string | null;
  },
): ChatAnnouncementView {
  const removed = deps.message.deletedAt !== null || deps.message.purgedAt !== null;
  return {
    messageId: row.messageId,
    messageSentAt: deps.message.sentAt.toISOString(),
    snippet: removed ? null : chatAnnouncementSnippet(deps.message.body),
    setByName: deps.setByName,
    setAt: row.setAt.toISOString(),
  };
}

/**
 * ✅ 2026-10-23: 案件カードの要件 1 件（`project_requirements`。読む人の RLS で読めたものだけ）。
 * 🔴 単価・エンド企業名を持たない（相手が誰でも出さない）。
 */
export type ChatProjectRequirementView = {
  /** 辞書名（`skillId` が無ければ `null`）。 */
  readonly skillName: string | null;
  readonly freeText: string | null;
  readonly requiredYears: number | null;
};

/**
 * ✅ 2026-10-23: 案件カード（見る人が読めたとき）。
 * 🔴 **単価（`unitPriceMin` / `unitPriceMax` / `internalUnitPrice`）・エンド企業名・公開先を持たない。**
 *    出すのは 案件名・状態・開始時期・勤務地 / リモート・必須の要件・尚可の要件（画面は件数に畳む）だけ。
 */
export type ChatVisibleProjectCard = {
  readonly visible: true;
  readonly id: string;
  readonly name: string;
  /** `projects.status`（`OPEN` / `CLOSED`）。🔴 語は画面が文言の束から引く（ここは値だけ）。 */
  readonly status: string;
  /** `YYYY-MM-DD` または `null`。 */
  readonly startDate: string | null;
  /** 都道府県のコード または `null`。 */
  readonly prefecture: string | null;
  /** `RemoteMode` または `null`。 */
  readonly remoteMode: string | null;
  readonly mustRequirements: readonly ChatProjectRequirementView[];
  readonly niceRequirements: readonly ChatProjectRequirementView[];
};

/** ✅ 2026-10-23: 案件カード（見る人が読めないとき）。🔴 `visible: false` 以外のキーを持たない（名前も ID も出さない）。 */
export type ChatHiddenProjectCard = { readonly visible: false };

export type ChatAttachedProjectView = ChatVisibleProjectCard | ChatHiddenProjectCard;

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
  /**
   * ✅ 2026-10-19（#128）: DM・グループのメンバー（人の段）。会社グループ・スレッドでは無い。
   * 🔴 RLS（C10 MEMBER）で見えている部屋のメンバーだけ。名前は C8 で読めた人だけ（読めなければ `null`）。
   */
  readonly members?: readonly ChatMemberView[];
};

/** ✅ 2026-10-19（#128）: DM・グループのメンバー 1 人。 */
export type ChatMemberView = {
  /** 🔴 DM を開く導線（`POST /api/threads/dm`）のための ID。同じ部屋のメンバーにしか返さない。 */
  readonly userId: string;
  readonly name: string | null;
  readonly companyName: string | null;
  readonly isHost: boolean;
  /** 読み手本人か（自分には「DM を開く」を出さない）。 */
  readonly self: boolean;
  /** ✅ 2026-10-19: ひとこと状態（読めた人の、空でないものだけ）。無ければ `null` / 省略。 */
  readonly status?: string | null;
};

/** ✅ 2026-10-19（#128）: 一覧の「DM・グループ」の 1 行。 */
export type ChatRoomListItem = {
  readonly id: string;
  readonly kind: 'DM' | 'GROUP';
  /** DM は相手の名前、グループはその名前。読めなければ `null`。 */
  readonly name: string | null;
  readonly memberCount: number;
  readonly lastMessageAt: string | null;
  /** ✅ 2026-10-19（v2）: メンバー（「人から」辿る）。🔴 自分が入っている部屋のメンバーだけ（C10）。 */
  readonly memberUserIds: readonly string[];
  /** 取引先との部屋か（「外部」の札）。 */
  readonly external: boolean;
  /** その取引先の会社のまとまりの鍵（「会社から」辿る）。社内の部屋・まとまりが無いときは `null`。 */
  readonly companyKey: string | null;
};

// ---------------------------------------------------------------------------
// 🔴 キー集合（分離テストが応答と突き合わせる。型だけでは実行時の形を固定できない）
// ---------------------------------------------------------------------------

export const CHAT_THREAD_LIST_ITEM_KEYS = ['id', 'kind', 'project', 'counterpartyName', 'lastMessageAt'] as const;

export const CHAT_MESSAGE_VIEW_KEYS = [
  'id',
  'sentAt',
  'senderName',
  'senderCompanyName',
  'senderStatus',
  'own',
  'mine',
  'body',
  'reactions',
  'edited',
  'deleted',
  'saved',
  'attachedProject',
  // ✅ 2026-10-27: 添えたファイル（種類・大きさ・検査の状態だけ）。
  'attachment',
] as const;

/** ✅ 2026-10-23: 案件カード（読めたとき）のキー集合。🔴 分離テストが応答と突き合わせる。 */
export const CHAT_VISIBLE_PROJECT_CARD_KEYS = [
  'visible',
  'id',
  'name',
  'status',
  'startDate',
  'prefecture',
  'remoteMode',
  'mustRequirements',
  'niceRequirements',
] as const;

/** ✅ 2026-10-23: 案件カード（読めないとき）のキー集合。🔴 これ以外を 1 つも持たない。 */
export const CHAT_HIDDEN_PROJECT_CARD_KEYS = ['visible'] as const;

/** ✅ 2026-10-23: 案件カードの要件 1 件のキー集合。 */
export const CHAT_PROJECT_REQUIREMENT_KEYS = ['skillName', 'freeText', 'requiredYears'] as const;

/**
 * ✅ 2026-10-16: リアクションの種類（業務の短い語 4 つ）。
 * ✅ 2026-10-22（紺野「スタンプとかもちゃんと入れて」）: 絵文字 12 種を足した（UI_GUIDELINES §1 の例外。チャットのリアクションだけ）。
 * 🔴 DB の CHECK（migration 20261022030000）と同じ並び。値は英字の名前で、絵文字への置き換えは `reactions.ts`。
 * 🔴 並びは「絵文字 → 語」の表示順でもある（件数のまとめもこの順）。
 */
export const CHAT_REACTION_EMOJI_KINDS = ['THUMBS_UP', 'PRAY', 'TADA', 'SMILE', 'JOY', 'EYES', 'BOW', 'SWEAT', 'CHECK', 'HEART', 'FIRE', 'CLAP'] as const;
export const CHAT_REACTION_WORD_KINDS = ['OK', 'THANKS', 'CHECKING', 'DONE'] as const;
export const CHAT_REACTIONS = [...CHAT_REACTION_EMOJI_KINDS, ...CHAT_REACTION_WORD_KINDS] as const;
export type ChatReactionKind = (typeof CHAT_REACTIONS)[number];

/** リアクション 1 種類ぶん。 */
export type ChatReactionSummary = {
  readonly reaction: ChatReactionKind;
  readonly count: number;
  /** 読み手が付けたか。 */
  readonly mine: boolean;
};

/**
 * リアクションの行を、発言ごと・種類ごとの件数にまとめる（種類の並びは `CHAT_REACTIONS` の順）。
 * 🔴 利用者 ID は「自分が付けたか」の判定にだけ使い、出力に載せない。
 */
export function summarizeReactions(
  rows: readonly { readonly messageId: string; readonly userId: string; readonly reaction: string }[],
  viewerUserId: string,
): ReadonlyMap<string, readonly ChatReactionSummary[]> {
  const byMessage = new Map<string, Map<ChatReactionKind, { count: number; mine: boolean }>>();
  for (const row of rows) {
    if (!(CHAT_REACTIONS as readonly string[]).includes(row.reaction)) continue;
    const kind = row.reaction as ChatReactionKind;
    const kinds = byMessage.get(row.messageId) ?? new Map<ChatReactionKind, { count: number; mine: boolean }>();
    const entry = kinds.get(kind) ?? { count: 0, mine: false };
    entry.count += 1;
    if (row.userId === viewerUserId) entry.mine = true;
    kinds.set(kind, entry);
    byMessage.set(row.messageId, kinds);
  }
  return new Map(
    [...byMessage.entries()].map(([messageId, kinds]) => [
      messageId,
      CHAT_REACTIONS.filter((kind) => kinds.has(kind)).map((kind) => ({ reaction: kind, ...(kinds.get(kind) as { count: number; mine: boolean }) })),
    ]),
  );
}

export const CHAT_PARTICIPANT_VIEW_KEYS = ['companyName', 'isHost', 'joinedAt', 'leftAt'] as const;

export const CHAT_THREAD_DETAIL_VIEW_KEYS = ['id', 'kind', 'project', 'counterpartyName', 'participants'] as const;
/** ✅ 2026-10-19（#128）: DM・グループの詳細は、会社の部屋の詳細に `members` を足したもの。 */
export const CHAT_ROOM_DETAIL_VIEW_KEYS = [...CHAT_THREAD_DETAIL_VIEW_KEYS, 'members'] as const;

/**
 * 🔴 **チャットの応答に 1 度も現れてはならないキー**（分離テストが応答 JSON を深さ優先で走査する）。
 *    商流（`BR-67`）/ 未読（実体が無い）/ 添付（スキャン未配線）/ 他社の ID を表す語を列挙する。
 */
export const CHAT_FORBIDDEN_RESPONSE_KEYS = [
  'unitPrice',
  'offeredUnitPrice',
  'endClientName',
  // ✅ 2026-10-23: 案件カードに単価を出さない（外部公開用のレンジも、内部限定の販売単価も）。
  'unitPriceMin',
  'unitPriceMax',
  'internalUnitPrice',
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
  // ✅ 2026-10-26: アナウンスを設定した人の利用者 ID（名前だけを返す）。
  'setByUserId',
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
  /** ✅ 2026-10-16: 編集・削除の日時（読みの経路は必ず埋める。手で組むテスト用に省略可）。 */
  readonly editedAt?: Date | null;
  readonly deletedAt?: Date | null;
  /** ✅ 2026-10-26: 解約で本文を消した日時（読みの経路は必ず埋める。手で組むテスト用に省略可）。 */
  readonly purgedAt?: Date | null;
  /** ✅ 2026-10-23: 貼った案件の ID（読みの経路は必ず埋める）。🔴 応答には載せない（カードの可否は `deps` が決める）。 */
  readonly attachedProjectId?: string | null;
  /** ✅ 2026-10-27: 添えたファイルの種類・大きさ・検査の状態（読みの経路は必ず埋める）。🔴 キーは読まない。 */
  readonly attachmentContentType?: string | null;
  readonly attachmentByteSize?: bigint | number | null;
  readonly attachmentScanStatus?: string | null;
};

/**
 * ✅ 2026-10-29（F-038 ⑰ / #51s）: この会話の中の検索の 1 件。🔴 件数・本文の全文・添付・会社・ほかの識別子を持たない。
 */
export type ChatMessageSearchHitView = {
  readonly messageId: string;
  readonly sentAt: string;
  /** 送った人の表示名（読めなければ `null`）。 */
  readonly senderName: string | null;
  /** 当たった箇所の前後だけ（引用は除く）。 */
  readonly snippet: string;
};

/**
 * ✅ 2026-10-27（AC-14）: この発言を読み手に返してよいか。🔴 `CLEAN` でない添付の発言は送った本人だけ。
 *    本体は RLS の RESTRICTIVE ポリシー（migration 20261027010000）であり、これは写しの段の二重の守り。
 */
export function isChatMessageVisibleToViewer(
  row: Pick<ChatMessageRow, 'senderUserId' | 'attachmentContentType' | 'attachmentScanStatus'>,
  viewerUserId: string,
): boolean {
  if (row.attachmentContentType == null && row.attachmentScanStatus == null) return true;
  return row.attachmentScanStatus === 'CLEAN' || row.senderUserId === viewerUserId;
}

/**
 * ✅ 2026-10-27（レビュー）: `isChatMessageVisibleToViewer` と**同じ条件**を、発言を数える・冒頭を出す問い合わせの `where` に
 * 足すための形（一覧の冒頭・未読の数・本文の検索）。後から行を落とすのではなく、数える前に除く（件数が漏れない）。
 * 🔴 本体は RLS の RESTRICTIVE ポリシー（migration 20261027010000）であり、これはアプリ側の二重の守り。
 *    添付の 4 列は「全部ある」か「全部ない」か（CHECK）なので、`attachmentKey` の有無は種類・状態の有無と同じ。
 */
export function chatMessageVisibleWhere(viewerUserId: string) {
  return { OR: [{ attachmentKey: null }, { attachmentScanStatus: 'CLEAN' }, { senderUserId: viewerUserId }] };
}

/** ✅ 2026-10-27: 添えたファイルの写し（無い・発言が消えたなら `null`）。 */
export function chatAttachmentView(
  row: Pick<ChatMessageRow, 'body' | 'deletedAt' | 'purgedAt' | 'attachmentContentType' | 'attachmentByteSize' | 'attachmentScanStatus'>,
): ChatAttachmentView | null {
  if (row.attachmentContentType == null || row.attachmentByteSize == null || row.attachmentScanStatus == null) return null;
  if (row.deletedAt != null || row.purgedAt != null) return null;
  return {
    // 🔴 受け付けない種類は DB の CHECK が入れさせないが、万一の値は「札」として出す（画像として埋め込まない）。
    kind: chatAttachmentKindOf(row.attachmentContentType) ?? 'file',
    contentType: row.attachmentContentType,
    byteSize: Number(row.attachmentByteSize),
    scanStatus: row.attachmentScanStatus as ScanStatus,
  };
}

export type ChatMessageDeps = {
  /** 送信者の表示名（読めなければ `null`）。 */
  readonly senderName: string | null;
  /** 送信者の会社名（読めなければ `null`）。 */
  readonly senderCompanyName: string | null;
  /** ✅ 2026-10-22: 送信者の今のひとこと状態（RLS で読めたものだけ。無ければ `null`）。 */
  readonly senderStatus?: string | null;
  /**
   * 🔴 読み手の所属（`ctx.partnerCompanyId`。ホストは `null`）。
   *    **リクエスト入力から渡してはならない**（`CLAUDE.md` §3.1）。
   */
  readonly viewerPartnerCompanyId: string | null;
  /**
   * 🔴 読み手の利用者 ID（`ctx.userId`）。`mine`（自分の発言か）の判定にだけ使う。
   *    **リクエスト入力から渡してはならない**（`CLAUDE.md` §3.1）。**応答には載せない**（`senderUserId` と同じ）。
   */
  readonly viewerUserId: string;
  /** ✅ 2026-10-16: この発言のリアクション（`summarizeReactions`。無ければ空）。 */
  readonly reactions?: readonly ChatReactionSummary[];
  /** ✅ 2026-10-22: 読み手本人が保存しているか（省略時は保存していない）。 */
  readonly saved?: boolean;
  /**
   * ✅ 2026-10-23: 貼った案件を**読み手の RLS で**読めたときのカード。読めなければ省略（`undefined`）。
   * 🔴 省略は「読めない」として扱う（既定で隠す側に倒す。`chatMessageView` の 🔴）。
   */
  readonly attachedProject?: ChatVisibleProjectCard;
};

/**
 * ✅ 2026-10-23: 発言の案件カードを決める（純粋関数）。
 * 🔴 貼っていない・本文が消えた（本人の削除・保持期限の削除）発言は `null`（カードも出さない）。
 * 🔴 貼ってあるのに読めた結果が無ければ `{ visible: false }` だけを返す（**既定で隠す**。名前も ID も載せない）。
 */
export function chatAttachedProjectView(
  row: Pick<ChatMessageRow, 'body' | 'attachedProjectId' | 'deletedAt'>,
  readable: ChatVisibleProjectCard | undefined,
): ChatAttachedProjectView | null {
  if (row.attachedProjectId == null || row.body === null || row.deletedAt != null) return null;
  if (readable === undefined || readable.id !== row.attachedProjectId) return { visible: false };
  return readable;
}

export function chatMessageView(row: ChatMessageRow, deps: ChatMessageDeps): ChatMessageView {
  return {
    id: row.id,
    sentAt: row.sentAt.toISOString(),
    senderName: deps.senderName,
    senderCompanyName: deps.senderCompanyName,
    senderStatus: deps.senderStatus ?? null,
    // 🔴 「自社か」は会社で決める（スレッドには 2 社しか居ない。`F-038 AC-2`）。利用者単位にすると
    //    同僚の発言が「相手の発言」として寄せられる。
    own: row.senderPartnerCompanyId === deps.viewerPartnerCompanyId,
    // ✅ 2026-10-14（チャットレーン）: **自分の発言か**（会話型で自分だけを右に寄せるため）。
    //    🔴 真偽値だけを返し、送信者の利用者 ID は応答に載せない（`CHAT_FORBIDDEN_RESPONSE_KEYS` の `senderUserId`）。
    //    `mine` なら必ず `own`（自分は自社に属する）。
    mine: row.senderUserId === deps.viewerUserId,
    // 🔴 削除済み・消去済みの発言は、行に何が残っていても本文を返さない（#166 の 1。書き戻しが起きても届けない二重の守り）。
    body: row.deletedAt != null || row.purgedAt != null ? null : row.body,
    reactions: deps.reactions ?? [],
    edited: row.editedAt != null && row.deletedAt == null,
    deleted: row.deletedAt != null,
    saved: deps.saved ?? false,
    attachedProject: chatAttachedProjectView(row, deps.attachedProject),
    attachment: chatAttachmentView(row),
  };
}
