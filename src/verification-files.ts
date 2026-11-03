/** SDK-local checkpoint I/O uses the existing operational-files format without depending on repository scripts. */
import {openSync,closeSync,fstatSync,readSync,lstatSync,realpathSync,writeFileSync,fsyncSync,renameSync,linkSync,unlinkSync,existsSync,constants} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const canonical = (value:unknown):string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const sha256 = (value:string|Uint8Array) => createHash('sha256').update(value).digest('hex');
export const normalFile = (file:string) => {const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('A normal single-link file is required');return realpathSync(file)};
const identity = (s:import('node:fs').BigIntStats) => [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
export function readJSONSnapshot(file:string) {
    const fd=openSync(normalFile(file),constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
    try {
        const before=fstatSync(fd,{bigint:true});
        if(!before.isFile()||before.nlink!==1n||before.size>16n*1024n**2n)throw Error('Operational JSON is too large or invalid');
        const bytes=Buffer.alloc(Number(before.size));let offset=0;
        while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)break;offset+=n}
        if(offset!==bytes.length||identity(before)!==identity(fstatSync(fd,{bigint:true})))throw Error('Operational JSON changed during reading');
        const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return {value:JSON.parse(text),sha256:sha256(bytes),text};
    } finally {closeSync(fd)}
}
export function atomicJSON(file:string,value:unknown,{createOnly=false}:{createOnly?:boolean}={}) {
    const present=existsSync(file);
    if(createOnly&&present||!createOnly&&!present)throw Error('Operational checkpoint existence mismatch');
    const previous=present?identity(lstatSync(normalFile(file),{bigint:true})):undefined;
    const text=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(text)>16*1024**2)throw Error('Operational JSON is too large');
    const temporary=file+'.'+randomUUID()+'.tmp';let fd:number|undefined;
    try {
        fd=openSync(temporary,'wx',0o600);writeFileSync(fd,text);fsyncSync(fd);closeSync(fd);fd=undefined;
        if(present?identity(lstatSync(normalFile(file),{bigint:true}))!==previous:existsSync(file))throw Error('Operational checkpoint changed before commit');
        if(createOnly){linkSync(temporary,file);unlinkSync(temporary)}else renameSync(temporary,file);const directory=openSync(dirname(file),'r');try{fsyncSync(directory)}finally{closeSync(directory)}
    } finally {if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
}
