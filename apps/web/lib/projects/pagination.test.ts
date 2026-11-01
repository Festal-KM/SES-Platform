import { describe,expect,it } from 'vitest';
import { pageNumbers,projectPageHref,projectPagination } from './pagination';

describe('案件一覧の番号と範囲',()=>{
  it('最後のページ・0件を実件数から計算する',()=>{
    expect(projectPagination({limit:50,page:3},120,20).range).toBe('120件中 101–120件を表示');
    const empty=projectPagination({limit:50},0,0);
    expect(empty.range).toBe('0件中 0–0件を表示');
    expect([empty.first,empty.previous,empty.next,empty.final]).toEqual([null,null,null,null]);
  });
  it('端・省略・現在ページを表示する',()=>{
    expect(pageNumbers(1,3)).toEqual([1,2,3]);
    expect(pageNumbers(6,12)).toEqual([1,null,4,5,6,7,8,null,12]);
    expect(pageNumbers(12,12)).toContain(12);
  });
  it('表示件数変更は先頭へ戻し、検索条件・タブ・列表示を保持する',()=>{
    const query={limit:50,page:3,q:'Java',status:'OPEN' as const,skills:['01930000-0000-7000-8000-000000000001'],keywordGroups:JSON.stringify([{mode:'OR',terms:['Java','SQL']}])};
    const model=projectPagination(query,120,20,[],'COPY');
    const target=new URL(model.sizes.find(item=>item.value===25)!.href,'https://app.test');
    expect(target.searchParams.get('limit')).toBe('25');
    expect(target.searchParams.has('page')).toBe(false);
    expect(target.searchParams.get('q')).toBe('Java');
    expect(target.searchParams.get('keywordGroups')).toBe(query.keywordGroups);
    expect(target.searchParams.get('panelTab')).toBe('COPY');
    expect(new URL(projectPageHref(query,2),'https://app.test').searchParams.get('page')).toBe('2');
  });
});
