// apps/web/app/(main)/chat/chat-thread-panel.tsx
// `S-031` セクション 3「スレッド情報（右）」（`docs/04` §S-031）。
//
// ============================================================================
// 🔴 この panel に出さないもの（レビューの焦点）
// ============================================================================
//   ① 🔴 **ホストの商流を 1 項目も出さない** —— 単価・エンド企業名・粗利・上流契約（`BR-67`）。
//      出すのは **対象（案件名）/ 相手 / 参加会社**の 3 つだけである。
//   ② 🔴 **他社の示唆を出さない** —— 他パートナーの社名・他社の提案の存在・件数（`F-038 AC-1`）。
//   ③ 🔴 **タスク / ファイル（添付）のタブを作らない** —— `S-033`（タスク）は Phase 2 で未実装、
//      添付はスキャンの配線が無い（`lib/chat/views.ts` の ⑤）。**押して何も起きないタブを置かない。**
//   ④ 🔴 **参加会社は `thread_participants` の RLS（C5）が返した行だけ**を並べる。
//      取引先の文脈ではホストの行が見えないため 1 行になる（`lib/chat/read.ts` の
//      `readParticipants` の ⚠️）。**見えない行を補わない。**
//
// 🔴 サーバコンポーネント（`'use client'` を宣言しない）。
import Link from 'next/link';
import { t } from '@ses/i18n';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PANEL_KEY_WIDTH_CLASS,
  PANEL_KV_ROW_HEIGHT_CLASS,
  SECONDARY_LINK_CLASSES,
  cn,
} from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import type { ChatThreadDetailView } from '../../../lib/chat/views';
import { ChatOpenDmButton } from './chat-open-dm-button';

export type ChatThreadPanelProps = {
  readonly thread: ChatThreadDetailView;
  /** ✅ 2026-10-19（#128）: 投稿できる人にだけ「DM を開く」を出す（閲覧専用には描かない）。 */
  readonly canPost?: boolean;
};

/** Key-Value の 1 行（30px）。🔴 キーの列は 124px 固定（値の左端が縦に通る）。 */
const ROW_CLASSES = `flex items-center gap-2 border-t border-border-row ${PANEL_KV_ROW_HEIGHT_CLASS}`;
const KEY_CLASSES = `shrink-0 text-cell text-fg-muted ${PANEL_KEY_WIDTH_CLASS}`;
const VALUE_CLASSES = 'min-w-0 flex-1 text-body text-fg';

export function ChatThreadPanel({ thread, canPost = false }: ChatThreadPanelProps) {
  // ✅ 2026-10-19（#128）: DM・グループは「誰が読めるか」（メンバー）を出す。会社の段（参加会社）は出さない。
  if (thread.members !== undefined) {
    return (
      <Card data-testid="chat-panel">
        <CardHeader>
          <CardTitle>{t('chat.panel.heading')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="m-0 pb-2 text-xs text-fg-muted" data-testid="chat-panel-room-note">
            {t('chat.panel.roomNote')}
          </p>
          <h3 className="m-0 pb-1 text-cell font-normal text-fg-muted">{t('chat.panel.members')}</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="chat-panel-members">
            {thread.members.map((member) => {
              const name = member.name ?? t('chat.thread.unknownName');
              return (
                <li key={member.userId} data-testid={`chat-panel-member-${member.userId}`}>
                  {canPost && !member.self ? (
                    <ChatOpenDmButton userId={member.userId} label={`${name} ${t('chat.people.openDm')}`} failedLabel={t('chat.people.openDmFailed')}>
                      <span className="flex min-w-0 flex-col items-start">
                        <span className="truncate text-body text-fg">{name}</span>
                        <span className="truncate text-xs text-fg-muted">{member.companyName ?? ''}</span>
                      </span>
                    </ChatOpenDmButton>
                  ) : (
                    <span className="flex flex-col px-3 py-1">
                      <span className="text-body text-fg">{member.self ? `${name}（${t('chat.people.self')}）` : name}</span>
                      <span className="text-xs text-fg-muted">{member.companyName ?? ''}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="chat-panel">
      <CardHeader>
        <CardTitle>{t('chat.panel.heading')}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* ✅ 2026-10-13（`docs/design-system.md` §4.5）: Key-Value は 30px の行 /
            キーの列 124px / 区切りは `border-row`。**項目ごとに高さが変わらない。** */}
        <dl className="m-0 flex flex-col">
          <div className={ROW_CLASSES}>
            <dt className={KEY_CLASSES}>{t('chat.panel.target')}</dt>
            <dd className={VALUE_CLASSES} data-testid="chat-panel-target">
              {thread.project === null ? (
                t('chat.panel.noProject')
              ) : (
                <>
                  {thread.project.name}
                  {/* 🔴 案件詳細（`S-011`）は RLS（C4）が見せる相手にしか開かない。名前が読めた
                      = 母集団に入っているので、ここでリンクを出してよい（ロールで隠さない）。 */}
                  <Link
                    href={`/projects/${thread.project.id}`}
                    className={cn('ml-2', SECONDARY_LINK_CLASSES)}
                    data-testid="chat-panel-project-link"
                  >
                    {t('chat.panel.project.open')}
                  </Link>
                </>
              )}
            </dd>
          </div>
          <div className={ROW_CLASSES}>
            <dt className={KEY_CLASSES}>{t('chat.panel.counterparty')}</dt>
            <dd className={VALUE_CLASSES} data-testid="chat-panel-counterparty">
              {thread.counterpartyName ?? t('chat.thread.unknownName')}
            </dd>
          </div>
          <div className={ROW_CLASSES}>
            <dt className={cn(KEY_CLASSES, 'self-start pt-2')}>{t('chat.panel.participants')}</dt>
            <dd>
              <ul className="flex flex-col gap-2" data-testid="chat-panel-participants">
                {thread.participants.map((participant, index) => (
                  <li
                    key={`${String(index)}-${participant.joinedAt}`}
                    className="text-body text-fg"
                    data-testid={`chat-panel-participant-${String(index)}`}
                  >
                    <span>{participant.companyName ?? t('chat.thread.unknownName')}</span>
                    <span className="ml-2 text-micro text-fg-muted">
                      {participant.isHost
                        ? t('chat.panel.participant.host')
                        : t('chat.panel.participant.partner')}
                    </span>
                    <span className="block text-micro text-fg-muted">
                      {`${t('chat.panel.participant.joined')} ${formatDateTimeJst(participant.joinedAt)}`}
                      {participant.leftAt === null
                        ? ` / ${t('chat.panel.participant.active')}`
                        : ` / ${t('chat.panel.participant.left')} ${formatDateTimeJst(participant.leftAt)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
