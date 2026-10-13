import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Crown, BarChart3 } from 'lucide-react';
import './masters-ready.css';

export function MastersReadyMark({ large = false }: { large?: boolean }) {
  return <div className={`masters-mark ${large ? 'is-large' : ''}`} aria-label="Masters Ready Paystub · Big Ready Leads"><svg viewBox="0 0 270 100" aria-hidden="true"><defs><linearGradient id="masters-gold" x2="0" y2="1"><stop stopColor="#fff0b5"/><stop offset="1" stopColor="#d99f26"/></linearGradient></defs><path d="M25 55 0 18 65 38 100 30 135 8 170 30 205 38 270 18 245 55 208 85 62 85Z" fill="#082750" stroke="url(#masters-gold)" strokeWidth="3"/><path d="m99 26 6-18 15 11 15-16 15 16 15-11 6 18" fill="url(#masters-gold)"/><path d="m8 32 48 22M15 48l44 16m203-32-48 22m41-6-44 16" stroke="#38bdf8" strokeWidth="3"/><text x="135" y="51" textAnchor="middle" fill="#ffdd85" fontSize="21" fontFamily="Georgia,serif" fontWeight="bold">MASTERS READY</text><text x="135" y="71" textAnchor="middle" fill="white" fontSize="20" fontFamily="Georgia,serif" fontWeight="bold">PAYSTUB</text><text x="135" y="92" textAnchor="middle" fill="#075ddb" fontSize="10" fontWeight="bold" letterSpacing="2">BIG READY LEADS</text></svg></div>;
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
