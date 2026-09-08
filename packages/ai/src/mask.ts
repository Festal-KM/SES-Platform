// packages/ai/src/mask.ts
// 🔴 LLM に渡してよいテキストを表すブランド型と、**それを作れる唯一の関数**
//    （docs/05 §7.8 / §7.10 / docs/03 §4.2 / CLAUDE.md §3.2）。
//
// 🔴 なぜ「ただの string」にしないか:
//    `runRole` に渡せるのが `MaskedText` だけであれば、**マスキングを迂回する入力経路が
//    型として存在しなくなる**（`BR-11` / `F-032 AC-1` / `CLAUDE.md` §7「PII 未マスキングでの
//    LLM 送信 0 件」）。実行時のチェックは後から足せるが、経路そのものを消せるのは型だけである。
//
// 🔴 **`MaskedText` を得る方法は 2 つだけである**（T-07-02。これ以外を足してはならない）:
//    ① `mask(raw, known)` … **実行時のデータ**（スキルシート本文・DB の値・外部入力）の唯一の入口。
//    ② `maskedTemplate` … **ソース上のリテラル**（＝ プロンプトの地の文）と `MaskedText` だけを
//       材料にする組み立て。実行時の文字列は型として入れられない。
//    🔴 ここに「string を無条件で `MaskedText` にする」関数（`unsafeAsMasked` 等）を足してはならない。
//       足した時点で、上記の型による担保が全部無効になる。**`as MaskedText` が本ファイル以外に
//       現れないこと**は `tests/static/masked-text-single-path.test.ts` が機械検査する。
//
// 🔴 マスキングは**決定的な処理**である（docs/03 §4.2）。LLM に「マスキングさせる」設計は採らない
//    —— マスキング前のデータが LLM に届くという矛盾になる。
// 🔴 例外・戻り値・ログに**原文および一致した文字列を入れない**（`MaskHit` は種別と件数だけを持つ。
//    docs/05 §16.2）。マスキングの記録自体が PII の再出現経路になってはならない。

// ============================================================================
// 1. ブランド型とコンテンツブロック
// ============================================================================

declare const MaskedBrand: unique symbol;

/**
 * マスキング済みテキスト。
 *
 * 🔴 `string` の部分型なので、そのままプロンプトに埋め込める。逆方向（`string` → `MaskedText`）は
 *    `mask()` と `maskedTemplate` だけが行う。
 */
export type MaskedText = string & { readonly [MaskedBrand]: true };

/**
 * LLM に送るコンテンツブロック（docs/05 §7.2）。
 *
 * 🔴 **`image` / `document` を持たない。** 画像は顔写真を含みうるがテキストマスキングでは
 *    扱えないため、「送らない」のではなく「**送れない**」構造にする（docs/03 §4.2 のリスク回避欄）。
 *    PDF もコード側でテキスト化してからマスキングを通す（docs/03 §3.3.2 の `sheet-parser`）。
 */
export type ContentBlock = {
  readonly type: 'text';
  readonly text: MaskedText;
};

/**
 * 🔴 **ブランドを付ける唯一の地点**（module-private）。
 *    export しない。外に出した瞬間に「マスキングを経ない `MaskedText`」が作れるようになる。
 */
function brand(text: string): MaskedText {
  return text as MaskedText;
}

/**
 * 🔴 **ソース上のリテラルだけからプロンプトを組み立てるタグ付きテンプレート。**
 *
 * なぜ必要か: ロールのプロンプト（`prompts/roles/{role}.v{n}.ts`。T-07-05）は「地の文（開発者が
 * 書いたリテラル）」と「`MaskedText`（マスキング済みの実データ）」の組み合わせである。組み立ての
 * 手段が無いと、各ロールが `as MaskedText` を書くことになり、型の担保が崩れる。
 *
 * 🔴 これは「string を `MaskedText` にする関数」ではない。材料は次の 2 つに限られる:
 *    - `TemplateStringsArray`（**ソースのテンプレートリテラルからしか生成されない**。実行時に
 *      組み立てた文字列を渡す型が無い。仕様上 frozen であることも実行時に確認する）
 *    - 補間値（`MaskedText` のみ。生の `string` はコンパイルエラー）
 *
 * @throws TypeError タグ付きテンプレート以外の呼び出し（偽装した配列）を検出したとき。
 *         🔴 メッセージに引数の中身を含めない。
 */
