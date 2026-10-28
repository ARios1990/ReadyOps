type HelperResponse = {success?:boolean;version?:string;error?:string};
export type ManualTicket = {id:string;token:string;delivery_id:string;lead_id:string};
export function roofProsHelper(action:'ping'|'prepare'|'resume', value?:ManualTicket|string):Promise<HelperResponse> {
  const requestId=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const timer=window.setTimeout(()=>{window.removeEventListener('message',receive);reject(Error(action==='ping'?'The Roof Pros helper is not responding in this Chrome profile. Check that it is enabled, then reload ReadyOps.':'Preparation has not responded yet. Refresh status before trying again.'));},action==='ping'?5000:90000);
    function receive(event:MessageEvent) {
      // Extension replies can omit source. Keep the exact origin, response channel
      // and unpredictable per-request ID checks; reject any non-null foreign window.
      if((event.source!==null&&event.source!==window)||event.origin!==window.location.origin||event.data?.channel!=='readyops-roof-manual-response'||event.data.requestId!==requestId)return;
      if(typeof event.data.error!=='string'&&event.data.success!==true)return;
      clearTimeout(timer);window.removeEventListener('message',receive);
      if(event.data.error)reject(Error(event.data.error));else resolve(event.data as HelperResponse);
    }
    window.addEventListener('message',receive);
    window.postMessage({channel:'readyops-roof-manual',requestId,action,...(action==='prepare'?{ticket:value}:{deliveryId:value})},window.location.origin);
  });
}
