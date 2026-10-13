import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Crown, BarChart3 } from 'lucide-react';
import './masters-ready.css';

export function MastersReadyMark({ large = false }: { large?: boolean }) {
  return <div className={`masters-mark ${large ? 'is-large' : ''}`} aria-label="Masters Ready Paystub · Big Ready Leads"><img src="/masters-ready-paystub-logo.png" alt="Masters Ready Paystub · Big Ready Leads" width={1672} height={941} decoding="async"/></div>;
}
export function MastersHero({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return <header className="masters-hero"><div className="masters-heading"><span className="masters-icon"><BarChart3 size={28}/></span><div><h2>{title}</h2><p>{subtitle}</p></div></div><MastersReadyMark/><div className="masters-hero-actions">{actions}</div></header>;
}
export function MastersSection({ title, subtitle, children, storageKey, tone = 'blue', actions, defaultOpen = true, openRequest = 0 }: {title:string;subtitle?:string;children:ReactNode;storageKey:string;tone?:string;actions?:ReactNode;defaultOpen?:boolean;openRequest?:number}) {
  const id=useId();
  const [open,setOpen]=useState(()=>{try {const saved=localStorage.getItem(storageKey);return saved==null?defaultOpen:saved==='1';}catch{return defaultOpen;}});
  useEffect(()=>{if(openRequest>0){setOpen(true);try{localStorage.setItem(storageKey,'1');}catch{/* preferences are optional */}}},[openRequest,storageKey]);
  const toggle=()=>setOpen(value=>{try{localStorage.setItem(storageKey,value?'0':'1');}catch{/* preferences are optional */}return !value;});
  return <section className={`masters-section tone-${tone}`}><header><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div><div className="masters-section-actions">{actions}<button type="button" aria-expanded={open} aria-controls={id} onClick={toggle}>{open?<EyeOff size={14}/>:<Eye size={14}/>} {open?'Hide Section':'Show Section'} {open?<ChevronUp size={13}/>:<ChevronDown size={13}/>}</button></div></header><div id={id} hidden={!open} className="masters-section-body">{children}</div></section>;
}
export function MastersMetric({ label,value,tone='blue',caption }: {label:string;value:string|number;tone?:string;caption?:string}) {
  return <article className={`masters-metric tone-${tone}`}><span className="masters-metric-symbol"><Crown size={22}/></span><div><h3>{label}</h3><strong>{value}</strong>{caption&&<p>{caption}</p>}</div></article>;
}