export function maskedTemplate(
  literals: TemplateStringsArray,
  ...values: readonly MaskedText[]
): MaskedText {
  const raw: unknown = (literals as { raw?: unknown }).raw;
  if (!Array.isArray(literals) || !Array.isArray(raw) || !Object.isFrozen(literals) || !Object.isFrozen(raw)) {
    // タグ付きテンプレートの template object は仕様上 frozen である（SetIntegrityLevel）。
    // 実行時に組み立てた配列を渡す「うっかりの迂回」を、型に加えて実行時にも弾く
    // （frozen な `raw` まで自作した完全な偽装は防げないが、それは型の握り潰しを伴う明白な故意であり、
    //  静的テスト `masked-text-single-path.test.ts` の検査対象でもある）。
    throw new TypeError(
      'maskedTemplate はタグ付きテンプレートとしてのみ呼び出せます（実行時の文字列から MaskedText は作れません）。',
    );
  }
  let out = literals[0] ?? '';
  for (let i = 0; i < values.length; i += 1) {
    out += values[i] ?? '';
    out += literals[i + 1] ?? '';
  }
  return brand(out);
}

// ============================================================================
// 2. マスキングの対象（何を伏せるか）
// ============================================================================

/**
 * 🔴 `BR-11` の 5 種（氏名・生年月日・連絡先・顔写真・現所属会社名）のうち、テキストで扱える 4 種。
 *    **顔写真は `ContentBlock` に `image` が無いことで担保する**（§7.8 ④）。
 *
 * 🔴 これは「DB の台帳の値」である。台帳の値そのもので置換するのが**主たる方式**であり、
 *    正規表現によるパターン検出は補助にすぎない（docs/03 §4.2）。
 */
export type KnownPiiValues = {
  readonly fullNames: readonly string[];
  /** `YYYY-MM-DD` 形式を想定（区切り違い・和暦の「年月日」表記も同定する）。 */
  readonly birthDates: readonly string[];
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  /** 現所属会社名（`BR-11`）。 */
  readonly affiliations: readonly string[];
};

/**
 * 🔴 `BR-12`（単価とエンド企業名を LLM に渡さない）の**保険**。
 *
 * 主たる担保は「除去する」ではなく「**入れない**」である（`MaskedProjectFacts` / `RenewalFacts` に
 * フィールドを持たない。docs/05 §7.8 ③）。しかし**自由文には混入しうる** —— スキルシートの
 * 業務内容欄には常駐先の企業名や単価が書かれていることがあり、構造的除外では届かない。
 * したがって台帳が知っている値は、自由文からも除去する。
 */
export type KnownCommerceValues = {
  /** 数値表記（`650000`）を想定。`650,000` / `65万` / `65万円` も同定する。 */
  readonly unitPrices: readonly string[];
  readonly endClientNames: readonly string[];
};

/** `mask()` に渡す既知値。🔴 全項目が必須（「今回は渡さない」を無意識に選べないようにする）。 */
export type KnownSensitiveValues = KnownPiiValues & KnownCommerceValues;

export const MASK_CATEGORIES = [
  'EMAIL',
  'PHONE',
  'PERSONAL_NUMBER',
  'POSTAL_CODE',
  'BIRTH_DATE',
  'UNIT_PRICE',
  'NAME',
  'AFFILIATION',
  'END_CLIENT',
  'BOUNDARY_TAG',
] as const;

/**
 * 伏せた種別。🔴 **配列の順序は「重なったときにどちらの表示を採るか」の優先順位**でもある
 *    （先にあるものが強い。同一位置に複数が当たるのは稀だが、決定的に決める必要がある）。
 */
export type MaskCategory = (typeof MASK_CATEGORIES)[number];

/** `KNOWN_VALUE` = 台帳の値による置換（主）/ `PATTERN` = 正規表現による追加検出（補助。docs/03 §4.2）。 */
export type MaskMethod = 'KNOWN_VALUE' | 'PATTERN';

/**
 * 伏せた結果の要約。
 *
 * 🔴 **一致した文字列そのものを持たない。** `AiUsage` への「パターン検出による追加マスキング」の
 *    記録（docs/03 §4.2）やログにそのまま載るため、ここに原文を入れると PII が再び外へ出る。
 */
