import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const folder=path.join(root,'public','roof-pros-helper');
const files=fs.readdirSync(folder).filter(n=>/\.(js|json)$/.test(n)).sort();
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=b=>{let c=0xffffffff;for(const v of b)c=table[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
let offset=0;const parts=[],central=[];
for(const name of files){
 const n=Buffer.from(name),data=Buffer.from(fs.readFileSync(path.join(folder,name),'utf8').replace(/\r\n/g,'\n')),crc=crc32(data);
 const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);
 const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
 parts.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const zip=Buffer.concat([...parts,directory,end]),target=path.join(root,'public','roof-pros-helper.zip');
if(process.argv.includes('--check')){if(!fs.existsSync(target)||!fs.readFileSync(target).equals(zip))throw Error('Rebuild public/roof-pros-helper.zip after changing the helper.');}
else fs.writeFileSync(target,zip);
console.log(`Roof Pros helper: ${files.length} files, ${zip.length} bytes; ${process.argv.includes('--check')?'verified':'packaged'}.`);
