const maskLast4 = (val: string, minLen = 4): string => {
  if (!val || typeof val !== 'string') return '****';
  const s = val.replace(/\s/g, '');
  if (s.length < minLen) return '****';
  return '****' + s.slice(-minLen);
};

export function maskPaymentDetails(pd: any): any {
  if (!pd || !pd.accountName) return pd;
  const type = pd.type || (pd.sortCode && pd.accountNumber ? 'uk_sort_code_account' : null);
  if (!type) return pd;
  const masked: any = { ...pd, type, _masked: true };
  if (type === 'uk_sort_code_account') {
    if (pd.accountNumber) masked.accountNumber = maskLast4(pd.accountNumber, 4);
  } else if (type === 'iban') {
    if (pd.iban) masked.iban = maskLast4(pd.iban.replace(/\s/g, ''), 4);
  } else if (type === 'ach') {
    if (pd.achAccountNumber) masked.achAccountNumber = maskLast4(pd.achAccountNumber, 4);
    if (pd.routingNumber) masked.routingNumber = '****' + (pd.routingNumber || '').slice(-4);
  }
  return masked;
}