export type MaskHit = {
  readonly category: MaskCategory;
  readonly method: MaskMethod;
  /**
   * 置換した箇所の数（同じ値が 3 箇所にあれば 3）。
   *
   * 数える単位は**出力に現れた置換表示 1 つ**である。1 箇所に複数の根拠が重なった場合
   * （台帳の単価 `650,000` と金額パターン `650,000 円`）は、**最も広く覆った根拠**に
   * 帰属させて 1 件と数える（二重計上しない）。
   */
  readonly count: number;
};

export type MaskResult = {
  readonly text: MaskedText;
  readonly hits: readonly MaskHit[];
};

/**
 * 置換後の表示。
 *
 * 🔴 `packages/i18n` に置かない。**利用者向けの文言ではなく LLM との機械的な取り決め**であり、
 *    ロケールで変わってはならない（変わると抽出結果が変わり、`promptVersion` による再現性も壊れる）。
 *
 * 🔴 T-07-05: 型を `MaskedText` にした。**伏せ字は定義上マスキング済みの文字列**であり
 *    （原文を 1 文字も含まない）、`gate-inspector` のプロンプトはこの語彙を
 *    「ここにあった値は既に取り除かれている」と伝えるために埋め込む（docs/05 §7.13）。
 *    プロンプト側で語彙を書き写すと、表を変えたときに静かにずれる。
 */
const PLACEHOLDER: Record<MaskCategory, MaskedText> = {
  EMAIL: maskedTemplate`[メール]`,
  PHONE: maskedTemplate`[電話番号]`,
  PERSONAL_NUMBER: maskedTemplate`[個人番号]`,
  POSTAL_CODE: maskedTemplate`[郵便番号]`,
  BIRTH_DATE: maskedTemplate`[生年月日]`,
  UNIT_PRICE: maskedTemplate`[単価]`,
  NAME: maskedTemplate`[名前]`,
  AFFILIATION: maskedTemplate`[所属会社]`,
  END_CLIENT: maskedTemplate`[企業名]`,
  BOUNDARY_TAG: maskedTemplate`[除去済みタグ]`,
};

/**
 * 🔴 伏せ字の語彙（種別 → 表示）。**唯一の出所はこの表である。**
 *
 * プロンプト（`prompts/roles/**`）はこの値を受け取って「伏せ字を指摘しない・復元しない」を
 * 指示する（docs/05 §7.13）。個人情報そのものは含まれないため、外へ出してよい。
 */
export const MASK_PLACEHOLDERS: Readonly<Record<MaskCategory, MaskedText>> = PLACEHOLDER;

// ============================================================================
// 3. 表記ゆれの吸収（既知値 → 正規表現）
// ============================================================================

const SPACES = '[\\s\\u3000]';
/** 氏名・会社名の内部に入りうる空白（「山田 太郎」と「山田太郎」を同じ値として扱う）。 */
const SPACE_JOINER = `${SPACES}*`;
/** 数値の内部に入りうる区切り（`090-1234-5678` / `650,000` / `03(1234)5678`）。 */
const NUMERIC_JOINER = '[\\s\\u3000,，.．\\-‐‑–—―ー－()（）]*';
const DIGIT = '[0-9０-９]';
const FULLWIDTH_OFFSET = 0xfee0;

function toHalfWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_OFFSET));
}

