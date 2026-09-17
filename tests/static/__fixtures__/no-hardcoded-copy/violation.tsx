// 対照: ビューの日本語直書き（行番号をテストが固定する）
import { t } from '@ses/i18n';

const label = '閉じる';
const message = `残り ${label} 件`;
const notice = new Notice('保存しました');
function assertNever(value: never): never {
  throw new Error(`未対応の値です: ${String(value)}`);
}
export function Screen({ hint }: { hint: string }) {
  return (
    <section title={t('x.title')}>こんにちは
      <button type="button" aria-label="閉じる">{t('x.close')}</button>
      <input placeholder={'氏名を入力'} />
      <img alt={`写真: ${hint}`} />
      {'保存しました。'}
      {`${hint} 件`}
      <p title={hint}>{label}{message}{String(notice)}{assertNever}</p>
    </section>
  );
}
