export function audioType(bytes, mime) {
  if(mime && !/^(audio\/|video\/webm|application\/octet-stream)/i.test(mime))throw Error('Recording did not return audio content.');
  const prefix=String.fromCharCode(...bytes.slice(0,12));
  if(prefix.startsWith('ID3') || (bytes[0]===255 && (bytes[1]&224)===224))return {ext:'mp3',mime:'audio/mpeg'};
  if(prefix.startsWith('RIFF') && prefix.slice(8)==='WAVE')return {ext:'wav',mime:'audio/wav'};
  if(prefix.startsWith('OggS'))return {ext:'ogg',mime:'audio/ogg'};
  if(prefix.slice(4,8)==='ftyp')return {ext:'m4a',mime:'audio/mp4'};
  if(bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163)return {ext:'webm',mime:'audio/webm'};
  throw Error('Recording is not a supported audio file.');
}
export async function recordingBytes(response,maxBytes) {
  if(!response.ok || !response.body)throw Error('Unable to download the current recording.');
  if(Number(response.headers.get('Content-Length')||0)>maxBytes)throw Error('Recording exceeds Google’s 10 MB limit.');
  const reader=response.body.getReader(),chunks=[];let count=0;
  for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>maxBytes){await reader.cancel();throw Error('Recording exceeds Google’s 10 MB limit.');}chunks.push(value);}
  if(!count)throw Error('Recording is empty.');
  const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}