function escapeRegExp(value: string): string {
  // `-` は文字クラスの外では特別な意味を持たない（'u' フラグを使わないので識別子エスケープの制約も無い）。
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 半角・全角のどちらの数字でも当たるようにする（`docs/03` §4.2 の「全角数字で漏れる」への対処）。 */
function charPattern(ch: string): string {
  if (ch >= '0' && ch <= '9') {
    return `[${ch}${String.fromCharCode(ch.charCodeAt(0) + FULLWIDTH_OFFSET)}]`;
  }
  if (ch >= '０' && ch <= '９') {
    return `[${String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_OFFSET)}${ch}]`;
  }
  return escapeRegExp(ch);
}

/** 値の各文字の間に「入りうる区切り」を許した正規表現。1 文字の値は誤爆が大きすぎるので作らない。 */
function looseRegex(value: string, joiner: string): RegExp | undefined {
  const compact = value.replace(new RegExp(`${SPACES}+`, 'g'), '');
  if (compact.length < 2) return undefined;
  return new RegExp([...compact].map(charPattern).join(joiner), 'gid');
}

/** `1` → `0?1`（ゼロ埋めの有無を吸収）。`12` → `12`。 */
function numberPattern(value: string): string {
  const digits = [...value].map(charPattern).join('');
  return value.length === 1 ? `(?:0?${digits})` : digits;
}

function padded2(value: string): string {
  return [...value.padStart(2, '0')].map(charPattern).join('');
}

/**
 * 生年月日の表記ゆれ。
 *
 * 🔴 **区切り記号を必須にする。** 省略可にすると `199012` のような無関係な数字列に当たり、
 *    「LLM に渡してよい情報」（期間・経験年数）まで壊す。区切りの無い `YYYYMMDD` は別の
 *    正規表現として、前後が数字でないことを条件に当てる。
 */
function birthDateRegexes(value: string): RegExp[] {
  const normalized = toHalfWidthDigits(value.trim());
  const parsed = /^(\d{4})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})\D?$/.exec(normalized);
  if (parsed === null) {
    const loose = looseRegex(value, NUMERIC_JOINER);
    return loose === undefined ? [] : [loose];
  }
  const [, year = '', month = '', day = ''] = parsed;
  const yearPattern = [...year].map(charPattern).join('');
  const separator = `${SPACES}*[年/\\-.．]${SPACES}*`;
  const monthSeparator = `${SPACES}*[月/\\-.．]${SPACES}*`;
  return [
    new RegExp(
      `${yearPattern}${separator}${numberPattern(String(Number(month)))}` +
        `${monthSeparator}${numberPattern(String(Number(day)))}${SPACES}*日?`,
      'gid',
    ),
    new RegExp(`(?<!${DIGIT})${yearPattern}${padded2(month)}${padded2(day)}(?!${DIGIT})`, 'gid'),
  ];
}

/** 電話番号の表記ゆれ（ハイフン無し・全角・`+81`）。 */
function phoneRegexes(value: string): RegExp[] {
  const digits = toHalfWidthDigits(value).replace(/\D/g, '');
  if (digits.length < 9) {
    const loose = looseRegex(value, NUMERIC_JOINER);
    return loose === undefined ? [] : [loose];
  }
  const body = [...digits].map(charPattern).join(NUMERIC_JOINER);
  const regexes = [new RegExp(body, 'gid')];
  if (digits.startsWith('0')) {
    const international = [...digits.slice(1)].map(charPattern).join(NUMERIC_JOINER);
    regexes.push(new RegExp(`[+＋]81${NUMERIC_JOINER}${international}`, 'gid'));
  }
  return regexes;
}

/** 単価の表記ゆれ（`650000` / `650,000` / `65万` / `65万円`）。 */
function unitPriceRegexes(value: string): RegExp[] {
  const digits = toHalfWidthDigits(value).replace(/\D/g, '');
  if (digits.length < 3) {
    const loose = looseRegex(value, NUMERIC_JOINER);
    return loose === undefined ? [] : [loose];
  }
  const body = [...digits].map(charPattern).join(NUMERIC_JOINER);
  const regexes = [new RegExp(`(?<!${DIGIT})${body}(?!${DIGIT})`, 'gid')];
  const amount = Number(digits);
  if (Number.isSafeInteger(amount) && amount >= 10000 && amount % 10000 === 0) {
    const man = [...String(amount / 10000)].map(charPattern).join('');
    regexes.push(new RegExp(`(?<!${DIGIT})${man}${SPACES}*万(?:${SPACES}*円)?`, 'gid'));
  }
  return regexes;
}

/** 会社名の表記ゆれ（`株式会社X` / `(株)X` / `㈱X`）。🔴 法人格を落とした「X」単体には広げない（誤爆が大きい）。 */
function companyRegexes(value: string): RegExp[] {
  const variants = new Set<string>([value.trim()]);
  for (const [full, abbreviations] of [
    ['株式会社', ['(株)', '（株）', '㈱']],
    ['有限会社', ['(有)', '（有）', '㈲']],
    ['合同会社', ['(同)', '（同）']],
  ] as const) {
    if (value.includes(full)) {
      for (const abbreviation of abbreviations) variants.add(value.replace(full, abbreviation));
    }
  }
  return [...variants]
    .map((variant) => looseRegex(variant, SPACE_JOINER))
    .filter((regex): regex is RegExp => regex !== undefined);
}

