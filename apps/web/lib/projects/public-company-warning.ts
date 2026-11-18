/** 公開欄で見直すべき取引先名を、表記幅を揃えて探す。 */
export function findOtherPartnerNames(
  fields: readonly string[],
  partners: readonly { readonly id: string; readonly name: string }[],
  audience: readonly string[],
): readonly string[] {
  const soleAudience = audience.length === 1 ? audience[0] : null;
  const texts = fields.map((field) => field.normalize('NFKC').toLocaleLowerCase('ja-JP'));
  return partners.filter((partner) => {
    if (partner.id === soleAudience) return false;
    const name = partner.name.trim().normalize('NFKC').toLocaleLowerCase('ja-JP');
    return name.length > 0 && texts.some((field) => field.includes(name));
  }).map((partner) => partner.name);
}
