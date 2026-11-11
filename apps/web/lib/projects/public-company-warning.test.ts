import { describe, expect, it } from 'vitest';
import { findOtherPartnerNames } from './public-company-warning';

const partners = [{ id: 'a', name: '株式会社アルファ' }, { id: 'b', name: '株式会社ベータ' }];
describe('公開文の取引先名', () => {
  it('選択先以外の社名を検出する', () => {
    expect(findOtherPartnerNames(['株式会社ベータの案件'], partners, ['a'])).toEqual(['株式会社ベータ']);
  });
  it('公開先が1社なら、その会社自身の社名は対象にしない', () => {
    expect(findOtherPartnerNames(['株式会社アルファの案件'], partners, ['a'])).toEqual([]);
  });
  it('複数社に同じ文を出す場合は、公開先同士の社名も対象にする', () => {
    expect(findOtherPartnerNames(['株式会社アルファの案件'], partners, ['a', 'b'])).toEqual(['株式会社アルファ']);
  });
  it('全角・半角の違いを揃え、空の社名を無視する', () => {
    expect(findOtherPartnerNames(['ＡＢＣ 案件'], [{ id: 'b', name: 'ABC' }, { id: 'c', name: ' ' }], ['a'])).toEqual(['ABC']);
  });
});
