// tests/static/form-method-required.test.ts
// 🔴 **`apps/web/app/**` のすべての `<form>` が `method` か `action` を持つ**ことを構造で固定する。
//
// ============================================================================
// なぜこの検査が要るか（実害が 1 度発生している）
// ============================================================================
// `<form onSubmit={…}>` に **`method` も `action` も無い**と、JS が水和する前（遅い回線・
// モバイル・JS エラー時）に Enter / 送信ボタンで送った送信は、ブラウザの**既定の GET** で
// **現在の URL に入力値をクエリとして付けて**飛ぶ。サインインフォームでは
//
//     GET /signin?email=sales-1%40demo-alpha.example&password=<平文>
//
// になり、**アドレスバー・ブラウザ履歴・サーバのアクセスログ・以後のリクエストの `Referer`**
// に資格情報の平文が残る（`CLAUDE.md` §3.5「シークレット / 資格情報を残さない」の射程）。
// 🔴 `/admin/signin` も同じ形であり、`PLATFORM_OWNER` の資格情報が同じ経路で漏れる。
// これは理論上の話ではなく、UI の再監査（2026-10-03）で**通常の巡回中に 1 度自然発生した**。
//
// ============================================================================
// なぜ `method="post"` で足りるのか（この判断を残す）
// ============================================================================
// ⚠️ `method="post"` は「**JS が死んでいるときに正しく動く**」ことを意味しない。これらの
// フォームの送信先は `fetch` を呼ぶ `onSubmit` であり、POST を受けるハンドラがその URL に
// 無いため、水和前の送信は **405 / 404 になる**。🔴 **それでよい。** この検査の目的は
// 「**資格情報と入力値が URL に残らないこと**」の一点であり、JS 無しでフォームを成立させる
// （Server Actions / プログレッシブエンハンスメント）のは**別の課題**である。混ぜると
// 「どちらも中途半端」になるため、ここでは漏洩経路を塞ぐことだけを担保する。
//
// 既存の検索フォーム（`S-005` / `S-010` / `S-016` / `S-019` / `S-041`）は**元から素の
// `<form method="get" action="…">`** であり、こちらは JS 無しでも正しく動く（意図的な GET。
// 検索条件が URL に載ることがその画面の仕様である）。したがって検査は `post` を強制せず
// **「`method` か `action` のどちらかがある」**ことを求める —— ただし**資格情報・秘密を扱う
// フォームは `method="post"` でなければならない**（③）。
//
// ============================================================================
// 🔴 許可リストを作らない
// ============================================================================
// 本検査の導入時点で `apps/web/app/**` の違反は **0 件**である（29 個の `<form>` に
// `method="post"` を足した）。**例外の列挙を 1 件も置かない** —— 置いた瞬間に
// 「新しいフォームは許可リストに足せばよい」になり、同じ欠陥が再発する。
//
// 🔴 **「0 件だから緑」で終わらせない**（`HANDOFF.md` §2.2 の教訓）。検出器が壊れて 0 件に
// なっても緑になるため、②で**走査が現に `<form>` を読み出していること**、④で
// **検出器が合成ソースでは現に違反を拾うこと**を併せて固定する。
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const webAppRoot = path.join(repoRoot, 'apps', 'web', 'app');
const fixturesDir = path.join(here, '__fixtures__', 'form-method-required');

const BACKSLASH = String.fromCharCode(92);

type FormTag = {
  readonly rel: string;
  readonly line: number;
  readonly openingTag: string;
  readonly hasMethod: boolean;
  readonly hasAction: boolean;
  readonly method: string | null;
};

