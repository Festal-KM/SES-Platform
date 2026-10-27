'use client';

import { CHAT_MESSAGE_MAX_LENGTH } from '@ses/config';
import { Alert, Button, CHAT_COMPOSER_HEIGHT_CLASS, CHAT_COMPOSER_FOCUS_CLASSES, CHAT_COMPOSER_INPUT_FOCUS_CLASSES, Field, Icon, IconButton, Input, Select, Textarea, cn } from '@ses/ui';
import { useRef } from 'react';

import { CHAT_ATTACHMENT_ACCEPT, chatAttachmentSummary } from '../../../lib/chat/attachment-client';

import { isSendKey } from '../../../lib/chat/layout';
import { CHAT_FORMATS } from '../../../lib/chat/markdown';
import { remainingChars } from '../../../lib/chat/message-text';
import { chatHref, chatMessagesApiPath } from '../../../lib/chat/screen-query';
import { ChatMessageMarkdown } from './chat-message-markdown';
import { ChatProjectPicker } from './chat-project-picker';
import type { ChatConversationState } from './use-chat-conversation';

/** ✅ 2026-10-22: 定型文の選択肢の値。自分の定型文と固定の文面の ID がぶつからないよう頭を分ける。 */
const OWN_TEMPLATE_PREFIX = 'own:';
const MANAGE_TEMPLATES_VALUE = 'manage';

type ChatComposerState = Pick<ChatConversationState,
  | 'threadKind'
  | 'title'
  | 'threadId'
  | 'canPost'
  | 'messages'
  | 'ownTemplates'
  | 'body'
  | 'sending'
  | 'sendError'
  | 'setSendError'
  | 'pendingSend'
  | 'slashRange'
  | 'setSlashRange'
  | 'slashTemplatesOpen'
  | 'setSlashTemplatesOpen'
  | 'pickerOpen'
  | 'setPickerOpen'
  | 'attachedProject'
  | 'setAttachedProject'
  | 'canAttach'
  | 'attachedFile'
  | 'setAttachedFile'
  | 'attachRejected'
  | 'pickFile'
  | 'composeTab'
  | 'setComposeTab'
  | 'mentionOpen'
  | 'setMentionOpen'
  | 'formatOpen'
  | 'setFormatOpen'
  | 'templateOpen'
  | 'setTemplateOpen'
  | 'composeId'
  | 'mentionCandidates'
  | 'composeTextarea'
  | 'formatCompose'
  | 'mentionCompose'
  | 'trackSlash'
  | 'consumeSlash'
  | 'insertTemplateFromSlash'
  | 'updateBody'
  | 'submit'
  | 'undoSend'
  | 'sendNow'
>;

