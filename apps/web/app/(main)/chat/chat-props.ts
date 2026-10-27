// apps/web/app/(main)/chat/chat-props.ts
// `S-031` の文言の束（`packages/i18n` で解決し、`'use client'` の島へ**解決済みの文字列**で渡す）。
//
// 🔴 **島が `t()` を呼ばない**（`@ses/i18n` のカタログを丸ごとクライアントへ運ばない。
//    `S-015` の `EngineerShareScreenMessages` と同じ作法）。
// 🔴 **文言をコンポーネントにベタ書きしない**（`CLAUDE.md` §3.5 / `BR-32`）。
import { t } from '@ses/i18n';
import type { ChatFormat } from '../../../lib/chat/markdown';
import type { ChatProjectCardLabels } from '../../../lib/chat/project-card-text';
import type { ChatReactionKind } from '../../../lib/chat/views';
import type { ChatAttachmentLabels } from './chat-attachment';
import { PREFECTURE_MESSAGE_KEYS } from '../../../lib/format/prefectures';
import { PROJECT_REMOTE_MODE_MESSAGE_KEYS, PROJECT_STATUS_MESSAGE_KEYS } from '../../../lib/projects/labels';

/** 会話（中央）の島が使う語。 */
export type ChatConversationMessages = {
  /** ✅ 2026-10-26（#164 の 2）: 開いている間に読めなくなった（部屋から外れた等）ときの案内。 */
  readonly unavailable?: string;
  readonly heading: string;
  readonly listLabel: string;
  readonly empty: string;
  readonly older: string;
  readonly olderLoading: string;
  readonly olderFailed: string;
  readonly purged: string;
  readonly own: string;
  readonly unknownName: string;
  readonly backToList: string;
  readonly composeLabel: string;
  readonly composePlaceholder: string;
  readonly composePlaceholderSuffix: string;
  readonly composeHint: string;
  readonly composeMemberHint: string;
  /** ✅ 2026-10-22: 書式ボタン・書く／プレビュー・@（GitHub のコメント欄に寄せた）。 */
  readonly composeToolbar: string;
  /** ✅ 2026-10-22: スマホの会話の見出しの「…」（その他の操作）。 */
  readonly headerMenu: string;
  readonly composeFormats: Readonly<Record<ChatFormat, string>>;
  readonly composeMention: string;
  readonly composeMentionEmpty: string;
  readonly composeWrite: string;
  readonly composePreview: string;
  readonly composePreviewEmpty: string;
  readonly composeMarkdownHint: string;
  readonly composeSubmit: string;
  readonly composeSubmitting: string;
  readonly composeFailed: string;
  readonly composeThreadMissing: string;
  readonly composeNotAllowed: string;
  /** ✅ 2026-10-14: 並べて開いた会話を閉じる。 */
  readonly closePane: string;
  /** ✅ 2026-10-14: 会話の操作の改修。 */
  readonly copy: string;
  readonly copied: string;
  readonly readMore: string;
  readonly readLess: string;
  readonly messageActions: string;
  readonly toLatest: string;
  readonly firstMessage: string;
  readonly remainingBefore: string;
  readonly remainingAfter: string;
  readonly retry: string;
  readonly newArrived: string;
  readonly pending: string;
  readonly undo: string;
  readonly sendNow: string;
  /** ✅ 2026-10-16: 既読・未読。 */
  readonly unreadFrom: string;
  readonly markUnread: string;
  /** ✅ 2026-10-19（#128）: DM の既読表示。 */
  readonly read: string;
  /** ✅ 2026-10-16: リアクションの語（4 つ）と「リアクション」。 */
  readonly reactions: Readonly<Record<ChatReactionKind, string>>;
  readonly reactionAdd: string;
  /** ✅ 2026-10-16: 編集・削除。 */
  readonly edit: string;
  readonly remove: string;
  readonly edited: string;
  readonly deleted: string;
  readonly save: string;
  readonly cancel: string;
  readonly deleteTitle: string;
  readonly deleteConfirm: string;
  readonly deleteConfirmYes: string;
  readonly editFailed: string;
  /** ✅ 2026-10-16: ピン留め・ミュート。 */
  readonly pin: string;
  readonly unpin: string;
  readonly mute: string;
  readonly unmute: string;
  /** ✅ 2026-10-16: 会話の書き出し。 */
  readonly exportLink: string;
  readonly templateLabel: string;
  readonly templatePlaceholder: string;
  /** 定型文（固定の文面。🔴 個人情報・単価を含めない）。 */
  readonly templates: readonly { readonly id: string; readonly label: string; readonly body: string }[];
  /** ✅ 2026-10-22: 自分の定型文の見出し・固定の文面の見出し・管理画面へ（選択肢の末尾）。 */
  readonly templateOwnGroup: string;
  readonly templateFixedGroup: string;
  readonly templateManage: string;
  /** ✅ 2026-10-22: 発言の保存（本人だけの栞）。 */
  readonly bookmark: string;
  readonly unbookmark: string;
  readonly bookmarked: string;
  /** ✅ 2026-10-26: アナウンス（部屋の上部に固定する発言。1 部屋 1 件）。 */
  readonly announcementLabel: string;
  readonly announcementSet: string;
  readonly announcementUnset: string;
  readonly announcementClear: string;
  readonly announcementJump: string;
  readonly announcementSetBySuffix: string;
  readonly announcementNotLoadedSuffix: string;
  readonly announcementFailed: string;
  /** ✅ 2026-10-23: 行頭の「/」のメニューと、案件を貼る小窓。 */
  readonly slash: { readonly label: string; readonly project: string; readonly template: string };
  readonly pasteProject: {
    readonly title: string;
    readonly search: string;
    readonly hint: string;
    readonly loading: string;
    readonly empty: string;
    readonly failed: string;
    readonly attached: string;
    readonly remove: string;
    readonly close: string;
    readonly notPastable: string;
  };
  /** ✅ 2026-10-23: 発言の中の案件カード。 */
  readonly projectCard: ChatProjectCardLabels & {
    readonly label: string;
    readonly hidden: string;
    readonly start: string;
    readonly location: string;
    readonly countUnit: string;
    readonly open: string;
    readonly quote: string;
  };
  /** ✅ 2026-10-27（`docs/04` §S-031 改訂 44）: ファイル（社内だけの部屋から）。 */
  readonly attachment: ChatAttachmentLabels;
};

