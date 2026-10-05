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
import { Card, CardContent, CardHeader, CardTitle, SECONDARY_LINK_CLASSES, cn } from '@ses/ui';
import { formatDateTimeJst } from '../../../lib/format/datetime';
import type { ChatThreadDetailView } from '../../../lib/chat/views';

export type ChatThreadPanelProps = {
  readonly thread: ChatThreadDetailView;
};

export function ChatThreadPanel({ thread }: ChatThreadPanelProps) {
  return (
    <Card data-testid="chat-panel">
      <CardHeader>
        <CardTitle>{t('chat.panel.heading')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-4">
          <div>
            <dt className="text-xs text-fg-muted">{t('chat.panel.target')}</dt>
            <dd className="text-body text-fg" data-testid="chat-panel-target">
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
          <div>
            <dt className="text-xs text-fg-muted">{t('chat.panel.counterparty')}</dt>
            <dd className="text-body text-fg" data-testid="chat-panel-counterparty">
              {thread.counterpartyName ?? t('chat.thread.unknownName')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">{t('chat.panel.participants')}</dt>
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
