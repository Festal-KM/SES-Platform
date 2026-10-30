import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it,vi } from 'vitest';
import type { ProjectCardData } from '../../../../lib/projects/card-data';
import { ProjectCardEditor } from './project-card-editor';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
const initial:ProjectCardData={id:'own-project',values:{name:'架空案件',utilizationRate:'80',copySummary:''},requirements:[],autoSummary:'自動サマリ',assigneeName:null,createdAt:'2026-10-30',updatedAt:'2026-10-30',origin:'—'};
describe('案件詳細カードの初期表示',()=>{
  it('編集権限があっても最初は全カードを閲覧状態にする',()=>{
    const html=renderToStaticMarkup(createElement(ProjectCardEditor,{initial,options:{},canEdit:true}));
    expect(html).not.toMatch(/<(input|textarea|select)\b/);
    expect(html).not.toContain('data-editing="true"');
    expect(html.match(/data-editing="false"/g)).toHaveLength(7);
    expect(html).toContain('80%');
    expect(html).toContain('自動サマリ');
    expect(html).toContain('project-detail-edit-link');
    expect(html).not.toContain('/edit');
  });
  it('閲覧専用では編集操作を出さない',()=>{
    const html=renderToStaticMarkup(createElement(ProjectCardEditor,{initial,options:{},canEdit:false}));
    expect(html).not.toContain('project-detail-edit-link');
    expect(html).not.toContain('project-card-edit-');
    expect(html).toContain('project-detail-card-management');
    expect(html).toContain('project-detail-card-related');
  });
});
