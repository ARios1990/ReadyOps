/** Display only: stored dates remain ISO and timestamps retain their timezone. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) {
      const [,year,month,day]=match;
      const parsed=new Date(`${value}T12:00:00Z`);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10)===value) return `${month}/${day}/${year}`;
      return value;
    }
  }
  const date=value instanceof Date?value:new Date(value);
  return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}).format(date);
}
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date=value instanceof Date?value:new Date(value);
  return Number.isNaN(date.getTime())?String(value):`${formatDate(date)} ${date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}`;
}