function walk(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * 🔴 コメントは**同じ長さの空白に置き換える**（削除しない）。オフセットが保たれるので
 *    行番号の計算が元のソースと一致する。コメント中の `<form method="get">`（実在する。
 *    `engineer-ledger-screen.tsx` ほか 5 箇所の説明文）を**実在のフォームと数えない**ため。
 */
function blankComments(src: string): string {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === BACKSLASH) i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      out[i] = ' ';
      if (i + 1 < src.length) out[i + 1] = ' ';
      i += 2;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/**
 * `<form` の開きタグを、属性の `{…}` / 文字列リテラルを跨いで終端 `>` まで切り出す。
 * 🔴 `className={cn('a', 'b')}` のような式を含むため、素朴な `/<form[^>]*>/` では切れない。
 */
function extractFormTags(rel: string, rawSource: string): readonly FormTag[] {
  const src = blankComments(rawSource);
  const tags: FormTag[] = [];
  // 🔴 `<formation>` のような別要素を拾わないため、直後が空白か `>` のときだけ一致させる。
  const re = /<form(?=[\s>])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    let i = match.index + '<form'.length;
    let depth = 0;
    let end = -1;
    while (i < src.length) {
      const c = src[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === "'" || c === '"' || c === '`') {
        const quote = c;
        i += 1;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === BACKSLASH) i += 1;
          i += 1;
        }
      } else if (c === '>' && depth === 0) {
        end = i;
        break;
      }
      i += 1;
    }
    expect(end, `${rel}: <form> の開きタグの終端が見つからない`).toBeGreaterThan(0);
    const openingTag = src.slice(match.index, end + 1);
    const methodLiteral = /\bmethod\s*=\s*"([^"]*)"/.exec(openingTag);
    tags.push({
      rel,
      line: src.slice(0, match.index).split('\n').length,
      openingTag: openingTag.replace(/\s+/g, ' '),
      hasMethod: /\bmethod\s*=/.test(openingTag),
      hasAction: /\baction\s*=/.test(openingTag),
      method: methodLiteral === null ? null : methodLiteral[1].toLowerCase(),
    });
  }
  return tags;
}

const APP_FORMS: readonly FormTag[] = walk(webAppRoot)
  .filter((full) => !full.includes('.test.'))
  .flatMap((full) =>
    extractFormTags(path.relative(repoRoot, full).split(path.sep).join('/'), readFileSync(full, 'utf8')),
  );

/**
 * 🔴 **資格情報・秘密を入力するフォームを置くファイル**。ここは `method="post"` でなければ
 *    ならない（`action` だけ・`method="get"` は上述の漏洩経路そのもの）。
 *    列挙は「例外」ではなく**より強い要求を課す対象**であり、増やしても検査は緩まない。
 */
const CREDENTIAL_FORM_FILES: readonly string[] = [
  'apps/web/app/(main)/(auth)/signin/signin-form.tsx',
  'apps/web/app/(main)/(auth)/invite/[token]/invite-form.tsx',
  'apps/web/app/(main)/(auth)/password-reset/request-form.tsx',
  'apps/web/app/(main)/(auth)/password-reset/confirm/confirm-form.tsx',
  'apps/web/app/admin/signin/admin-signin-form.tsx',
];

function fixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

describe('apps/web/app の <form> は method か action を必ず持つ', () => {
  it('① 違反は 0 件（JS 水和前の既定 GET で入力値が URL に載る経路を 1 つも残さない）', () => {
    const violations = APP_FORMS.filter((form) => !form.hasMethod && !form.hasAction).map(
      (form) => `${form.rel}:${form.line} ${form.openingTag.slice(0, 120)}`,
    );
    expect(violations).toEqual([]);
  });

  it('② 走査は現に <form> を読み出している（検出器が空振りして 0 件になっていない）', () => {
    // 2026-10-03 の実測は 35 個（うち 6 個が検索用の素の `method="get"`）。
    expect(APP_FORMS.length).toBeGreaterThanOrEqual(35);
    expect(APP_FORMS.filter((form) => form.method === 'post').length).toBeGreaterThanOrEqual(29);
    expect(APP_FORMS.filter((form) => form.method === 'get').length).toBeGreaterThanOrEqual(6);
    // 走査対象のファイルが実在すること（パスの綴り間違いで 0 件になるのを防ぐ）。
    for (const rel of CREDENTIAL_FORM_FILES) {
      expect(APP_FORMS.some((form) => form.rel === rel), `${rel} の <form> が見つからない`).toBe(true);
    }
  });

  it('③ 資格情報を扱うフォームは method="post"（action だけ / get は漏洩経路のまま）', () => {
    const offenders = APP_FORMS.filter(
      (form) => CREDENTIAL_FORM_FILES.includes(form.rel) && form.method !== 'post',
    ).map((form) => `${form.rel}:${form.line} method=${String(form.method)}`);
    expect(offenders).toEqual([]);
  });

  it('④ 検出器は合成ソースでは現に違反を拾う（0 件が「壊れて 0 件」でないこと）', () => {
    const violating = extractFormTags('violation.tsx', fixture('violation.tsx')).filter(
      (form) => !form.hasMethod && !form.hasAction,
    );
    expect(violating.map((form) => form.line)).toEqual([7, 8, 13]);

    const clean = extractFormTags('clean.ok.tsx', fixture('clean.ok.tsx'));
    expect(clean.length).toBe(3);
    expect(clean.filter((form) => !form.hasMethod && !form.hasAction)).toEqual([]);
    expect(clean.map((form) => form.method)).toEqual(['post', null, 'get']);
  });
});