type KnownFieldRule = {
  readonly key: keyof KnownSensitiveValues;
  readonly category: MaskCategory;
  readonly build: (value: string) => RegExp[];
};

const KNOWN_FIELD_RULES: readonly KnownFieldRule[] = [
  {
    key: 'emails',
    category: 'EMAIL',
    build: (value) => (value.trim().length < 5 ? [] : [new RegExp(escapeRegExp(value.trim()), 'gid')]),
  },
  { key: 'phones', category: 'PHONE', build: phoneRegexes },
  { key: 'birthDates', category: 'BIRTH_DATE', build: birthDateRegexes },
  { key: 'unitPrices', category: 'UNIT_PRICE', build: unitPriceRegexes },
  {
    key: 'fullNames',
    category: 'NAME',
    build: (value) => {
      const regex = looseRegex(value, SPACE_JOINER);
      return regex === undefined ? [] : [regex];
    },
  },
  { key: 'affiliations', category: 'AFFILIATION', build: companyRegexes },
  { key: 'endClientNames', category: 'END_CLIENT', build: companyRegexes },
];

// ============================================================================
// 4. パターン検出（補助。台帳に無い値を拾う）
// ============================================================================

/**
 * 🔴 **日付のパターン検出は「生年月日と分かる文脈」に限る。**
 *    素の `YYYY/MM/DD` まで伏せると、**LLM に渡してよい「期間」**（`BR-11`）が壊れ、`F-032` の
 *    経歴抽出が成立しなくなる。台帳の生年月日は既知値置換（主）が押さえる。
 */
const DATE_TOKEN =
  `(?:明治|大正|昭和|平成|令和)?${SPACES}*${DIGIT}{1,4}${SPACES}*[年/\\-.．]${SPACES}*` +
  `${DIGIT}{1,2}${SPACES}*[月/\\-.．]${SPACES}*${DIGIT}{1,2}${SPACES}*日?`;

type PatternRule = {
  readonly category: MaskCategory;
  readonly regex: RegExp;
  /** 一致した文字列を受け取り、伏せるべきかを最終判定する（桁数の検査など）。 */
  readonly validate?: (matched: string) => boolean;
};

function isPhoneLike(matched: string): boolean {
  const normalized = toHalfWidthDigits(matched).replace(/＋/g, '+');
  const domestic = normalized.startsWith('+81') ? `0${normalized.slice(3)}` : normalized;
  const digits = domestic.replace(/\D/g, '');
  return digits.startsWith('0') && (digits.length === 10 || digits.length === 11);
}

const PATTERN_RULES: readonly PatternRule[] = [
  { category: 'EMAIL', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gd },
  {
    category: 'PHONE',
    // ハイフン・括弧は許すが**空白は許さない**（貪欲一致が後続の数字列へ流れ出すのを防ぐ）。
    regex: new RegExp(`(?<!${DIGIT})(?:[+＋]81)?[0０][0-9０-９()（）\\-‐‑–—―ー－]{7,13}${DIGIT}(?!${DIGIT})`, 'gd'),
    validate: isPhoneLike,
  },
  {
    category: 'PHONE',
    // 空白区切りは形を固定して当てる（`090 1234 5678`）。
    regex: new RegExp(`(?<!${DIGIT})[0０]${DIGIT}{1,3}${SPACES}${DIGIT}{2,4}${SPACES}${DIGIT}{4}(?!${DIGIT})`, 'gd'),
    validate: isPhoneLike,
  },
  { category: 'PERSONAL_NUMBER', regex: new RegExp(`(?<!${DIGIT})${DIGIT}{12}(?!${DIGIT})`, 'gd') },
  {
    category: 'POSTAL_CODE',
    regex: new RegExp(`〒${SPACES}*${DIGIT}{3}[\\-‐‑–—―ー－]?${DIGIT}{4}(?!${DIGIT})`, 'gd'),
  },
  {
    category: 'POSTAL_CODE',
    regex: new RegExp(`(?<!${DIGIT})${DIGIT}{3}[\\-‐‑–—―ー－]${DIGIT}{4}(?!${DIGIT})`, 'gd'),
  },
  {
    category: 'BIRTH_DATE',
    regex: new RegExp(
      `(?:生年月日|生年月|誕生日|生誕|Date of Birth|DOB)${SPACES}*[：:]?${SPACES}*(?<target>${DATE_TOKEN})`,
      'gdi',
    ),
  },
  { category: 'BIRTH_DATE', regex: new RegExp(`(?<target>${DATE_TOKEN})${SPACES}*生(?:まれ)?`, 'gd') },
  {
    // 🔴 `BR-12` の保険。主たる担保は「プロンプトに入れない」（構造的除外）である。
    category: 'UNIT_PRICE',
    regex: new RegExp(
      `(?:[¥￥]${SPACES}*${DIGIT}[0-9０-９,，.．]*)|(?:${DIGIT}[0-9０-９,，.．]*${SPACES}*(?:万円|円|万(?=${SPACES}*[／/〜~])))`,
      'gd',
    ),
  },
  {
    // 🔴 プロンプトインジェクション対策（docs/05 §7.8 の対策 1）: 境界タグ自体を本文から除く。
    //    除かないと、本文中の `</untrusted_document>` で囲いを閉じられ、以降が「システム側の
    //    指示」として読まれうる。**この除去があるため `MaskedText` は境界タグを含まない。**
    category: 'BOUNDARY_TAG',
    regex: /<\s*\/?\s*untrusted_document\s*>/gid,
  },
];

