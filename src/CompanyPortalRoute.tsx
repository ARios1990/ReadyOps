import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from './supabase';
import { CompanyPortal } from './CompanyPortal';
import { addDays, localDate, startOfWeek } from './portalUtils';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function CompanyPortalRoute({identifier,token}:{identifier:string;token:string}){
 const [companyId,setCompanyId]=useState(UUID.test(identifier)?identifier:'');const [error,setError]=useState('');
 useEffect(()=>{if(UUID.test(identifier)){setCompanyId(identifier);return;} (async()=>{const {data,error:e}=await supabase.rpc('get_company_management_portal_by_slug',{p_slug:identifier,p_access_token:token,p_start_date:localDate(addDays(startOfWeek(),-7)),p_end_date:localDate(addDays(startOfWeek(),28))});if(e)setError(e.message);else setCompanyId((data as any)?.company?.id||'')})()},[identifier,token]);
 if(error)return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6"><div className="rounded-xl border bg-white p-6 text-center"><h1 className="font-bold text-red-700">Company portal unavailable</h1><p className="mt-2 text-sm text-slate-500">{error}</p></div></div>;
 if(!companyId)return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-blue-600"/></div>;
 return <CompanyPortal companyId={companyId} token={token}/>;
}
