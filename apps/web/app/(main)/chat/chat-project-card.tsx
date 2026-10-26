// apps/web/app/(main)/chat/chat-project-card.tsx
// ✅ 2026-10-23（チャットレーン・紺野）: 発言の中の案件カード（`docs/04` §S-031「案件を貼る」）。
//
// 🔴 このカードが守るもの
//   ① 🔴 **見る人の権限で描く。** 値はサーバが見る人の RLS で読み直したもの（`lib/chat/project-cards.ts`）。
//      読めなければ `{ visible: false }` しか届かず、ここは「表示できません」とだけ出す（案件名も ID も無い）。
//   ② 🔴 **単価・エンド企業名を出さない**（カードの型にそもそも無い）。出すのは 案件名・状態・開始時期・
//      勤務地 / リモート・必須の要件・尚可の件数と、案件詳細へのリンク（ホストも取引先も同じ案件詳細の画面）。
//   ③ 「条件を引用」は投稿できる人にだけ描く（押せないボタンを置かない）。引用するのは要件だけ。
// 🔴 `@ses/db` / `@ses/i18n` を値 import しない（会話の島から使う。語は `messages` で受け取る）。
import Link from 'next/link';
import { Badge, Button, CHAT_BUBBLE_MAX_WIDTH_CLASS, Icon, SECONDARY_LINK_CLASSES, StatusBadge, cn } from '@ses/ui';
import {
  chatProjectConditionsQuote,
  chatProjectHref,
  chatProjectLocationText,
  chatProjectStartText,
  chatRequirementText,
} from '../../../lib/chat/project-card-text';
import type { ChatAttachedProjectView } from '../../../lib/chat/views';
import type { ChatConversationMessages } from './chat-props';

/** 状態の札が描ける値（`StatusBadge` の `project` の 2 値）。それ以外は札を描かず語だけにする。 */
const PROJECT_BADGE_STATES = ['OPEN', 'CLOSED'] as const;
type ProjectBadgeState = (typeof PROJECT_BADGE_STATES)[number];

function isProjectBadgeState(value: string): value is ProjectBadgeState {
  return (PROJECT_BADGE_STATES as readonly string[]).includes(value);
}

export type ChatProjectCardProps = {
  readonly messageId: string;
  readonly project: ChatAttachedProjectView;
  readonly labels: ChatConversationMessages['projectCard'];
  /** 「条件を引用」を押したとき（投稿できる人にだけ渡す。渡さなければボタンを描かない）。 */
  readonly onQuote?: (quote: string) => void;
};

export function ChatProjectCard({ messageId, project, labels, onQuote }: ChatProjectCardProps) {
  if (!project.visible) {
    return (
      <p
        className="m-0 w-fit rounded-lg border border-border bg-bg-subtle px-3 py-2 text-xs text-fg-muted"
        data-testid={`chat-message-project-hidden-${messageId}`}
      >
        {labels.hidden}
      </p>
    );
  }
  const quote = chatProjectConditionsQuote(project, labels);
  const statusLabel = labels.statuses[project.status] ?? labels.none;
  return (
    <article
      aria-label={`${labels.label} ${project.name}`}
      className={cn('flex w-full flex-col gap-2 rounded-lg border border-border bg-bg p-3', CHAT_BUBBLE_MAX_WIDTH_CLASS)}
      data-testid={`chat-message-project-${messageId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="briefcase" className="text-fg-muted" />
        <span className="text-xs text-fg-muted">{labels.label}</span>
        {isProjectBadgeState(project.status) ? (
          <StatusBadge entity="project" state={project.status} label={statusLabel} />
        ) : (
          <span className="text-xs text-fg-muted">{statusLabel}</span>
        )}
      </div>
      <p className="m-0 text-body font-bold break-words text-fg" data-testid={`chat-message-project-name-${messageId}`}>
        {project.name}
      </p>
      <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          <span className="text-fg-muted">{labels.start}</span> <span className="text-fg">{chatProjectStartText(project, labels)}</span>
        </span>
        <span>
          <span className="text-fg-muted">{labels.location}</span>{' '}
          <span className="text-fg">{chatProjectLocationText(project, labels)}</span>
        </span>
      </p>
      {project.mustRequirements.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-fg-muted">{labels.must}</span>
          <ul className="m-0 flex list-none flex-wrap gap-1 p-0" data-testid={`chat-message-project-must-${messageId}`}>
            {project.mustRequirements.map((requirement, index) => (
              <li key={index}>
                <Badge variant="neutral">{chatRequirementText(requirement, labels)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* 尚可は件数に畳む（中身は「条件を引用」と案件詳細で見る）。 */}
      {project.niceRequirements.length === 0 ? null : (
        <p className="m-0 text-xs text-fg-muted" data-testid={`chat-message-project-nice-${messageId}`}>
          {`${labels.nice} ${String(project.niceRequirements.length)} ${labels.countUnit}`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={chatProjectHref(project.id)}
          className={SECONDARY_LINK_CLASSES}
          data-testid={`chat-message-project-open-${messageId}`}
        >
          {labels.open}
        </Link>
        {onQuote === undefined || quote === '' ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            // ✅ 2026-10-26（Codex のレビュー）: スマホでは押せる大きさを 44px にする。
            className="h-11 md:h-8"
            onClick={() => onQuote(quote)}
            data-testid={`chat-message-project-quote-${messageId}`}
          >
            {labels.quote}
          </Button>
        )}
      </div>
    </article>
  );
}