/** ✅ 2026-10-27: ファイルの語（会話の島と右の欄の一覧が同じものを使う）。 */
export function chatAttachmentLabels(): ChatAttachmentLabels {
  return {
    add: t('chat.attachment.add'),
    note: t('chat.attachment.note'),
    selected: t('chat.attachment.selected'),
    remove: t('chat.attachment.remove'),
    scanning: t('chat.attachment.scanning'),
    blocked: t('chat.attachment.blocked'),
    unscannable: t('chat.attachment.unscannable'),
    open: t('chat.attachment.open'),
    openNewTab: t('chat.attachment.openNewTab'),
    openFailed: t('chat.attachment.openFailed'),
    unsupported: t('chat.attachment.unsupported'),
    uploadFailed: t('chat.attachment.uploadFailed'),
    imageAlt: t('chat.attachment.imageAlt'),
    pdfTitle: t('chat.attachment.pdfTitle'),
    filesHeading: t('chat.attachment.files.heading'),
    filesEmpty: t('chat.attachment.files.empty'),
    filesLoading: t('chat.attachment.files.loading'),
    filesFailed: t('chat.attachment.files.failed'),
    filesMore: t('chat.attachment.files.more'),
    types: {
      image: t('chat.attachment.type.image'),
      pdf: t('chat.attachment.type.pdf'),
      docx: t('chat.attachment.type.docx'),
      xlsx: t('chat.attachment.type.xlsx'),
      csv: t('chat.attachment.type.csv'),
      txt: t('chat.attachment.type.txt'),
      other: t('chat.attachment.type.other'),
    },
    units: {
      byte: t('chat.attachment.unit.byte'),
      kilo: t('chat.attachment.unit.kilo'),
      mega: t('chat.attachment.unit.mega'),
    },
    separator: t('chat.attachment.separator'),
  };
}

