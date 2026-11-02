'use client';

// apps/web/app/(main)/chat/chat-people-picker.tsx
// ✅ 2026-10-30（紺野の決定。F-038 改訂 16 ⑲⑳ / S-031 改訂 47）: 人の選び方を 2 つのタブにする（LINE と同じ）。
//   「会社から探す」= 会社の一覧（自社が先・取引先は社名順）。会社を押すとその会社の人が開く。
//   「名前から探す」= 見える人を名前順（日本語の並び）に 1 列で。
// 連絡先（`f=contacts`。人を押すと「その人との会話」へ）と「新しいグループ」（`f=newgroup`。人を押すと選ぶ / 外す）で同じ部品を使う。
// ✅ 2026-11-01: 「メンバーを追加」（`add=1`）でも使う。いまのメンバーは「参加中」として出し、押せる形にしない（`fixed`）。
//
// 🔴 ここが守るもの
//   ① 母集団は渡された人だけ（`lib/chat/people.ts` が RLS で決めたもの）。ここで人や会社を足さない。
//   ② 一覧の中で表示を消すユーティリティ（`hidden`）を使わない。閉じた会社の人は描かない。
//   ③ 押せないボタンを置かない（`disabled` を使わない）。
//   ④ 文言は持たない（`@ses/i18n` を読まない。呼び出し側のサーバの部品が渡す）。
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Avatar, ROW_HOVER_CLASSES, cn } from '@ses/ui';
import { Tabs } from '@ses/ui/client';
import { displayInitials } from '../../../lib/format/initials';
import { chatHref } from '../../../lib/chat/screen-query';
import { AVATAR_KIND_CLASSES } from './chat-avatar-kind';

export type ChatPickerPerson = {
  readonly userId: string;
  readonly name: string;
  readonly status?: string | null;
};

export type ChatPickerCompany = {
  readonly companyName: string;
  readonly isHost: boolean;
  readonly people: readonly ChatPickerPerson[];
};

export type ChatPeoplePickerTab = 'company' | 'name';
export const CHAT_PEOPLE_PICKER_TAB_DEFAULT: ChatPeoplePickerTab = 'company';

export type ChatPeoplePickerLabels = {
  readonly tabs: string;
  readonly byCompany: string;
  readonly byName: string;
  readonly noMatch: string;
  readonly external: string;
  readonly memberUnit: string;
  /** ✅ 2026-11-01: 「参加中」（`fixed` の人に添える。省略時は「メンバーを追加」以外の画面）。 */
  readonly alreadyIn?: string;
};

type Common = {
  readonly companies: readonly ChatPickerCompany[];
  /** 絞り込みの語（名前。会社のタブでは会社名にも当てる）。空なら全員。 */
  readonly query: string;
  readonly labels: ChatPeoplePickerLabels;
  /** 目印の頭（`chat-contacts` / `chat-new-group`）。 */
  readonly testIdPrefix: 'chat-contacts' | 'chat-new-group' | 'chat-add-members';
  readonly defaultTab?: ChatPeoplePickerTab;
  /** 「会社から探す」の上に置くもの（連絡先の「最近やり取りした人」）。 */
  readonly companyTop?: ReactNode;
};

export type ChatPeoplePickerProps =
  | (Common & { readonly mode: 'link' })
  | (Common & {
      readonly mode: 'select';
      readonly selected: readonly string[];
      readonly onToggle: (userId: string) => void;
      /** 出さない会社（「新しいグループ」で取引先の人を選んだ後の、ほかの取引先）。 */
      readonly hideCompany?: (company: ChatPickerCompany) => boolean;
      /** ✅ 2026-11-01: 既に入っている人（選べない。「参加中」と出す）。 */
      readonly fixed?: readonly string[];
    });

const TAG_CLASSES = 'shrink-0 rounded-xs bg-info-bg px-1 text-xs text-info';

function matches(value: string, needle: string): boolean {
  return value.toLocaleLowerCase('ja').includes(needle);
}

