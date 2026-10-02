// apps/web/app/_components/ui-overlays.render.test.tsx
// 🔴 `T-22-03` の overlay 6 部品（`@ses/ui/client`）の**描画**テスト（`SP-22` §6 の「新部品の
//    render テスト」）。規約が守られていることを固定する最小限だけを見る。
//
// ============================================================================
// なぜ `apps/web` に置くのか（置き場所の作法）
// ============================================================================
// 本リポジトリの render テストは **`apps/*/app/**/*.render.test.tsx`** に置く
// （`vitest.config.ts` の `include` がこの命名だけを `app/**` から拾う。41 本が実在する）。
// `tests/static/**` は `.test.ts` だけを拾うので JSX を書けず、`packages/ui` 側は
// `*.test.ts` を置くと `tsc -p packages/ui/tsconfig.json` の出力（`dist/`）に混ざる。
// 🔴 **画面ファイルは 1 つも触っていない**（本ファイルはテストであり、`collectSourceFiles` は
//    `*.test.tsx` を走査対象から外す）。
//
// 既存の `*.render.test.tsx` と同じ流儀（`react-dom/server` の `renderToStaticMarkup` +
// `createElement`。**新規依存を足さない**。`environment-banner.render.test.tsx` と同じ）。
//
// ============================================================================
// 🔴 何が観測でき、何が観測できないか（読み違えないこと）
// ============================================================================
// `Dialog` / `Drawer` / `DropdownMenu` / `Tooltip` の**開いた状態**は Radix の `Portal`
// （`createPortal`）に載る。`react-dom/server` には `document` が無いため Portal は
// **サーバ描画では何も出さない**（実測）。したがってここで観測できるのは次の 2 つである。
//
//   ① 🔴 **閉じているときに DOM に痕跡を 1 つも残さない**（`docs/04` §3.1-4 の
//      「出さない項目は DOM に描かない」と同じ規律。`hidden` / `display:none` で隠す実装なら
//      ここで落ちる）。
//   ② **Portal を使わない 2 部品（`Tabs` / `Toast`）は全部描ける**ので、`role` / `aria-*` /
//      件数の上限 / 文言の流し込みまで検証する。
//
// 開いた状態の**型の規約**（`Drawer` に実行系を置けない / `Dialog` の本文が `string`）は
// `tests/static/ui-overlay-contract.test.ts` が AST で固定している（本ファイルと重複させない。
// `docs/05` §17.4）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Dialog,
  Drawer,
  DropdownMenu,
  TABS_MAX_ITEMS,
  Tabs,
  Toast,
  Tooltip,
  type DropdownMenuItems,
  type TabsItems,
} from '@ses/ui/client';

const SUBJECT = { href: '/proposals/p1', label: '提案を開く' } as const;

// ============================================================================
// ① 閉じているときに DOM へ痕跡を残さない
// ============================================================================
describe('🔴 overlay は閉じているとき DOM に痕跡を残さない（docs/04 §3.1-4 と同じ規律）', () => {
  it('`Dialog` は `open: false` で何も描かない', () => {
    const markup = renderToStaticMarkup(
      createElement(Dialog, {
        open: false,
        onOpenChange: () => undefined,
        title: '公開を解除しますか',
        body: '解除すると、この取引先からは案件が見えなくなります。',
        confirm: null,
        cancelLabel: 'キャンセル',
      }),
    );
    expect(markup).toBe('');
  });

  it('`Drawer` は `open: false` で何も描かない（要約も履歴も DOM に出ない）', () => {
    const markup = renderToStaticMarkup(
      createElement(Drawer, {
        open: false,
        onOpenChange: () => undefined,
        title: '提案の承認待ち',
        items: [{ label: '相手', value: '共有候補（匿名）' }],
        history: ['2026-09-30 10:00 ゲート通過'],
        historyLabel: '直近の履歴',
        detailLink: { href: '/proposals/p1/approve', label: '承認画面へ' },
        closeLabel: '閉じる',
      }),
    );
    expect(markup).toBe('');
    // 🔴 「隠しただけ」ではないことを、値そのもので確かめる。
    expect(markup).not.toContain('共有候補');
    expect(markup).not.toContain('ゲート通過');
  });

  it('`DropdownMenu` はトリガだけを描き、項目を DOM に出さない', () => {
    const items = [
      { kind: 'link', label: '詳細を開く', href: '/x' },
      { kind: 'action', label: '複製する', onSelect: () => undefined },
    ] as const satisfies DropdownMenuItems;
    const markup = renderToStaticMarkup(
      createElement(DropdownMenu, {
        trigger: createElement('button', { type: 'button' }, 'その他'),
        items,
      }),
    );
    expect(markup).toContain('その他');
    expect(markup).not.toContain('詳細を開く');
    expect(markup).not.toContain('複製する');
  });

  it('`Tooltip` は対象だけを描き、補足を DOM に出さない（触端末で開けない場所に判断材料を置かない）', () => {
    const markup = renderToStaticMarkup(
      createElement(Tooltip, {
        content: '満了 60 日前に自動起票されます',
        children: createElement('span', null, '延長確認'),
      }),
    );
    expect(markup).toContain('延長確認');
    expect(markup).not.toContain('満了 60 日前');
  });
});

