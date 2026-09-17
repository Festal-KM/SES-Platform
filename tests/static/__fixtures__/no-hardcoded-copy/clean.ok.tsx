// 対照: 直書きなし。コメントに「日本語」と書いても数えない。
import { t } from '@ses/i18n';

type Messages = { readonly close: string; readonly title: string };

export function Screen({ messages, skills, hint }: { messages: Messages; skills: readonly string[]; hint: string }) {
  const separator = '・';
  const testId = 'engineer-row';
  return (
    <section title={messages.title} data-testid={testId} aria-label={t('x.title')}>
      {/* ここはコメントなので「日本語」があっても数えない */}
      <button type="button" aria-label={messages.close}>{t('x.close')}</button>
      <p title={hint}>{skills.join(separator)}</p>
      {skills.length === 0 ? t('x.none') : `${skills.length}`}
    </section>
  );
}
