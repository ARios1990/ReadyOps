import { Children, cloneElement, isValidElement, useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { HorizontalScrollFrame } from './HorizontalScrollFrame';

type Column = { key: string; label: string; width: number };
type Layout = { order: string[]; hidden: string[]; frozen: string[] };
type ElementProps = { children?: ReactNode; className?: string; style?: CSSProperties };

export function normalizeColumnLayout(columns: Column[], input?: Partial<Layout>): Layout {
  const keys = columns.map(column => column.key);
  const valid = (values: unknown) => Array.isArray(values) ? [...new Set(values.filter((key): key is string => typeof key === 'string' && keys.includes(key)))] : [];
  const order = valid(input?.order);
  const hidden = valid(input?.hidden);
  return { order: [...order, ...keys.filter(key => !order.includes(key))], hidden: hidden.length === keys.length ? hidden.slice(1) : hidden, frozen: input ? valid(input.frozen) : keys.slice(0, 1) };
}

export function ConfigurableLeadTable({ columns, storageKey, children }: { columns: Column[]; storageKey: string; children: ReactNode }) {
  const [layout, setLayout] = useState<Layout>(() => {
    try { const saved = window.localStorage.getItem(storageKey); return normalizeColumnLayout(columns, saved ? JSON.parse(saved) : undefined); }
    catch { return normalizeColumnLayout(columns); }
  });
  const [panel, setPanel] = useState<'hidden' | 'frozen' | 'order' | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  useEffect(() => { try { window.localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* Layout still works when browser storage is unavailable. */ } }, [layout, storageKey]);
  const visible = layout.order.filter(key => !layout.hidden.includes(key));
  const columnByKey = new Map(columns.map(column => [column.key, column]));
  const frozenOffsets = new Map<string, number>();
  let frozenWidth = 0;
  visible.forEach(key => { if (layout.frozen.includes(key)) { frozenOffsets.set(key, frozenWidth); frozenWidth += columnByKey.get(key)!.width; } });
  const toggle = (kind: 'hidden' | 'frozen', key: string) => setLayout(current => ({ ...current, [kind]: current[kind].includes(key) ? current[kind].filter(value => value !== key) : [...current[kind], key] }));
  const move = (key: string, target: string) => setLayout(current => {
    if (key === target) return current;
    const order = current.order.filter(value => value !== key);
    order.splice(order.indexOf(target), 0, key);
    return { ...current, order };
  });
  const moveBy = (key: string, amount: number) => setLayout(current => {
    const order = [...current.order]; const index = order.indexOf(key); const target = index + amount;
    if (target < 0 || target >= order.length) return current;
    [order[index], order[target]] = [order[target], order[index]];
    return { ...current, order };
  });
  const cellStyle = (key: string, header: boolean): CSSProperties => ({ width: columnByKey.get(key)!.width, minWidth: columnByKey.get(key)!.width, maxWidth: columnByKey.get(key)!.width, ...(frozenOffsets.has(key) ? { position: 'sticky', left: frozenOffsets.get(key), zIndex: header ? 30 : 2 } : {}) });
  const bodies = Children.toArray(children).map(body => {
    if (!isValidElement<ElementProps>(body)) return body;
    return cloneElement(body, {}, Children.toArray(body.props.children).map(row => {
      if (!isValidElement<ElementProps>(row)) return row;
      const cells = Children.toArray(row.props.children);
      return cloneElement(row, {}, visible.map(key => {
        const cell = cells[columns.findIndex(column => column.key === key)];
        if (!isValidElement<ElementProps>(cell)) return cell;
        const className = (cell.props.className || '').split(' ').filter(token => !/^(sticky|left-|right-|z-|shadow-|min-w-)/.test(token)).join(' ');
        return cloneElement(cell as ReactElement<ElementProps>, { key, className: className + (frozenOffsets.has(key) ? ' bg-inherit shadow-sm' : ''), style: { ...cell.props.style, ...cellStyle(key, false) } });
      }));
    }));
  });
  return <div className="hidden md:block">
    <div className="flex flex-wrap gap-2 border-y bg-white p-3">
      {([['hidden','Show / Hide Columns'],['frozen','Freeze Columns'],['order','Reorder Columns']] as const).map(([kind,label]) => <button key={kind} type="button" aria-expanded={panel === kind} onClick={() => setPanel(panel === kind ? null : kind)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700">{label}</button>)}
      <button type="button" onClick={() => setLayout(normalizeColumnLayout(columns))} className="rounded-lg border px-3 py-2 text-xs font-bold">Reset Columns</button>
    </div>
    {panel && <div className="border-b bg-slate-50 p-3"><div className="mb-2 flex items-center justify-between"><strong>{panel === 'hidden' ? 'Visible columns' : panel === 'frozen' ? 'Keep columns visible while scrolling' : 'Column order'}</strong><button type="button" onClick={() => setPanel(null)} className="rounded border px-3 py-1">Close</button></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{layout.order.map((key,index) => <div key={key} className="flex items-center justify-between gap-2 rounded border bg-white p-2 text-xs">{panel === 'order' ? <><span>{columnByKey.get(key)!.label}</span><span className="flex gap-1"><button type="button" aria-label={`Move ${columnByKey.get(key)!.label} left`} disabled={index === 0} onClick={() => moveBy(key,-1)} className="rounded border px-2 py-1 disabled:opacity-30">←</button><button type="button" aria-label={`Move ${columnByKey.get(key)!.label} right`} disabled={index === layout.order.length-1} onClick={() => moveBy(key,1)} className="rounded border px-2 py-1 disabled:opacity-30">→</button></span></> : <label className="flex w-full items-center gap-2"><input type="checkbox" aria-label={`${panel === 'hidden' ? 'Show' : 'Freeze'} ${columnByKey.get(key)!.label}`} checked={panel === 'hidden' ? !layout.hidden.includes(key) : layout.frozen.includes(key)} disabled={panel === 'hidden' && visible.length === 1 && visible[0] === key} onChange={() => toggle(panel,key)} />{columnByKey.get(key)!.label}</label>}</div>)}</div></div>}
    <HorizontalScrollFrame className="readyops-sticky-table" ariaLabel="Company leads horizontal scroll"><table className="readyops-company-leads-table border-separate border-spacing-0 text-xs" style={{ tableLayout:'fixed', width:visible.reduce((sum,key) => sum + columnByKey.get(key)!.width,0) }}><thead className="table-header sticky top-0 z-10 bg-[#071525] text-left uppercase tracking-wide text-white"><tr>{visible.map(key => <th key={key} draggable onDragStart={() => setDragged(key)} onDragEnd={() => setDragged(null)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragged) move(dragged,key); setDragged(null); }} style={cellStyle(key,true)} className="border-b border-[#17314d] bg-[#071525] px-2 py-3" title="Drag to move this column, or use Reorder Columns"><span className="flex items-center justify-between gap-1">{columnByKey.get(key)!.label}<span aria-hidden="true">↔</span></span></th>)}</tr></thead>{bodies}</table></HorizontalScrollFrame>
  </div>;
}