/** ✅ 2026-10-23: 値 → 語の写像を、島に渡せる素の記録にする（島は `t()` を呼ばない）。 */
function resolvedLabels(keys: Readonly<Record<string, Parameters<typeof t>[0]>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(keys).map(([value, key]) => [value, t(key)]));
}

/** ✅ 2026-10-14: ドラッグで会話を右に並べる受け口の語。 */
export type ChatPaneDropMessages = {
  readonly drop: string;
};

export function chatPaneDropMessages(): ChatPaneDropMessages {
  return { drop: t('chat.pane.drop') };
}

export function chatConversationMessages(): ChatConversationMessages {
  return {
    unavailable: t('chat.thread.missing'),
    heading: t('chat.messages.heading'),
    listLabel: t('chat.messages.label'),
    empty: t('chat.messages.empty'),
    older: t('chat.messages.older'),
    olderLoading: t('chat.messages.olderLoading'),
    olderFailed: t('chat.messages.olderFailed'),
    purged: t('chat.message.purged'),
    own: t('chat.message.own'),
    unknownName: t('chat.thread.unknownName'),
    backToList: t('chat.backToList'),
    composeLabel: t('chat.compose.label'),
    composePlaceholder: t('chat.compose.placeholder'),
    composePlaceholderSuffix: t('chat.compose.placeholderSuffix'),
    composeHint: t('chat.compose.hint'),
    composeMemberHint: t('chat.compose.memberHint'),
    composeToolbar: t('chat.compose.toolbar'),
    headerMenu: t('chat.header.menu'),
    composeFormats: {
      bold: t('chat.compose.format.bold'),
      italic: t('chat.compose.format.italic'),
      code: t('chat.compose.format.code'),
      link: t('chat.compose.format.link'),
      bullet: t('chat.compose.format.bullet'),
      ordered: t('chat.compose.format.ordered'),
      quote: t('chat.compose.format.quote'),
    },
    composeMention: t('chat.compose.mention'),
    composeMentionEmpty: t('chat.compose.mentionEmpty'),
    composeWrite: t('chat.compose.write'),
    composePreview: t('chat.compose.preview'),
    composePreviewEmpty: t('chat.compose.previewEmpty'),
    composeMarkdownHint: t('chat.compose.markdownHint'),
    composeSubmit: t('chat.compose.submit'),
    composeSubmitting: t('chat.compose.submitting'),
    composeFailed: t('chat.compose.failed'),
    composeThreadMissing: t('chat.compose.threadMissing'),
    composeNotAllowed: t('chat.compose.notAllowed'),
    closePane: t('chat.pane.close'),
    copy: t('chat.message.copy'),
    copied: t('chat.message.copied'),
    readMore: t('chat.message.readMore'),
    readLess: t('chat.message.readLess'),
    messageActions: t('chat.message.actions'),
    toLatest: t('chat.messages.toLatest'),
    firstMessage: t('chat.messages.first'),
    remainingBefore: t('chat.compose.remainingBefore'),
    remainingAfter: t('chat.compose.remainingAfter'),
    retry: t('chat.compose.retry'),
    newArrived: t('chat.messages.newArrived'),
    pending: t('chat.compose.pending'),
    undo: t('chat.compose.undo'),
    sendNow: t('chat.compose.sendNow'),
    unreadFrom: t('chat.messages.unreadFrom'),
    markUnread: t('chat.message.markUnread'),
    read: t('chat.message.read'),
    // ✅ 2026-10-22: 絵文字 12 種の読み上げ名を足した（`CHAT_REACTIONS` と同じ種類を全部持つ）。
    reactions: {
      THUMBS_UP: t('chat.reaction.THUMBS_UP'),
      PRAY: t('chat.reaction.PRAY'),
      TADA: t('chat.reaction.TADA'),
      SMILE: t('chat.reaction.SMILE'),
      JOY: t('chat.reaction.JOY'),
      EYES: t('chat.reaction.EYES'),
      BOW: t('chat.reaction.BOW'),
      SWEAT: t('chat.reaction.SWEAT'),
      CHECK: t('chat.reaction.CHECK'),
      HEART: t('chat.reaction.HEART'),
      FIRE: t('chat.reaction.FIRE'),
      CLAP: t('chat.reaction.CLAP'),
      OK: t('chat.reaction.OK'),
      THANKS: t('chat.reaction.THANKS'),
      CHECKING: t('chat.reaction.CHECKING'),
      DONE: t('chat.reaction.DONE'),
    },
    reactionAdd: t('chat.reaction.add'),
    edit: t('chat.message.edit'),
    remove: t('chat.message.delete'),
    edited: t('chat.message.edited'),
    deleted: t('chat.message.deleted'),
    save: t('chat.message.save'),
    cancel: t('chat.message.cancel'),
    deleteTitle: t('chat.message.deleteTitle'),
    deleteConfirm: t('chat.message.deleteConfirm'),
    deleteConfirmYes: t('chat.message.deleteConfirmYes'),
    editFailed: t('chat.message.editFailed'),
    pin: t('chat.thread.pin'),
    unpin: t('chat.thread.unpin'),
    mute: t('chat.thread.mute'),
    unmute: t('chat.thread.unmute'),
    exportLink: t('chat.export.link'),
    templateLabel: t('chat.compose.template.label'),
    templatePlaceholder: t('chat.compose.template.placeholder'),
    templates: [
      { id: 'interview', label: t('chat.compose.template.interview'), body: t('chat.compose.template.interview.body') },
      { id: 'extension', label: t('chat.compose.template.extension'), body: t('chat.compose.template.extension.body') },
      { id: 'status', label: t('chat.compose.template.status'), body: t('chat.compose.template.status.body') },
      { id: 'thanks', label: t('chat.compose.template.thanks'), body: t('chat.compose.template.thanks.body') },
    ],
    templateOwnGroup: t('chat.compose.template.own'),
    templateFixedGroup: t('chat.compose.template.fixed'),
    templateManage: t('chat.compose.template.manage'),
    bookmark: t('chat.message.bookmark'),
    unbookmark: t('chat.message.unbookmark'),
    bookmarked: t('chat.message.bookmarked'),
    announcementLabel: t('chat.announcement.label'),
    announcementSet: t('chat.announcement.set'),
    announcementUnset: t('chat.announcement.unset'),
    announcementClear: t('chat.announcement.clear'),
    announcementJump: t('chat.announcement.jump'),
    announcementSetBySuffix: t('chat.announcement.setBySuffix'),
    announcementNotLoadedSuffix: t('chat.announcement.notLoadedSuffix'),
    announcementFailed: t('chat.announcement.failed'),
    slash: {
      label: t('chat.compose.slash.label'),
      project: t('chat.compose.slash.project'),
      template: t('chat.compose.slash.template'),
    },
    pasteProject: {
      title: t('chat.compose.project.title'),
      search: t('chat.compose.project.search'),
      hint: t('chat.compose.project.hint'),
      loading: t('chat.compose.project.loading'),
      empty: t('chat.compose.project.empty'),
      failed: t('chat.compose.project.failed'),
      attached: t('chat.compose.project.attached'),
      remove: t('chat.compose.project.remove'),
      close: t('chat.compose.project.close'),
      notPastable: t('chat.compose.project.notPastable'),
    },
    projectCard: {
      label: t('chat.projectCard.label'),
      hidden: t('chat.projectCard.hidden'),
      start: t('chat.projectCard.start'),
      location: t('chat.projectCard.location'),
      must: t('chat.projectCard.must'),
      nice: t('chat.projectCard.nice'),
      countUnit: t('chat.projectCard.countUnit'),
      open: t('chat.projectCard.open'),
      quote: t('chat.projectCard.quote'),
      statuses: resolvedLabels(PROJECT_STATUS_MESSAGE_KEYS),
      remoteModes: resolvedLabels(PROJECT_REMOTE_MODE_MESSAGE_KEYS),
      prefectures: resolvedLabels(PREFECTURE_MESSAGE_KEYS),
      none: t('projects.detail.valueNone'),
      yearsOrMore: t('projects.list.requirements.yearsOrMore'),
    },
    attachment: chatAttachmentLabels(),
  };
}