// ============================================================================
// 5. 実行
// ============================================================================

type RawMatch = {
  readonly start: number;
  readonly end: number;
  readonly category: MaskCategory;
  readonly method: MaskMethod;
};

const CATEGORY_RANK = new Map<MaskCategory, number>(MASK_CATEGORIES.map((category, index) => [category, index]));

function rankOf(category: MaskCategory): number {
  return CATEGORY_RANK.get(category) ?? MASK_CATEGORIES.length;
}

function collect(
  text: string,
  regex: RegExp,
  category: MaskCategory,
  method: MaskMethod,
  out: RawMatch[],
  validate?: (matched: string) => boolean,
): void {
  regex.lastIndex = 0;
  let match = regex.exec(text);
  while (match !== null) {
    const target = match.indices?.groups?.['target'];
    const start = target?.[0] ?? match.index;
    const end = target?.[1] ?? match.index + match[0].length;
    if (end > start && (validate === undefined || validate(match[0]))) {
      out.push({ start, end, category, method });
    }
    // 長さ 0 の一致で無限ループにしない。
    if (regex.lastIndex === match.index) regex.lastIndex += 1;
    match = regex.exec(text);
  }
}

/**
 * 伏せるべき箇所（**位置と種別だけ**。T-07-06）。
 *
 * 🔴 **一致した文字列を持たない**（`MaskHit` と同じ理由。docs/05 §7.10 ⑤）。品質ゲートの
 *    機械的検出（§11.4）が `GateFinding.offsetStart` / `offsetEnd` を作るために位置を要るが、
 *    そこに原文を載せると `ReviewGate.findings`（JSON）が PII の再出現経路になる。
 */
export type SensitiveSpan = {
  /** 原文（マスキング前）の UTF-16 オフセット。 */
  readonly start: number;
  readonly end: number;
  readonly category: MaskCategory;
  readonly method: MaskMethod;
};

export type LocateSensitiveOptions = {
  /**
   * パターン検出（補助）を含めるか（既定 `true`）。
   *
   * 🔴 品質ゲートの機械的検出は `false` で呼ぶ。§11.4 が FAIL の根拠にするのは
   *    **既知値**（台帳の氏名・公開範囲外の企業名）に限られる —— パターン検出まで FAIL に
   *    すると、提案本文の末尾に自社担当者の署名（自分のメール・電話）が入っているだけで
   *    毎回 FAIL になり、`BR-18`（解消手段は元データの修正のみ）が空回りする。
   */
  readonly includePatterns?: boolean;
};

type Span = { start: number; end: number; best: RawMatch };

/**
 * 🔴 **重なった一致は「捨てる」のではなく「結合する」。**
 *    片方を捨てると、はみ出した部分（例: 氏名の後半）が原文のまま残る = 漏れる。
 *    表示に採る種別は「より広く覆っていた一致」、同幅なら `MASK_CATEGORIES` の順とする（決定的）。
 */