/** 連絡先の 1 人（押すと「その人との会話」へ）。最近やり取りした人の欄（サーバの部品）からも使う。 */
export function ChatContactRow({
  person,
  companyName,
  isHost,
  externalLabel,
  showCompany = true,
}: {
  readonly person: ChatPickerPerson;
  readonly companyName: string;
  readonly isHost: boolean;
  readonly externalLabel: string;
  /** 会社の下に並べるときは会社名を繰り返さない。 */
  readonly showCompany?: boolean;
}) {
  return (
    <li data-testid={`chat-contact-${person.userId}`}>
      <Link
        href={chatHref({ filter: { kind: 'person', userId: person.userId } })}
        className={cn('flex min-h-11 min-w-0 items-center gap-2 rounded-md px-3 py-2', ROW_HOVER_CLASSES)}
        data-testid={`chat-contact-link-${person.userId}`}
      >
        <Avatar size="sm" initials={displayInitials(person.name)} title={person.name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-cell text-fg">{person.name}</span>
          {/* ✅ 2026-10-19（#140）: ひとこと状態（RLS で読めた人の、空でないものだけ）。 */}
          {person.status == null || person.status === '' ? null : (
            <span className="truncate text-xs text-fg-placeholder" data-testid={`chat-contact-status-${person.userId}`}>
              {person.status}
            </span>
          )}
        </span>
        {isHost ? null : <span className={TAG_CLASSES}>{externalLabel}</span>}
        {showCompany ? <span className="shrink-0 truncate text-xs text-fg-muted">{companyName}</span> : null}
      </Link>
    </li>
  );
}

/** ✅ 2026-11-01: 既に入っている人（押せる形にしない。`disabled` のボタンも置かない）。 */
function FixedRow({
  person,
  company,
  externalLabel,
  alreadyIn,
  testIdPrefix,
}: {
  readonly person: ChatPickerPerson;
  readonly company: ChatPickerCompany | null;
  readonly externalLabel: string;
  readonly alreadyIn: string;
  readonly testIdPrefix: string;
}) {
  return (
    <li className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1" data-testid={`${testIdPrefix}-fixed-${person.userId}`}>
      <Avatar initials={displayInitials(person.name)} title={person.name} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-cell text-fg-muted">{person.name}</span>
      </span>
      {company === null ? null : (
        <>
          {company.isHost ? null : <span className={TAG_CLASSES}>{externalLabel}</span>}
          <span className="shrink-0 truncate text-xs text-fg-muted">{company.companyName}</span>
        </>
      )}
      <span className="shrink-0 text-xs text-fg-muted">{alreadyIn}</span>
    </li>
  );
}

function SelectRow({
  person,
  on,
  onToggle,
  company,
  externalLabel,
  testIdPrefix,
}: {
  readonly person: ChatPickerPerson;
  readonly on: boolean;
  readonly onToggle: (userId: string) => void;
  /** 名前のタブでは会社名を添える（会社のタブでは見出しで分かるので `null`）。 */
  readonly company: ChatPickerCompany | null;
  readonly externalLabel: string;
  readonly testIdPrefix: string;
}) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        onClick={() => onToggle(person.userId)}
        className={cn('flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1 text-left', on ? 'bg-brand-bg' : ROW_HOVER_CLASSES)}
        data-testid={`${testIdPrefix}-member-${person.userId}`}
      >
        <Avatar initials={displayInitials(person.name)} title={person.name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-cell text-fg">{person.name}</span>
          {person.status == null || person.status === '' ? null : (
            <span className="truncate text-xs text-fg-placeholder">{person.status}</span>
          )}
        </span>
        {company === null ? null : (
          <>
            {company.isHost ? null : <span className={TAG_CLASSES}>{externalLabel}</span>}
            <span className="shrink-0 truncate text-xs text-fg-muted">{company.companyName}</span>
          </>
        )}
        {/* 選んだかどうか（四角の中の ✓。チェックボックスと同じ形）。色だけに頼らず形でも分ける。 */}
        <span
          aria-hidden="true"
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border text-xs',
            on ? 'border-brand bg-brand text-brand-fg' : 'border-border-strong bg-bg text-bg',
          )}
        >
          ✓
        </span>
      </button>
    </li>
  );
}

