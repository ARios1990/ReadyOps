(() => {
  const dom=globalThis.RoofProsFormDOM;
  const send=async message=>{const r=await chrome.runtime.sendMessage(message);if(r?.error)throw Error(r.error);return r;};
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(test,ms=90000)=>{const end=Date.now()+ms;while(Date.now()<end){const result=test();if(result)return result;await sleep(250);}throw Error('Google did not finish loading or uploading. Keep this tab; do not create another submission.');};
  if(location.pathname==='/picker') {
    (async()=>{
      const data=await send({type:'picker'});if(data?.inactive)return;
      const el=await wait(()=>document.querySelector('input[type="file"]'),20000);
      const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));
      const transfer=new DataTransfer();transfer.items.add(new File([bytes],data.filename,{type:data.mime}));
      el.files=transfer.files;el.dispatchEvent(new Event('change',{bubbles:true}));
    })().catch(()=>{/* The main frame reports any unfinished upload. */});
    return;
  }
  let current,ready=false,intent=false;
  const banner=(message,error=false)=>{
    let el=document.getElementById('readyops-manual-review');
    if(!el){el=document.createElement('aside');el.id='readyops-manual-review';el.setAttribute('role','status');el.style.cssText='position:sticky;top:0;z-index:2147483647;padding:16px;font:15px/1.5 Arial,sans-serif;color:#fff;background:#17314d;border-bottom:4px solid #2563eb';document.body.prepend(el);}
    el.textContent=message;el.style.background=error?'#7f1d1d':'#17314d';
  };
  const isSubmit=target=>target instanceof Element&&target.closest('[role="button"][aria-label="Submit"],button[type="submit"]');
  // Only a real user click can reach Google. No helper path clicks Submit.
  document.addEventListener('click',event=>{
    if(!current || !isSubmit(event.target))return;
    if(current.expires&&Date.now()>current.expires){event.preventDefault();event.stopImmediatePropagation();banner('This preparation expired. Keep the existing draft and review its status in ReadyOps before submitting.',true);return;}
    if(!event.isTrusted || !ready || intent){event.preventDefault();event.stopImmediatePropagation();banner(intent?'Submit was already clicked. Wait for Google’s receipt; do not click again.':'Wait for ReadyOps to finish verifying the form and recording.',true);return;}
    try {dom.verify(current.fields,current.filename);}catch(error){event.preventDefault();event.stopImmediatePropagation();banner(error.message,true);return;}
    intent=true;ready=false;
    void send({type:'user_submit'}).catch(error=>banner('Keep this tab for receipt review: '+error.message,true));
  },true);
  async function receipt() {
    if(!dom.hasReceipt())return false;
    await send({type:'receipt'});
    banner('Roof Pros received your submission. ReadyOps recorded the Google confirmation and matching audio.');
    return true;
  }
  async function fill(data) {
    const account=[...document.querySelectorAll('a[href*="accounts.google.com/AccountChooser"]')].some(a=>a.parentElement?.textContent.includes('mastersreadyservices2025@gmail.com'));
    if(!account)throw Error('Sign in to mastersreadyservices2025@gmail.com, then reopen the prepared tab from ReadyOps.');
    banner('Preparing Roof Pros details and the matching recording. Please wait before reviewing or submitting.');
    for(const [el,value]of dom.textFields(data.fields))dom.set(el,value);
    dom.set(document.querySelector('[aria-label="Hour"]'),data.fields.hour);
    dom.set(document.querySelector('[aria-label="Minute"]'),data.fields.minute);
    const timeQuestion=dom.question('Appointment Time');
    const list=timeQuestion.querySelector('[role="listbox"]');
    if(!list)throw Error('Google appointment time selector changed.');
    list.click();
    // Google renders the open AM/PM menu in a page-level overlay, not reliably inside the listbox.
    const option=await wait(()=>dom.option(data.fields.ampm));
    option.click();
    await wait(()=>dom.selectedOption(timeQuestion)===data.fields.ampm);
    const contract=dom.question('Roofing Contract');
    if(data.fields.contract)contract.querySelector(`[role="radio"][data-value="${data.fields.contract}"]`).click();
    else {const clear=dom.button(contract,'Clear selection');if(clear)clear.click();}
    const recording=dom.question('Customer Recording');
    const old=dom.button(recording,'Remove file');if(old){old.click();await wait(()=>!dom.button(recording,'Remove file'));}
    const add=dom.button(recording,'Add file');if(!add)throw Error('Google recording upload control changed.');
    await send({type:'uploading'});add.click();
    await wait(()=>recording.textContent.includes(data.filename)&&dom.button(recording,'Remove file'));
    await wait(()=>![...document.querySelectorAll('[role="dialog"]')].some(e=>e.getAttribute('aria-hidden')!=='true'&&getComputedStyle(e).display!=='none'));
    dom.verify(data.fields,data.filename);
    await send({type:'ready'});ready=true;
    banner('Ready for your review — '+data.fields.name+'. Matching recording attached: '+data.filename+'. Telemarketer: Horacio. Verify the information, then click Google’s Submit yourself.');
  }
  (async()=>{
    current=await send({type:'context'});
    if(current?.inactive){await sleep(1000);current=await send({type:'context'});if(current?.inactive){current=null;return;}}
    if(await receipt())return;
    if(current.phase==='submit_requested'){banner('Your Submit was already observed. Wait for the Google receipt; do not submit again.',true);return;}
    if(current.phase==='ready'){
      dom.verify(current.fields,current.filename);ready=true;
      banner('Prepared form recovered. Review the details and matching recording, then click Submit yourself.');
    }else if(current.phase==='prepared')await fill(current);
    else throw Error('Keep this existing draft open. Preparation was interrupted; check its status in ReadyOps before retrying.');
    const observer=new MutationObserver(()=>{if(dom.hasReceipt()){observer.disconnect();void receipt().catch(e=>banner('Google receipt is visible; ReadyOps confirmation needs review: '+e.message,true));}});
    observer.observe(document.body,{childList:true,subtree:true});
  })().catch(async error=>{
    if(!current || current.inactive)return;
    banner(error.message,true);
    if(['prepared','uploading'].includes(current.phase))await send({type:'failed',message:error.message}).catch(()=>{});
  });
})();
