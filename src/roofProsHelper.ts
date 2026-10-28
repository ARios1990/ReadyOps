type HelperResponse = {success?:boolean;version?:string;error?:string};
export type ManualTicket = {id:string;token:string;delivery_id:string;lead_id:string};
export function roofProsHelper(action:'ping'|'prepare'|'resume', value?:ManualTicket|string):Promise<HelperResponse> {
  const requestId=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const timer=window.setTimeout(()=>{window.removeEventListener('message',receive);reject(Error(action==='ping'?'Install the Roof Pros Chrome helper, then reload ReadyOps.':'Preparation has not responded yet. Refresh status before trying again.'));},action==='ping'?1800:90000);
    function receive(event:MessageEvent) {
      if(event.source!==window||event.origin!==window.location.origin||event.data?.channel!=='readyops-roof-manual-response'||event.data.requestId!==requestId)return;
      clearTimeout(timer);window.removeEventListener('message',receive);
      if(event.data.error)reject(Error(event.data.error));else resolve(event.data as HelperResponse);
    }
    window.addEventListener('message',receive);
    window.postMessage({channel:'readyops-roof-manual',requestId,action,...(action==='prepare'?{ticket:value}:{deliveryId:value})},window.location.origin);
  });
}
