'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { NumberedPagination, Select } from '@ses/ui';
import type { ProjectPaginationModel } from '../../../lib/projects/pagination';

export function ProjectPagination({model}:{readonly model:ProjectPaginationModel}) {
  const router = useRouter();
  const [pending,startTransition] = useTransition();
  const [error,setError] = useState(false);
  function navigate(href:string):void {
    if(pending)return;
    setError(false);
    startTransition(()=>{try{router.push(href,{scroll:false});}catch{setError(true);}});
  }
  return <footer className="flex flex-col gap-3 border-t border-border px-4 py-3" aria-busy={pending} data-testid="project-list-paging">
    <div className="flex flex-wrap items-center justify-between gap-3 text-cell text-fg-muted">
      <label className="flex flex-wrap items-center gap-2">
        {model.sizeLabel}
        <Select className="w-auto tabular-nums" value={String(model.limit)} disabled={pending} onChange={event=>{const option=model.sizes.find(item=>item.value===Number(event.currentTarget.value));if(option)navigate(option.href);}} data-testid="project-list-page-size">
          {model.sizes.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
      </label>
      <span className="tabular-nums" data-testid="project-list-page-summary">{model.range}</span>
    </div>
    <NumberedPagination {...model} busy={pending} onNavigate={navigate}/>
    {pending ? <p className="m-0 text-center text-xs text-fg-muted" role="status">{model.loading}</p> : null}
    {error ? <p className="m-0 text-xs text-danger" role="alert">{model.failed}</p> : null}
  </footer>;
}
