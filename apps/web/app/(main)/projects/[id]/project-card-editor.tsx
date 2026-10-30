'use client';

import { useEffect,useRef,useState,useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { t,type MessageKey } from '@ses/i18n';
import { Button,Card,Checkbox,Field,Icon,IconButton,Input,Radio,SegmentedControl,Select,Table,TableBody,TableCell,TableHead,TableHeader,TableRow,Textarea,cn } from '@ses/ui';
import { Dialog,Tooltip } from '@ses/ui/client';
import { PROJECT_CARD_FIELDS,projectCardPatch,type CardRequirement,type ProjectCardId,type ProjectCardValues } from '../../../../lib/projects/card-fields';
import type { ProjectCardData } from '../../../../lib/projects/card-data';

type Option={value:string;label:string};
export type ProjectCardOptions=Record<string,readonly Option[]>;
const label=(key:string)=>t(`projects.cards.field.${key}` as MessageKey);
const title=(card:string)=>t(`projects.cards.title.${card}` as MessageKey);
const numeric=new Set(['unitPrice','internalUnitPrice','settlementMinHours','settlementMaxHours','paymentSiteDays','utilizationRate','headcount']);
const dates=new Set(['startDate','endDate']);
const multiline=new Set(['publicSummary','publicMemo','remarks','copySummary']);
const required=new Set(['name','status','sourceKind','headcount']);

export function ProjectCardEditor({initial,options,canEdit}:{readonly initial:ProjectCardData;readonly options:ProjectCardOptions;readonly canEdit:boolean}){
  const router=useRouter();const [refreshing,startRefresh]=useTransition();
  const [data,setData]=useState(initial);const [active,setActive]=useState<ProjectCardId|null>(null);
  const [draft,setDraft]=useState<ProjectCardValues>(initial.values);const [requirements,setRequirements]=useState<readonly CardRequirement[]>(initial.requirements);
  const [nextCard,setNextCard]=useState<ProjectCardId|null>(null);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [saving,setSaving]=useState(false);const sending=useRef(false);
  useEffect(()=>{setData(initial);},[initial]);
  const baseline={...data.values,copySummary:data.values.copySummary||data.autoSummary};
  const dirty=active!==null&&(PROJECT_CARD_FIELDS[active].some(key=>JSON.stringify(draft[key]??'')!==JSON.stringify(baseline[key]??''))||(active==='content'&&JSON.stringify(requirements)!==JSON.stringify(data.requirements)));
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  function begin(card:ProjectCardId):void{setDraft({...baseline});setRequirements(data.requirements);setActive(card);setError('');setNotice('');setNextCard(null);}
  function request(card:ProjectCardId):void{if(sending.current||refreshing)return;if(active&&dirty){setNextCard(card);return;}begin(card);}
  useEffect(()=>{const edit=(event:Event)=>{const target=(event as CustomEvent<{id:string;card:ProjectCardId}>).detail;if(target.id===initial.id&&canEdit)request(target.card);};window.addEventListener('project-card-edit',edit);return()=>window.removeEventListener('project-card-edit',edit);});
  function update(key:string,value:string|readonly string[]):void{setDraft(current=>({...current,[key]:value}));setError('');}
  async function save(card:ProjectCardId):Promise<void>{
    if(sending.current)return;
    let patch:Record<string,unknown>;
    try{patch=projectCardPatch(card,baseline,draft,data.requirements,requirements);}catch(reason){setError(`${label(reason instanceof Error?reason.message:'name')}${t('projects.cards.invalid')}`);return;}
    if(!Object.keys(patch).length){setActive(null);return;}
    sending.current=true;setSaving(true);setError('');
    try{const response=await fetch(`/api/projects/${data.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});if(!response.ok)throw new Error(String(response.status));
      setData(current=>({...current,values:{...current.values,...Object.fromEntries(PROJECT_CARD_FIELDS[card].map(key=>[key,draft[key]??'']))},requirements:card==='content'?requirements:current.requirements}));
      setActive(null);setNotice(t('projects.cards.saved'));startRefresh(()=>router.refresh());
    }catch{setError(t('projects.cards.failed'));}finally{sending.current=false;setSaving(false);}
  }
  function display(key:string):string{
    const value=key==='copySummary'?(data.values.copySummary||data.autoSummary):data.values[key];
    if(Array.isArray(value))return value.map(item=>options[key]?.find(option=>option.value===item)?.label??item).join(' / ')||t('projects.detail.valueNone');
    const text=typeof value==='string'?value:'';if(!text)return t('projects.detail.valueNone');
    if(numeric.has(key))return `${Number(text).toLocaleString('ja-JP')}${t(key==='unitPrice'||key==='internalUnitPrice'?'projects.cards.yenMonth':key==='utilizationRate'?'projects.cards.percent':key==='headcount'?'projects.headcount.unit':key==='paymentSiteDays'?'projects.cards.days':'projects.cards.hours')}`;
    return options[key]?.find(option=>option.value===text)?.label??text;
  }
  function control(key:string){
    const value=draft[key]??'';const text=typeof value==='string'?value:'';
    const attrs={'aria-label':label(key),'data-testid':`project-card-input-${key}`};
    if(key==='developmentPhases')return <div className="flex flex-wrap gap-3">{options[key]?.map(option=><label key={option.value} className="flex items-center gap-2 text-cell"><Checkbox checked={Array.isArray(value)&&value.includes(option.value)} onChange={event=>{const checked=event.currentTarget.checked;const current=Array.isArray(value)?value:[];update(key,checked?[...current,option.value]:current.filter(item=>item!==option.value));}} data-testid={`project-card-phase-${option.value}`}/>{option.label}</label>)}</div>;
    if(key==='developmentMethod')return <SegmentedControl value={text} options={options[key]??[]} label={label(key)} onChange={value=>update(key,value)} testIdPrefix="project-card-method-"/>;
    if(key==='parallelOk')return <div className="flex flex-wrap gap-3">{options[key]?.map(option=><label key={option.value} className="flex items-center gap-2 text-cell"><Radio name="card-parallel" value={option.value} checked={text===option.value} onChange={()=>update(key,option.value)} data-testid={`project-card-parallel-${option.value||'unset'}`}/>{option.label}</label>)}</div>;
    if(multiline.has(key))return <Textarea {...attrs} rows={key==='copySummary'?8:3} value={text} onChange={event=>update(key,event.currentTarget.value)}/>;
    if(options[key])return <Select {...attrs} required={required.has(key)} value={text} onChange={event=>update(key,event.currentTarget.value)}>{options[key].map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</Select>;
    return <Input {...attrs} type={numeric.has(key)?'number':dates.has(key)?'date':'text'} required={required.has(key)} value={text} min={key==='headcount'||key==='utilizationRate'?1:numeric.has(key)?0:undefined} max={key==='utilizationRate'?100:undefined} step={numeric.has(key)?1:undefined} onChange={event=>update(key,event.currentTarget.value)}/>;
  }
  function requirementBlock(kind:'MUST'|'NICE',editing:boolean){
    const rows=(editing?requirements:data.requirements).filter(row=>row.kind===kind);
    return <div className="flex min-w-0 flex-col gap-2" data-testid={`project-detail-requirements-${kind}`}><h3 className="m-0 text-body font-semibold">{t(kind==='MUST'?'projects.cards.required':'projects.cards.preferred')}</h3>
      <Table><TableHeader><TableRow>{['skill','years','freeText'].map(key=><TableHead key={key}>{t(`projects.cards.requirement.${key}` as MessageKey)}</TableHead>)}{editing?<TableHead>{t('projects.cards.remove')}</TableHead>:null}</TableRow></TableHeader><TableBody>{rows.map(row=><TableRow key={row.key}>
        <TableCell whitespace="normal">{editing?<Select aria-label={t('projects.cards.requirement.skill')} value={row.skillId} onChange={event=>{const value=event.currentTarget.value;setRequirements(current=>current.map(item=>item.key===row.key?{...item,skillId:value}:item));}} data-testid={`project-card-skill-${row.key}`}><option value="">{t('projects.detail.valueNone')}</option>{options.skills?.map(skill=><option key={skill.value} value={skill.value}>{skill.label}</option>)}</Select>:options.skills?.find(skill=>skill.value===row.skillId)?.label??t('projects.detail.valueNone')}</TableCell>
        <TableCell>{editing?<Input type="number" min={0} max={99} step="0.1" aria-label={t('projects.cards.requirement.years')} value={row.requiredYears} onChange={event=>{const value=event.currentTarget.value;setRequirements(current=>current.map(item=>item.key===row.key?{...item,requiredYears:value}:item));}} data-testid={`project-card-years-${row.key}`}/>:row.requiredYears||t('projects.detail.valueNone')}</TableCell>
        <TableCell whitespace="normal">{editing?<Textarea rows={2} aria-label={t('projects.cards.requirement.freeText')} value={row.freeText} onChange={event=>{const value=event.currentTarget.value;setRequirements(current=>current.map(item=>item.key===row.key?{...item,freeText:value}:item));}} data-testid={`project-card-requirement-text-${row.key}`}/>:row.freeText||t('projects.detail.valueNone')}</TableCell>
        {editing?<TableCell><Tooltip content={t('projects.cards.remove')}><IconButton variant="ghost" size="sm" icon={<Icon name="trash"/>} aria-label={t('projects.cards.remove')} onClick={()=>setRequirements(current=>current.filter(item=>item.key!==row.key))} data-testid={`project-card-requirement-remove-${row.key}`}/></Tooltip></TableCell>:null}
      </TableRow>)}</TableBody></Table>
      {editing?<Button variant="secondary" size="sm" className="self-start" onClick={()=>setRequirements(current=>[...current,{key:crypto.randomUUID(),kind,skillId:'',freeText:'',requiredYears:''}])} data-testid={`project-card-requirement-add-${kind}`}><Icon name="plus"/>{t('projects.cards.addRequirement')}</Button>:rows.length===0?<p className="m-0 text-cell text-fg-muted">{t('projects.detail.valueNone')}</p>:null}
    </div>;
  }
  function card(id:ProjectCardId){const editing=active===id;return <Card id={`project-detail-card-${id}`} className={cn('min-w-0 overflow-hidden',editing?'border-brand':undefined)} data-testid={`project-detail-card-${id}`} data-editing={editing?'true':'false'}>
    <form data-testid={id==='content'?'project-detail-requirements':id==='working'?'project-detail-conditions':id==='commercial'?'project-detail-commerce':`project-card-form-${id}`} onSubmit={event=>{event.preventDefault();void save(id);}}><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><h2 className="m-0 text-lg font-semibold">{title(id)}</h2><div className="flex items-center gap-1">{canEdit?(editing?<>
      <Tooltip content={t('projects.search.cancel')}><IconButton variant="ghost" size="sm" icon={<Icon name="x"/>} aria-label={t('projects.search.cancel')} disabled={saving} onClick={()=>{setActive(null);setError('');}} data-testid={`project-card-cancel-${id}`}/></Tooltip>
      <Tooltip content={t('projects.cards.save')}><IconButton type="submit" variant="ghost" size="sm" icon={<Icon name="save"/>} aria-label={t('projects.cards.save')} disabled={saving} aria-busy={saving} data-testid={`project-card-save-${id}`}/></Tooltip>
    </>:<Tooltip content={t('projects.cards.edit')}><IconButton variant="ghost" size="sm" icon={<Icon name="pencil"/>} aria-label={t('projects.cards.edit')} disabled={saving||refreshing} onClick={()=>request(id)} data-testid={id==='basic'?'project-detail-edit-link':`project-card-edit-${id}`}/></Tooltip>):null}</div></div>
    <div className="flex min-w-0 flex-col gap-4 p-4">{PROJECT_CARD_FIELDS[id].map(key=>editing?<Field key={key} as="div" label={<>{label(key)}{required.has(key)?<span className="text-danger" aria-hidden="true">{t('projects.cards.requiredMark')}</span>:null}</>}>{control(key)}</Field>:<div key={key} className="grid min-w-0 grid-cols-1 gap-2 text-body sm:grid-cols-3"><span className="text-fg-muted">{label(key)}</span><span className="min-w-0 whitespace-pre-wrap break-words sm:col-span-2" data-testid={key==='publicSummary'?'project-detail-public-summary':`project-card-value-${key}`}>{display(key)}</span></div>)}
      {id==='content'?<>{requirementBlock('MUST',editing)}{requirementBlock('NICE',editing)}</>:null}
      {id==='commercial'?<p className="m-0 text-xs text-fg-muted" data-testid="project-detail-commerce-notice">{t('projects.cards.moneyHint')}</p>:null}
      {id==='notes'&&editing?<p className="m-0 text-xs text-fg-muted">{t('projects.cards.summaryHint')}</p>:null}
      {editing&&error?<p role="alert" className="m-0 text-cell text-danger" data-testid="project-card-error">{error}</p>:null}
    </div></form></Card>;}
  return <div className="flex flex-col gap-4" data-testid="project-card-editor">
    {notice?<p role="status" className="m-0 text-cell text-fg-muted">{notice}</p>:null}
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2"><div className="flex min-w-0 flex-col gap-4">{card('basic')}{card('content')}</div><div className="flex min-w-0 flex-col gap-4">{card('development')}{card('working')}{card('commercial')}</div></div>
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">{card('notes')}{card('company')}
      <Card className="min-w-0 p-4" data-testid="project-detail-card-management"><h2 className="mb-3 text-lg font-semibold">{title('management')}</h2><dl className="flex flex-col gap-3 text-cell">{[['id',data.id],['createdAt',data.createdAt],['updatedAt',data.updatedAt],['origin',data.origin]].map(([key,value])=><div key={key} className="grid min-w-0 grid-cols-3 gap-2"><dt className="text-fg-muted">{label(key!)}</dt><dd className="m-0 min-w-0 break-all col-span-2">{value}</dd></div>)}</dl></Card>
      <Card className="min-w-0 p-4" data-testid="project-detail-card-related"><h2 className="mb-3 text-lg font-semibold">{title('related')}</h2><div className="flex flex-col gap-3 text-body"><a href="#project-detail-visibility">{t('projects.cards.visibility')}</a><a href="#project-detail-proposals">{t('projects.cards.proposals')}</a><a href={`/projects/${data.id}/candidates`}>{t('projects.detail.candidates.open')}</a></div></Card>
    </div>
    <Dialog open={nextCard!==null} onOpenChange={open=>{if(!open)setNextCard(null);}} title={t('projects.cards.discardTitle')} body={t('projects.cards.discardBody')} cancelLabel={t('projects.cards.continue')} data-testid="project-card-discard-dialog" confirm={<Button variant="primary" onClick={()=>{if(nextCard)begin(nextCard);}} data-testid="project-card-discard-confirm">{t('projects.cards.discard')}</Button>}/>
  </div>;
}

export function ProjectCardEditTrigger({id,label}:{readonly id:string;readonly label:string}){return <Button variant="secondary" size="sm" onClick={()=>window.dispatchEvent(new CustomEvent('project-card-edit',{detail:{id,card:'content'}}))} data-testid="project-detail-publish-auto-revoked-fix">{label}</Button>;}