function buildSpans(matches: readonly RawMatch[]): Span[] {
  const sorted = [...matches].sort(
    (a, b) => a.start - b.start || b.end - a.end || rankOf(a.category) - rankOf(b.category),
  );
  const spans: Span[] = [];
  for (const match of sorted) {
    const last = spans[spans.length - 1];
    if (last !== undefined && match.start < last.end) {
      last.end = Math.max(last.end, match.end);
      if (isBetter(match, last.best)) last.best = match;
      continue;
    }
    spans.push({ start: match.start, end: match.end, best: match });
  }
  return spans;
}

function isBetter(candidate: RawMatch, current: RawMatch): boolean {
  const candidateWidth = candidate.end - candidate.start;
  const currentWidth = current.end - current.start;
  if (candidateWidth !== currentWidth) return candidateWidth > currentWidth;
  return rankOf(candidate.category) < rankOf(current.category);
}

/**
 * 🔴 **LLM に渡してよい形にする唯一の関数**（docs/05 §7.8 / docs/03 §4.2 / `BR-11` / `BR-12`）。
 *
 * 手順は 3 つで、①が主・②が補助・③は境界タグの除去である:
 *   ① 既知値の置換 —— 台帳（`Engineer` 等）が持つ値そのものを、表記ゆれを吸収して置換する
 *   ② パターン検出 —— 台帳に無いメール・電話・郵便番号・個人番号・「生年月日」文脈の日付・金額
 *   ③ 境界タグの除去 —— `<untrusted_document>` を本文から除く（`wrapUntrusted` の前提）
 *
 * 🔴 **「期間」と「経験年数」は伏せない**（`BR-11` が LLM に渡してよいとした情報であり、
 *    `F-032` の経歴抽出そのものである）。日付のパターン検出を生年月日の文脈に限っているのは
 *    このためである。
 *
 * @param raw 外部由来のテキスト（スキルシート本文など）。**原本ではなくテキスト化済みのもの。**
 * @param known DB の台帳から取得した既知値。🔴 呼び出し側は対象エンジニア・対象案件の値を必ず渡す。
 */
export function mask(raw: string, known: KnownSensitiveValues): MaskResult {
  const spans = locateSensitive(raw, known);
  const counts = new Map<string, number>();
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += raw.slice(cursor, span.start) + PLACEHOLDER[span.category];
    cursor = span.end;
    const key = `${span.category} ${span.method}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  out += raw.slice(cursor);

  const hits: MaskHit[] = [...counts.entries()]
    .map(([key, count]) => {
      const [category, method] = key.split(' ') as [MaskCategory, MaskMethod];
      return { category, method, count };
    })
    .sort((a, b) => rankOf(a.category) - rankOf(b.category) || a.method.localeCompare(b.method));

  return { text: brand(out), hits };
}

/**
 * 🔴 **伏せるべき箇所の位置だけ**を返す（T-07-06。docs/05 §11.4 の機械的検出が使う）。
 *
 * `mask()` と**同じ 1 つの照合**である（`mask()` は本関数の結果を置換に使う）。品質ゲートが
 * 独自に「台帳の氏名を本文から探す」実装を持つと、表記ゆれの吸収（全角・区切り・法人格の略記）が
 * 2 箇所に分かれ、片方だけが直る —— そのとき **LLM には伏せて送っているのにゲートは見逃す**
 * （またはその逆）という、最も気づきにくい壊れ方になる。
 *
 * 🔴 戻り値は位置と種別だけであり、一致した文字列を含まない（`SensitiveSpan` の 🔴）。
 * 🔴 重なりは結合済み・`start` の昇順（`buildSpans`）。したがって置換にもハイライトにも使える。
 */
export function locateSensitive(
  raw: string,
  known: KnownSensitiveValues,
  options: LocateSensitiveOptions = {},
): readonly SensitiveSpan[] {
  const matches: RawMatch[] = [];

  for (const rule of KNOWN_FIELD_RULES) {
    for (const value of known[rule.key]) {
      if (typeof value !== 'string' || value.trim().length === 0) continue;
      for (const regex of rule.build(value)) {
        collect(raw, regex, rule.category, 'KNOWN_VALUE', matches);
      }
    }
  }
  if (options.includePatterns !== false) {
    for (const rule of PATTERN_RULES) {
      collect(raw, rule.regex, rule.category, 'PATTERN', matches, rule.validate);
    }
  }

  return buildSpans(matches).map((span) => ({
    start: span.start,
    end: span.end,
    category: span.best.category,
    method: span.best.method,
  }));
}