export function ChatComposer({ conversation }: { readonly conversation: ChatComposerState }) {
  const {
    threadKind,
    title,
    threadId,
    canPost,
    messages,
    ownTemplates,
    body,
    sending,
    sendError,
    setSendError,
    pendingSend,
    slashRange,
    setSlashRange,
    slashTemplatesOpen,
    setSlashTemplatesOpen,
    pickerOpen,
    setPickerOpen,
    attachedProject,
    setAttachedProject,
    canAttach,
    attachedFile,
    setAttachedFile,
    attachRejected,
    pickFile,
    composeTab,
    setComposeTab,
    mentionOpen,
    setMentionOpen,
    formatOpen,
    setFormatOpen,
    templateOpen,
    setTemplateOpen,
    composeId,
    mentionCandidates,
    composeTextarea,
    formatCompose,
    mentionCompose,
    trackSlash,
    consumeSlash,
    insertTemplateFromSlash,
    updateBody,
    submit,
    undoSend,
    sendNow,
  } = conversation;
  // ✅ 2026-10-27: ファイルを選ぶ欄（見えない。印のボタンから開く）。
  const fileInput = useRef<HTMLInputElement | null>(null);
  return (<>
      {/* 🔴 コンポーザー（64）。会話の下端に固定され、本文だけがその上で伸び縮みする。 */}
      {canPost ? (
        // 🔴 `method="post"` は水和前の送信を URL に載せないための壁である（上の ⑦）。
        <form
          method="post"
          action={chatMessagesApiPath(threadId)}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          // 会話の高さの中で入力欄の場所を確保し、履歴だけをスクロールさせる。
          className={`shrink-0 border-t border-border bg-bg px-4 py-3 md:px-5 ${CHAT_COMPOSER_HEIGHT_CLASS}`}
          data-testid="chat-compose"
        >
          {/* ✅ 2026-10-22（紺野「こういうチャット枠が必要だよね」= GitHub のコメント欄）:
              上に「書く／プレビュー」と書式ボタン、下に入力欄。
              ✅ 2026-10-26（改訂 43）: 下段の印と送信も同じ枠に収め、入力に合わせて高さを伸ばす。
              🔴 書式は Markdown の一部だけ（`lib/chat/markdown.ts`）。HTML は通さない。 */}
          {/* 🔴 `as="div"`: 枠の中にボタンがあるので `<label>` で包まない（ラベルが最初のボタンに結び付く）。入力欄は `aria-label` で名付ける。 */}
          {/* ✅ 2026-10-22（紺野「スマホ版おわってる」・Teams の参考）: 入力欄は**普段は細い 1 行**。書式ボタンと「書く／プレビュー」は
              下の「書式」を押したときだけ出す（スマホで入力欄が画面の半分を占めていた）。見出し「メッセージ」は読み上げ用だけにした。 */}
          <Field as="div" label={messages.composeLabel} labelClassName="sr-only">
            <div className={cn('flex flex-col rounded-md border border-border-strong bg-bg', CHAT_COMPOSER_FOCUS_CLASSES)} data-testid="chat-compose-box">
              {formatOpen ? (
              <div className="flex flex-wrap items-center gap-1 border-b border-border bg-bg-subtle px-2 py-1">
                <Button
                  type="button"
                  // 開いている方を塗る（どちらを見ているかを形で分ける）。
                  variant={composeTab === 'write' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={composeTab === 'write'}
                  onClick={() => setComposeTab('write')}
                  data-testid="chat-compose-tab-write"
                >
                  {messages.composeWrite}
                </Button>
                <Button
                  type="button"
                  // 開いている方を塗る（どちらを見ているかを形で分ける）。
                  variant={composeTab === 'preview' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={composeTab === 'preview'}
                  onClick={() => {
                    setMentionOpen(false);
                    setComposeTab('preview');
                  }}
                  data-testid="chat-compose-tab-preview"
                >
                  {messages.composePreview}
                </Button>
                {composeTab === 'write' ? (
                  <div role="toolbar" aria-label={messages.composeToolbar} className="ml-auto flex flex-wrap items-center gap-1" data-testid="chat-compose-toolbar">
                    {CHAT_FORMATS.map((format) => (
                      <Button
                        key={format}
                        type="button"
                        variant="ghost"
                        size="sm"
                        // 🔴 押しても入力欄の選択を失わない（ボタンにフォーカスを移さない）。
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => formatCompose(format)}
                        data-testid={`chat-compose-format-${format}`}
                      >
                        {messages.composeFormats[format]}
                      </Button>
                    ))}

                  </div>
                ) : null}
              </div>
              ) : null}
              {mentionOpen && composeTab === 'write' ? (
                <div className="flex flex-wrap gap-1 border-b border-border px-2 py-2" data-testid="chat-compose-mention-list">
                  {mentionCandidates.length === 0 ? (
                    <span className="text-xs text-fg-muted">{messages.composeMentionEmpty}</span>
                  ) : (
                    mentionCandidates.map((name) => (
                      <Button
                        key={name}
                        type="button"
                        variant="secondary"
                        size="sm"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => mentionCompose(name)}
                      >
                        {`@${name}`}
                      </Button>
                    ))
                  )}
                </div>
              ) : null}
              {/* ✅ 2026-10-23（紺野）: 行頭で「/」を打つと出る小さなメニュー（案件を貼る / 定型文）。 */}
              {slashRange !== null && composeTab === 'write' ? (
                <div
                  role="group"
                  aria-label={messages.slash.label}
                  className="flex flex-col gap-1 border-b border-border px-2 py-2"
                  data-testid="chat-compose-slash-menu"
                >
                  {slashTemplatesOpen ? (
                    <div className="flex flex-wrap gap-1" data-testid="chat-compose-slash-templates">
                      {[...ownTemplates, ...messages.templates].map((template) => (
                        <Button
                          key={`${template.id}-${template.label}`}
                          type="button"
                          variant="secondary"
                          size="sm"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertTemplateFromSlash(template.body)}
                        >
                          {template.label}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          consumeSlash();
                          setPickerOpen(true);
                        }}
                        data-testid="chat-compose-slash-project"
                      >
                        <Icon name="briefcase" />
                        {messages.slash.project}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => setSlashTemplatesOpen(true)}
                        data-testid="chat-compose-slash-template"
                      >
                        {messages.slash.template}
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
              {/* ✅ 2026-10-23: 貼る案件を選ぶ小窓（候補は #51n。最終の判定は投稿のサーバ側）。 */}
              {pickerOpen ? (
                <ChatProjectPicker
                  threadId={threadId}
                  labels={messages.pasteProject}
                  statuses={messages.projectCard.statuses}
                  onPick={(project) => {
                    setAttachedProject(project);
                    setPickerOpen(false);
                    if (sendError === 'PROJECT') setSendError('NONE');
                    composeTextarea()?.focus();
                  }}
                  onClose={() => setPickerOpen(false)}
                />
              ) : null}
              {/* ✅ 2026-10-23: 送信で一緒に送る案件（外せる）。 */}
              {attachedProject === null ? null : (
                <div className="flex items-center gap-2 border-b border-border px-3 py-1" data-testid="chat-compose-attached-project">
                  <Icon name="briefcase" className="text-fg-muted" />
                  <span className="shrink-0 text-xs text-fg-muted">{messages.pasteProject.attached}</span>
                  <span className="min-w-0 truncate text-xs font-medium text-fg">{attachedProject.name}</span>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    // ✅ 2026-10-26（Codex のレビュー）: スマホでは押せる大きさを 44px にする。
                    className="ml-auto h-11 w-11 md:h-8 md:w-8"
                    icon={<Icon name="x" />}
                    aria-label={messages.pasteProject.remove}
                    onClick={() => setAttachedProject(null)}
                    data-testid="chat-compose-attached-project-remove"
                  />
                </div>
              )}
              {/* ✅ 2026-10-27（改訂 44）: 一緒に送るファイル（種類・大きさ ×）。🔴 ファイル名は出さない（保存しない）。 */}
              {attachedFile === null || !canAttach ? null : (
                <div className="flex items-center gap-2 border-b border-border px-3 py-1" data-testid="chat-compose-attached-file">
                  <Icon name="chat-attach" className="text-fg-muted" />
                  <span className="shrink-0 text-xs text-fg-muted">{messages.attachment.selected}</span>
                  <span className="min-w-0 truncate text-xs font-medium text-fg">
                    {chatAttachmentSummary({ contentType: attachedFile.contentType, byteSize: attachedFile.file.size }, messages.attachment)}
                  </span>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-11 w-11 md:h-8 md:w-8"
                    icon={<Icon name="x" />}
                    aria-label={messages.attachment.remove}
                    onClick={() => setAttachedFile(null)}
                    data-testid="chat-compose-attached-file-remove"
                  />
                </div>
              )}
              {composeTab === 'write' ? (
                <Textarea
                  id={composeId}
                  aria-label={messages.composeLabel}
                  rows={1}
                  name="body"
                  value={body}
                  maxLength={CHAT_MESSAGE_MAX_LENGTH}
                  placeholder={title?.title ? `${title.title}${messages.composePlaceholderSuffix}` : messages.composePlaceholder}
                  // 書式を開いたときは、自動で伸びないブラウザでも複数行を見渡せる高さを確保する。
                  // 自動で伸びる場合も max-h-40 で止め、以降は欄の中でスクロールする。
                  className={cn(
                    'overflow-y-auto overscroll-contain rounded-none border-0',
                    CHAT_COMPOSER_INPUT_FOCUS_CLASSES,
                    'max-h-40 resize-none',
                    formatOpen ? 'min-h-20' : 'min-h-11',
                  )}
                  onChange={(event) => {
                    updateBody(event.target.value);
                    trackSlash(event.target.value, event.target.selectionStart);
                  }}
                  // ✅ 2026-10-13（Lark 寄せ）: Enter で送信、Shift+Enter で改行。
                  // 🔴 日本語入力の変換確定の Enter では送らない（`lib/chat/layout.ts` の `isSendKey`）。
                  onKeyDown={(event) => {
                    // ✅ 2026-10-22: ⌘B / ⌘I（Ctrl も）で太字・斜体（GitHub と同じ）。
                    if ((event.metaKey || event.ctrlKey) && (event.key === 'b' || event.key === 'i')) {
                      event.preventDefault();
                      formatCompose(event.key === 'b' ? 'bold' : 'italic');
                      return;
                    }
                    // ✅ 2026-10-23: 「/」のメニューが出ていれば、Esc はメニューを閉じるだけ。
                    if (event.key === 'Escape' && slashRange !== null) {
                      event.preventDefault();
                      setSlashRange(null);
                      setSlashTemplatesOpen(false);
                      return;
                    }
                    // ✅ 2026-10-14: Esc で入力欄を離れる。
                    if (event.key === 'Escape') {
                      event.currentTarget.blur();
                      return;
                    }
                    if (
                      isSendKey({
                        key: event.key,
                        shiftKey: event.shiftKey,
                        isComposing: event.nativeEvent.isComposing,
                        keyCode: event.keyCode,
                      })
                    ) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  data-testid="chat-compose-body"
                />
              ) : (
                <div className="flex min-h-20 flex-col gap-2 px-3 py-2 text-body text-fg" data-testid="chat-compose-preview">
                  {body.trim() === '' ? (
                    <span className="text-fg-muted">{messages.composePreviewEmpty}</span>
                  ) : (
                    <ChatMessageMarkdown text={body} messageId={null} mentionNames={mentionCandidates} />
                  )}
                </div>
              )}
              {formatOpen ? (
                <p className="m-0 px-3 py-1 text-xs text-fg-muted">{messages.composeMarkdownHint}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-1 p-1">
                {/* ✅ 2026-10-22: 書式ボタン・プレビュー・@ 名前の帯を開く（普段は閉じて入力欄を細くする）。 */}
                <IconButton
                  icon={<Icon name="chat-format" />}
                  aria-label={messages.composeToolbar}
                  title={messages.composeToolbar}
                  className="h-11 w-11"
                  type="button"
                  variant={formatOpen ? 'secondary' : 'ghost'}
                  aria-pressed={formatOpen}
                  onClick={() => {
                    setFormatOpen((value) => !value);
                    setMentionOpen(false);
                    setComposeTab('write');
                  }}
                  data-testid="chat-compose-format-toggle"
                />
                <IconButton type="button" variant={mentionOpen ? 'secondary' : 'ghost'} className="h-11 w-11" icon={<Icon name="chat-mention" />} aria-label={messages.composeMention} title={messages.composeMention} aria-expanded={mentionOpen} onMouseDown={(event) => event.preventDefault()} onClick={() => { setComposeTab('write'); setMentionOpen((open) => !open); }} data-testid="chat-compose-mention" />
                <IconButton type="button" variant="ghost" className="ml-3 h-11 w-11" icon={<Icon name="chat-slash" />} aria-label={messages.slash.label} title={messages.slash.label} aria-expanded={slashRange !== null} onClick={() => {
                  setComposeTab('write');
                  if (slashRange !== null) { setSlashRange(null); setSlashTemplatesOpen(false); return; }
                  const next = body === '' ? '/' : `${body}\n/`;
                  updateBody(next);
                  trackSlash(next, next.length);
                  composeTextarea()?.focus();
                }} data-testid="chat-compose-slash-toggle" />
                {/* ✅ 2026-10-27（改訂 44）: ファイルを添える。🔴 取引先がいる部屋・閲覧専用には描かない（押して断られる導線を置かない）。 */}
                {canAttach ? (
                  <>
                    <IconButton
                      type="button"
                      variant={attachedFile === null ? 'ghost' : 'secondary'}
                      className="h-11 w-11"
                      icon={<Icon name="chat-attach" />}
                      aria-label={messages.attachment.add}
                      title={messages.attachment.add}
                      onClick={() => fileInput.current?.click()}
                      data-testid="chat-compose-attach"
                    />
                    <Input
                      ref={fileInput}
                      type="file"
                      accept={CHAT_ATTACHMENT_ACCEPT}
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                      onChange={(event) => {
                        pickFile(event.target.files?.[0] ?? null);
                        // 同じファイルを選び直しても変化として届くよう、選択を空に戻す。
                        event.target.value = '';
                      }}
                      data-testid="chat-compose-attach-input"
                    />
                  </>
                ) : null}
                <IconButton type="button" variant={templateOpen ? 'secondary' : 'ghost'} className="h-11 w-11" icon={<Icon name="chat-template" />} aria-label={messages.templateLabel} title={messages.templateLabel} aria-expanded={templateOpen} aria-controls={`chat-compose-template-${threadId}`} onClick={() => setTemplateOpen((open) => !open)} data-testid="chat-compose-template-toggle" />
                {/* ✅ 2026-10-14: 送信に失敗したら、書いた文章を残したまま、その場で送り直せる
                    （🔴 二重送信の防止は `createSubmitGuard` のまま。見えなくなったスレッドには再送を出さない）。 */}
                {sendError === 'FAILED' && !sending ? (
                  <Button type="button" variant="secondary" onClick={submit} data-testid="chat-compose-retry">
                    {messages.retry}
                  </Button>
                ) : null}
                <Button type="submit" variant="primary" className="ml-auto min-h-11 shrink-0 gap-1" data-testid="chat-compose-submit">
                  <Icon name="chat-send" />
                  {sending ? messages.composeSubmitting : messages.composeSubmit}
                </Button>
                {/* ✅ 2026-10-14: 定型文（固定の文面）を入力欄の末尾に入れる。 */}
                <label className="sr-only" htmlFor={`chat-compose-template-${threadId}`}>
                  {messages.templateLabel}
                </label>
                <Select
                  id={`chat-compose-template-${threadId}`}
                  value=""
                  onChange={(event) => {
                    const value = event.target.value;
                    setTemplateOpen(false);
                    // ✅ 2026-10-22: 末尾の「定型文を編集…」は一覧の列を管理画面に切り替える。
                    //    幅のある画面では開いている会話を残し、スマホ（一覧と会話を切り替える）では一覧に戻る。
                    if (value === MANAGE_TEMPLATES_VALUE) {
                      const wide = window.matchMedia('(min-width: 768px)').matches;
                      window.location.assign(chatHref(wide ? { thread: threadId, filter: { kind: 'templates' } } : { filter: { kind: 'templates' } }));
                      return;
                    }
                    const template = value.startsWith(OWN_TEMPLATE_PREFIX)
                      ? ownTemplates.find((entry) => OWN_TEMPLATE_PREFIX + entry.id === value)
                      : messages.templates.find((entry) => entry.id === value);
                    if (template === undefined) return;
                    updateBody(body === '' ? template.body : `${body}\n${template.body}`);
                    document.getElementById(composeId)?.focus();
                  }}
                  className={cn("w-full", templateOpen ? null : "hidden")}
                  data-testid="chat-compose-template"
                >
                  <option value="">{messages.templatePlaceholder}</option>
                  {ownTemplates.length === 0 ? null : (
                    <optgroup label={messages.templateOwnGroup} data-testid="chat-compose-template-own">
                      {ownTemplates.map((template) => (
                        <option key={template.id} value={OWN_TEMPLATE_PREFIX + template.id}>
                          {template.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={messages.templateFixedGroup}>
                    {messages.templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.label}
                      </option>
                    ))}
                  </optgroup>
                  <option value={MANAGE_TEMPLATES_VALUE}>{messages.templateManage}</option>
                </Select>
                {/* ✅ 2026-10-14: 残り文字数（残り 200 文字を切ったら出す）。 */}
                {(() => {
                  const remaining = remainingChars(body, CHAT_MESSAGE_MAX_LENGTH);
                  return remaining === null ? null : (
                    <span className="ml-auto text-xs text-fg-muted" aria-live="polite" data-testid="chat-compose-remaining">
                      {`${messages.remainingBefore} ${String(remaining)} ${messages.remainingAfter}`}
                    </span>
                  );
                })()}
              </div>
            </div>
          </Field>
          {/* 誰に見えるか（取引先との部屋では大事な情報なので、小さく常に出す）。 */}
          <p className="m-0 mt-1 text-xs text-fg-muted">{threadKind === 'DM' || threadKind === 'GROUP' ? messages.composeMemberHint : messages.composeHint}</p>
          {/* ✅ 2026-10-27（改訂 44）: 🔴 ファイルを添えられる部屋では、選んでいなくても常に出す。 */}
          {canAttach ? (
            <p className="m-0 mt-1 text-xs text-fg-muted" data-testid="chat-compose-attach-note">
              {messages.attachment.note}
            </p>
          ) : null}
          {canAttach && attachRejected ? (
            <p className="m-0 mt-1 text-xs text-danger" role="status" data-testid="chat-compose-attach-rejected">
              {messages.attachment.unsupported}
            </p>
          ) : null}
          {/* ✅ 2026-10-14: 送信の取り消し（押してから数秒は送らずに待つ）。 */}
          {pendingSend === null ? null : (
            <div className="mb-2 flex flex-wrap items-center gap-2" aria-live="polite" data-testid="chat-compose-pending">
              <span className="text-body text-fg-muted">{messages.pending}</span>
              <Button type="button" variant="secondary" size="sm" className="min-h-11 md:min-h-8" onClick={undoSend} data-testid="chat-compose-undo">
                {messages.undo}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={sendNow} data-testid="chat-compose-send-now">
                {messages.sendNow}
              </Button>
            </div>
          )}
          {sendError === 'NONE' ? null : (
            <Alert variant="danger" data-testid="chat-compose-error">
              {sendError === 'MISSING'
                ? messages.composeThreadMissing
                : sendError === 'PROJECT'
                  ? messages.pasteProject.notPastable
                  : sendError === 'ATTACHMENT'
                    ? messages.attachment.uploadFailed
                    : messages.composeFailed}
            </Alert>
          )}

        </form>
      ) : (
        // 🔴 ボタンを描かず理由を置く（`disabled` にしない）。
        <p
          className={`m-0 shrink-0 border-t border-border px-5 py-3 text-body text-fg-muted ${CHAT_COMPOSER_HEIGHT_CLASS}`}
          data-testid="chat-compose-not-allowed"
        >
          {messages.composeNotAllowed}
        </p>
      )}

  </>);
}
