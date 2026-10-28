(() => {
  const label = e => (e?.textContent || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  const question = name => {
    const q = [...document.querySelectorAll('[role="listitem"]')].find(e => label(e.querySelector('[role="heading"]')) === name);
    if (!q) throw Error(`Google Form field changed: ${name}. Preparation stopped.`);
    return q;
  };
  const input = name => {
    const el = question(name).querySelector('input:not([type="hidden"]),textarea');
    if (!el) throw Error(`Google Form input unavailable: ${name}`);
    return el;
  };
  const set = (el, value) => {
    const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
    for (const type of ['input','change','blur']) el.dispatchEvent(new Event(type, {bubbles:true}));
  };
  const fieldNames = {telemarketer:'Telemarketer Name',name:'Customer Name',address:'Customer Address',phone:'Customer Phone',email:'Customer Email',roof_type:'Roof Type',date:'Appointment Date',roof_age:'Age of Roof',insurance:'Property Insurance',notes:'NOTES:'};
  const visible = e => !e.closest('[aria-hidden="true"]') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
  const button = (root, name) => [...root.querySelectorAll('[role="button"],button')].find(e => visible(e) && (e.getAttribute('aria-label') === name || label(e) === name));
  const textFields = fields => Object.entries(fieldNames).map(([key,name]) => [input(name), String(fields[key] || '')]);
  const verify = (fields, filename) => {
    if (fields.telemarketer !== 'Horacio') throw Error('Telemarketer must be Horacio.');
    for (const [el,value] of textFields(fields)) if (el.value !== value) throw Error('A Google Form value changed. Refresh the ReadyOps details before submitting.');
    if (document.querySelector('[aria-label="Hour"]')?.value !== fields.hour || document.querySelector('[aria-label="Minute"]')?.value !== fields.minute) throw Error('Verify appointment time.');
    if (label(question('Appointment Time').querySelector('[role="option"][aria-selected="true"]')) !== fields.ampm) throw Error('Verify AM / PM.');
    const selected = question('Roofing Contract').querySelector('[role="radio"][aria-checked="true"]');
    if ((selected?.getAttribute('data-value') || '') !== fields.contract) throw Error('Verify roofing contract selection.');
    const recording = question('Customer Recording');
    if (!recording.textContent.includes(filename) || !button(recording, 'Remove file')) throw Error('The matching recording has not finished uploading.');
    if (document.querySelector('[role="dialog"] iframe') && [...document.querySelectorAll('[role="dialog"]')].some(visible)) throw Error('Close the Google picker or draft conflict before submitting.');
    if (document.querySelector('[aria-invalid="true"]')) throw Error('Correct the Google Form validation error first.');
    return true;
  };
  const hasReceipt = () => /\/formResponse$/.test(location.pathname) && !document.querySelector('[role="listitem"] input:not([type="hidden"])') && [...document.querySelectorAll('div,p')].some(e=>!e.closest('#readyops-manual-review,[role="listitem"]')&&e.textContent.trim()==='Your response has been recorded.'&&visible(e));
  globalThis.RoofProsFormDOM = {label, question, input, set, button, textFields, verify, hasReceipt};
})();
