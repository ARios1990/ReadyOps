export type PayrollRecord = Record<string, unknown>;
export const amount = (value: unknown) => { const number = Number(value || 0); return Number.isFinite(number) ? number : 0; };
export const payrollMoney = (value: unknown) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount(value));
export function payrollTotals(entries: PayrollRecord[]) {
  return entries.reduce<{base:number;commission:number;bonus:number;deductions:number;gross:number;net:number}>((total, entry) => {
    const structure = String(entry.pay_structure || 'commission_only');
    const base = structure === 'hourly' ? amount(entry.hours) * amount(entry.hourly_rate) : ['base_only', 'base_plus_commission'].includes(structure) ? amount(entry.base_pay) : 0;
    const commission = ['commission_only', 'base_plus_commission'].includes(structure) ? amount(entry.qualified_leads) * amount(entry.lead_rate) + amount(entry.signed_contracts) * amount(entry.signed_contract_rate) : 0;
    const bonus = amount(entry.bonus), deductions = amount(entry.deductions);
    return { base: total.base + base, commission: total.commission + commission, bonus: total.bonus + bonus, deductions: total.deductions + deductions, gross: total.gross + base + commission + bonus, net: total.net + (entry.total_pay == null ? Math.max(0, base + commission + bonus - deductions) : amount(entry.total_pay)) };
  }, { base: 0, commission: 0, bonus: 0, deductions: 0, gross: 0, net: 0 });
}

export async function buildPaystubPdf({ title, period, entries }: { title: string; period: { week_start?: string; week_end?: string }; entries: PayrollRecord[] }) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} - Masters Ready Paystub`); pdf.setAuthor('ReadyOps');
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(.02,.16,.36), green = rgb(.02,.42,.31), muted = rgb(.30,.39,.48);
  const clean = (value: unknown) => [...String(value ?? '')].map(char => { try { font.encodeText(char); return char; } catch { return '?'; } }).join('');
  let page = pdf.addPage([612,792]), y = 660;
  const text = (value: unknown, x: number, top: number, size = 11, strong = false, color = blue) => page.drawText(clean(value), { x, y: top, size, font: strong ? bold : font, color });
  const wrap = (value: unknown, width: number, size = 11) => { const lines: string[] = []; let line=''; for (const word of clean(value).split(/\s+/)) { const next = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(next,size)>width && line) { lines.push(line); line=word; } else line=next; } if (line) lines.push(line); return lines; };
  const header = () => {
    page.drawRectangle({ x:0,y:697,width:612,height:95,color:blue });
    text('MASTERS READY PAYSTUB',36,754,21,true,rgb(1,1,1)); text('BIG READY LEADS | REAL WORK. REAL LEADS. REAL PAY.',36,731,9,false,rgb(.63,.84,1));
    page.drawLine({ start:{x:36,y:712},end:{x:576,y:712},thickness:2,color:rgb(.88,.68,.25) });
  };
  header();
  for (const line of wrap(title,530,17)) { text(line,36,y,17,true); y-=23; }
  text(`Pay period: ${period.week_start || '-'} to ${period.week_end || '-'}`,36,y,11,false,muted); y-=35;
  const totals = payrollTotals(entries);
  const summary: [string,number][] = [['Base / hourly earnings',totals.base],['Lead and signed-contract commission',totals.commission],['Bonuses',totals.bonus],['Gross earnings',totals.gross],['Deductions',totals.deductions]];
  for (const [label,value] of summary) { text(label,36,y); text(payrollMoney(value),440,y,11,true); y-=25; }
  y-=20;
  page.drawRectangle({x:30,y:y-14,width:552,height:43,color:rgb(.90,.97,.94)}); text('NET PAY',42,y,14,true,green); text(payrollMoney(totals.net),430,y,17,true,green); y-=62;
  const allPaid = entries.length>0 && entries.every(entry => entry.status==='paid');
  text(allPaid ? 'PAID' : entries.some(entry => entry.status==='paid') ? 'PARTIALLY PAID' : 'NOT PAID',36,y,19,true,allPaid?green:blue); y-=32;
  text('PAYROLL BREAKDOWN',36,y,13,true); y-=26;
  for (const entry of entries) {
    const lines = wrap(`${entry.agent_name || 'Agent'} - ${entry.team_name || 'Unassigned team'}`,360);
    const paymentLines=wrap(`Status: ${entry.status==='paid'?'PAID':'NOT PAID'}${entry.payment_date ? ` | Payment date: ${entry.payment_date}` : ''}${entry.payment_method ? ` | ${entry.payment_method}` : ''}`,540,9);
    const actorLines=entry.payment_recorded_by_name?wrap(`Payment recorded by: ${entry.payment_recorded_by_name}`,540,9):[];
    const height = lines.length*15+paymentLines.length*16+actorLines.length*16+42;
    if (y-height<55) { page=pdf.addPage([612,792]); header(); y=665; }
    for (const line of lines) { text(line,36,y,11,true); y-=15; }
    const row = payrollTotals([entry]); text(`Earnings ${payrollMoney(row.gross)} | Deductions ${payrollMoney(row.deductions)}`,36,y,9,false,muted); text(payrollMoney(row.net),454,y,12,true); y-=18;
    for (const line of paymentLines) {text(line,36,y,9,false,entry.status==='paid'?green:muted);y-=16;}
    for (const line of actorLines) {text(line,36,y,9,false,muted);y-=16;}
    page.drawLine({start:{x:36,y:y-4},end:{x:576,y:y-4},thickness:.5,color:rgb(.79,.85,.91)}); y-=20;
  }
  pdf.getPages().forEach((item,index) => item.drawText(`ReadyOps payroll record | ${index+1} of ${pdf.getPageCount()}`,{x:36,y:25,size:8,font,color:muted}));
  return pdf.save();
}

export async function downloadPaystub(title: string, period: {week_start?: string;week_end?: string}, entries: PayrollRecord[]) {
  const bytes = await buildPaystubPdf({ title,period,entries });
  const url = URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/pdf'}));
  const link=document.createElement('a'); link.href=url; link.download=`paystub-${title.replace(/[^a-z0-9]+/gi,'-')}-${period.week_start || 'period'}.pdf`; link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
