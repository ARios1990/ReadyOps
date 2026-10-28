// The bridge never receives a staff JWT, Google credential, or service key.
window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== 'https://readyops.bolt.host') return;
  const m = event.data;
  if (m?.channel !== 'readyops-roof-manual' || !['ping','prepare','resume'].includes(m.action) || typeof m.requestId !== 'string') return;
  try {
    const response = await chrome.runtime.sendMessage({type:m.action, ticket:m.ticket, deliveryId:m.deliveryId});
    window.postMessage({channel:'readyops-roof-manual-response', requestId:m.requestId, ...response}, event.origin);
  } catch {
    window.postMessage({channel:'readyops-roof-manual-response', requestId:m.requestId, error:'Reload ReadyOps after installing or updating the Roof Pros helper.'}, event.origin);
  }
});