export function ChatPeoplePicker(props: ChatPeoplePickerProps) {
  const { companies, query, labels, testIdPrefix, defaultTab = CHAT_PEOPLE_PICKER_TAB_DEFAULT, companyTop } = props;
  // 既定で開くのは自社だけ（取引先が多くても一覧が長くならない）。会社が 1 つなら開いておく。
  const [open, setOpen] = useState<ReadonlySet<number>>(
    () => new Set(companies.flatMap((company, index) => (company.isHost || companies.length === 1 ? [index] : []))),
  );
  const needle = query.trim().toLocaleLowerCase('ja');
  const shown = companies
    .map((company, index) => ({ company, index }))
    .filter(({ company }) => props.mode !== 'select' || props.hideCompany?.(company) !== true);

  function toggleCompany(index: number): void {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function personRow(person: ChatPickerPerson, company: ChatPickerCompany, inCompany: boolean): ReactNode {
    if (props.mode === 'link') {
      return (
        <ChatContactRow
          key={person.userId}
          person={person}
          companyName={company.companyName}
          isHost={company.isHost}
          externalLabel={labels.external}
          showCompany={!inCompany}
        />
      );
    }
    if (props.fixed?.includes(person.userId) === true) {
      return (
        <FixedRow
          key={person.userId}
          person={person}
          company={inCompany ? null : company}
          externalLabel={labels.external}
          alreadyIn={labels.alreadyIn ?? ''}
          testIdPrefix={testIdPrefix}
        />
      );
    }
    return (
      <SelectRow
        key={person.userId}
        testIdPrefix={testIdPrefix}
        person={person}
        on={props.selected.includes(person.userId)}
        onToggle={props.onToggle}
        company={inCompany ? null : company}
        externalLabel={labels.external}
      />
    );
  }

  const noMatch = (
    <p className="m-0 px-3 py-2 text-cell text-fg-muted" data-testid={`${testIdPrefix}-no-match`}>
      {labels.noMatch}
    </p>
  );

  const byCompanyEntries = shown
    .map(({ company, index }) => ({
      company,
      index,
      people: needle === '' || matches(company.companyName, needle) ? company.people : company.people.filter((person) => matches(person.name, needle)),
    }))
    .filter((entry) => entry.people.length > 0);
  const byCompany = (
    <div className="flex flex-col" data-testid={`${testIdPrefix}-by-company`}>
      {needle === '' ? companyTop : null}
      {byCompanyEntries.length === 0 ? noMatch : null}
      {byCompanyEntries.map(({ company, index, people }) => {
        // 絞り込み中は当たった会社をすべて開く（閉じたままだと当たった人が見えない）。
        const expanded = needle !== '' || open.has(index);
        const panelId = `${testIdPrefix}-company-panel-${String(index)}`;
        return (
          <section key={`${company.companyName}-${String(index)}`} data-testid={`${testIdPrefix}-company-${String(index)}`}>
            <h4 className="m-0">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggleCompany(index)}
                className={cn('flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-1 text-left', ROW_HOVER_CLASSES)}
                data-testid={`${testIdPrefix}-company-toggle-${String(index)}`}
              >
                <Avatar
                  size="sm"
                  initials={displayInitials(company.companyName.replace(/^株式会社/, '') || company.companyName)}
                  title={company.companyName}
                  className={AVATAR_KIND_CLASSES.COMPANY}
                />
                <span className="min-w-0 flex-1 truncate text-cell font-normal text-fg">{company.companyName}</span>
                {company.isHost ? null : <span className={TAG_CLASSES}>{labels.external}</span>}
                <span className="shrink-0 text-xs font-normal text-fg-muted">
                  {String(people.length)}
                  {labels.memberUnit}
                </span>
                <span aria-hidden="true" className="w-3 shrink-0 text-xs text-fg-muted">
                  {expanded ? '▾' : '▸'}
                </span>
              </button>
            </h4>
            {expanded ? (
              <ul id={panelId} className="m-0 list-none py-0 pr-0 pl-4">
                {people.map((person) => personRow(person, company, true))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );

  const byNameEntries = shown
    .flatMap(({ company }) => company.people.map((person) => ({ person, company })))
    .filter(({ person }) => needle === '' || matches(person.name, needle))
    .sort((a, b) => a.person.name.localeCompare(b.person.name, 'ja') || (a.person.userId < b.person.userId ? -1 : 1));
  const byName = (
    <div className="flex flex-col" data-testid={`${testIdPrefix}-by-name`}>
      {byNameEntries.length === 0 ? (
        noMatch
      ) : (
        <ul className="m-0 list-none p-0">{byNameEntries.map(({ person, company }) => personRow(person, company, false))}</ul>
      )}
    </div>
  );

  return (
    <Tabs
      label={labels.tabs}
      defaultValue={defaultTab}
      data-testid={`${testIdPrefix}-tabs`}
      items={[
        { value: 'company', label: labels.byCompany, content: byCompany, testId: `${testIdPrefix}-tab-company` },
        { value: 'name', label: labels.byName, content: byName, testId: `${testIdPrefix}-tab-name` },
      ]}
    />
  );
}
