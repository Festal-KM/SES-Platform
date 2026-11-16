/** 要確認の下書き。値は入力画面へ戻すだけで、外部送信しない。 */
export type IntakeDraft = {
  readonly name?: string;
  readonly summary?: string;
  readonly availableFrom?: string;
  readonly priceMin?: number;
  readonly priceMax?: number;
};

function labeledLine(text: string, labels: readonly string[]): string | undefined {
  const pattern = new RegExp(`^\\s*(?:[【\\[])?(?:${labels.join('|')})(?:[】\\]])?\\s*[：:]\\s*(.+?)\\s*$`, 'imu');
  const value = pattern.exec(text)?.[1]?.trim();
  return value ? value.slice(0, 1000) : undefined;
}

/** 氏名や単価を含む原文はブラウザー内で処理し、入力済みの下書きへ反映する。 */
export function intakeDraftFromText(text: string, kind: 'PROJECT' | 'ENGINEER'): IntakeDraft {
  const name = labeledLine(text, kind === 'PROJECT' ? ['案件名', '案件'] : ['氏名', '名前', '要員名']);
  const summary = labeledLine(text, kind === 'PROJECT' ? ['案件概要', '業務概要', '内容'] : ['希望条件', '概要']);
  const date = labeledLine(text, kind === 'PROJECT' ? ['開始日', '開始時期'] : ['稼働可能日', '稼働開始日']);
  const day = date?.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/);
  const iso = day ? `${day[1]}-${day[2]!.padStart(2, '0')}-${day[3]!.padStart(2, '0')}` : undefined;
  const amount = labeledLine(text, ['単価', '希望単価']);
  const parts = amount?.normalize('NFKC').match(/\d[\d,]*(?:\.\d+)?\s*(?:万円|万|円)?/g)?.slice(0, 2);
  const sharedMan = parts?.length === 2 && /万/.test(parts[1] ?? '') && !/[万円]/.test(parts[0] ?? '');
  const parsedPrices = parts?.map((part, index) => {
    const value = Number(part.replace(/[^\d.]/g, ''));
    const inMan = /万/.test(part) || (index === 0 && sharedMan);
    if (!inMan && !/円/.test(part) && value < 10_000) return NaN;
    return Math.round(value * (inMan ? 10_000 : 1));
  });
  const prices = parsedPrices?.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000)
    && (parsedPrices.length < 2 || parsedPrices[0]! <= parsedPrices[1]!) ? parsedPrices : undefined;
  const validDate = iso && !Number.isNaN(Date.parse(`${iso}T00:00:00Z`))
    && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso;
  return {
    ...(name ? { name } : {}),
    ...(summary ? { summary } : {}),
    ...(validDate && iso ? { availableFrom: iso } : {}),
    ...(prices?.[0] !== undefined ? { priceMin: prices[0], priceMax: prices[1] ?? prices[0] } : {}),
  };
}
