const abbreviations = new Set('N S E W NE NW SE SW ST RD LN DR AVE BLVD CT PL PKWY HWY APT STE PO'.split(' '));
const states = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));

function properText(value: string) {
  return value.trim().replace(/\s+/g, ' ').replace(/[\p{L}\p{M}]+/gu, (word, offset: number, source: string) => {
    // Keep intentional mixed-case spellings such as McDonald and DeLaCruz.
    if (word !== word.toLowerCase() && word !== word.toUpperCase()) return word;
    const lower = word.toLowerCase();
    if (offset > 0 && /\d/.test(source[offset - 1])) return /^(st|nd|rd|th)$/.test(lower) ? lower : word.toUpperCase();
    const title = lower.charAt(0).toUpperCase() + lower.slice(1);
    return /^mc\p{L}/u.test(lower) ? 'Mc' + title.charAt(2).toUpperCase() + title.slice(3) : title;
  });
}

export function formatQCContactField(key: string, value: string) {
  if (key === 'full_name') return properText(value).replace(/\b(?:Ii|Iii|Iv|Vi|Vii|Viii)\b/g, suffix => suffix.toUpperCase());
  if (key === 'city') return properText(value);
  if (key !== 'address') return value;
  return properText(value).replace(/\s*,\s*/g, ', ').replace(/\b[A-Za-z]+\b/g, word => abbreviations.has(word.toUpperCase()) ? word.toUpperCase() : word)
    .replace(/,\s*([A-Za-z]{2})(?=\s+\d{5}(?:-\d{4})?\b|\s*$)/g, (match, state: string) => states.has(state.toUpperCase()) ? ', ' + state.toUpperCase() : match);
}

export function formatQCContactValues<T extends Record<string, unknown>>(values: T): T {
  const formatted = { ...values };
  for (const key of ['full_name', 'address', 'city']) {
    if (typeof values[key] === 'string') (formatted as Record<string, unknown>)[key] = formatQCContactField(key, values[key] as string);
  }
  return formatted;
}