// ============================================================================
// ② `Tabs` — 5 つ以上に増やせない / 状態を Radix が出す
// ============================================================================
function tabsMarkup(items: TabsItems): string {
  return renderToStaticMarkup(createElement(Tabs, { items, label: '面の切替' }));
}

const FOUR_TABS = [
  { value: 'a', label: '基本情報', content: 'A' },
  { value: 'b', label: '経験内容', content: 'B' },
  { value: 'c', label: 'スキルシート', content: 'C' },
  { value: 'd', label: '提案履歴', content: 'D' },
] as const satisfies TabsItems;

describe('🔴 `Tabs`（docs/04 §5-13 / §10.3）', () => {
  it('上限は 4 である（「5 つ以上に増やさない」= 5 も含む）', () => {
    expect(TABS_MAX_ITEMS).toBe(4);
  });

  it('`role="tablist"` と `aria-label` を Radix が出し、4 つのタブを描く（自作していない）', () => {
    const markup = tabsMarkup(FOUR_TABS);
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="面の切替"');
    expect((markup.match(/role="tab"/g) ?? []).length).toBe(4);
    for (const item of FOUR_TABS) expect(markup).toContain(item.label);
  });

  it('1 つ目が選択され、選択されていない面の中身は描かれない', () => {
    const markup = tabsMarkup(FOUR_TABS);
    expect(markup).toContain('aria-selected="true"');
    expect((markup.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect(markup).toContain('>A<');
    expect(markup).not.toContain('>B<');
  });

  it('🔴 5 件目を（キャストで）渡すと落ちる。黙って 5 件目を捨てない（`CLAUDE.md` §4.2 と同じ立て方）', () => {
    const five = [...FOUR_TABS, { value: 'e', label: '5 つ目', content: 'E' }] as unknown as TabsItems;
    expect(() => tabsMarkup(five)).toThrow(/タブは 4 つまで/);
  });

  it('🔴 選択と hover の見え方が別である（`data-[state=active]` と `hover:` が同じ語でない）', () => {
    const markup = tabsMarkup(FOUR_TABS);
    // §7.10: selected は maintained（ブランド色）、hover は transient（面を 1 段暗く）。
    expect(markup).toContain('data-[state=active]:text-brand');
    expect(markup).toContain('hover:bg-bg-subtle');
    expect(markup).not.toContain('hover:text-brand');
  });
});

// ============================================================================
// ③ `Toast` — 「受付」を伝え、Toast だけで終わらせない
// ============================================================================
function toastMarkup(overrides: { readonly open?: boolean; readonly kind?: 'accepted' | 'completed' } = {}): string {
  return renderToStaticMarkup(
    createElement(Toast, {
      open: overrides.open ?? true,
      kind: overrides.kind ?? 'accepted',
      message: '送信を受け付けました',
      kindLabel: '受付',
      subject: SUBJECT,
      dismissLabel: '閉じる',
      onDismiss: () => undefined,
    }),
  );
}

describe('🔴 `Toast`（docs/04 §5-13 / §4.4）', () => {
  it('`open: false` で何も描かない', () => {
    expect(toastMarkup({ open: false })).toBe('');
  });

  it('🔴 live region は `role="status"` + `aria-live="polite"` である（割り込まない / 自作しない）', () => {
    const markup = toastMarkup();
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    // 🔴 エラーの経路にしないため `role="alert"` / `assertive` を使わない（§5-13）。
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain('assertive');
  });

  it('🔴 対象への遷移が必ず描かれる（Toast だけで完了を伝えない）', () => {
    const markup = toastMarkup();
    expect(markup).toContain(`href="${SUBJECT.href}"`);
    expect(markup).toContain(SUBJECT.label);
  });

  it('種別は `data-toast-kind` の語で表し、色で表さない（§7.4 の意味の割り当てを増やさない）', () => {
    expect(toastMarkup({ kind: 'accepted' })).toContain('data-toast-kind="accepted"');
    expect(toastMarkup({ kind: 'completed' })).toContain('data-toast-kind="completed"');
    // 🔴 `--color-danger` は `SUBMIT_FAILED` / `SEND_FAILED` / `SUSPENDED` だけの色（§7.4 / §7.9）。
    expect(toastMarkup()).not.toContain('danger');
  });

  it('🔴 影は overlay の面だけが持つ（§7.9。`shadow-overlay` が 1 語だけ出る）', () => {
    const markup = toastMarkup();
    expect((markup.match(/shadow-/g) ?? []).length).toBe(1);
    // ✅ 2026-10-02: `docs/04` §7.9 改訂 23 で影に**名前**が付いた（`shadow-md` → `shadow-overlay`）。
    //    🔴 **値は Tailwind 既定の `--shadow-md` と同一であり、見た目は 1px も変わっていない**
    //    （`tests/static/design-tokens.test.ts` が `node_modules/tailwindcss/theme.css` と突き合わせて固定する）。
    //    🔴 **「1 語だけ」という検査の強さは変えていない。**
    expect(markup).toContain('shadow-overlay');
  });
});
