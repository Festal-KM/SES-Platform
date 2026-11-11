import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@ses/i18n';
import { ProjectVisibilityPopup } from './project-visibility-popup';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('公開先の選択', () => {
  it('全体・一部の操作を表示し、未公開なら解除操作を出さない', () => {
    const html = renderToStaticMarkup(createElement(ProjectVisibilityPopup, {
      projectId: 'project', denialMessage: null,
      choices: [{ partnerCompanyId: 'partner', name: '取引先', suspended: false, publishedOn: null }],
    }));
    expect(html).toContain(t('projects.visibilitySettings.popup.all'));
    expect(html).toContain(t('projects.visibilitySettings.popup.partial'));
    expect(html).not.toContain(t('projects.visibilitySettings.popup.allScope'));
    expect(html).not.toContain(t('projects.visibilitySettings.popup.details'));
    expect(html).not.toContain('project-visibility-unpublish');
  });

  it('公開済みの取引先があるときは解除操作を出す', () => {
    const html = renderToStaticMarkup(createElement(ProjectVisibilityPopup, {
      projectId: 'project', denialMessage: null,
      choices: [{ partnerCompanyId: 'partner', name: '取引先', suspended: false, publishedOn: '2026-11-11' }],
    }));
    expect(html).toContain('project-visibility-unpublish');
  });
});
