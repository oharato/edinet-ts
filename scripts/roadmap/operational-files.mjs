import {openSync,closeSync,fstatSync,readSync,lstatSync,realpathSync,writeFileSync,fsyncSync,renameSync,unlinkSync,existsSync,constants} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const normalFile = file => {const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('A normal single-link file is required');return realpathSync(file)};
const identity = s => [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
export function readJSONSnapshot(file) {
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
export function atomicJSON(file,value,{createOnly=false}={}) {
    const present=existsSync(file);
    if(createOnly&&present||!createOnly&&!present)throw Error('Operational checkpoint existence mismatch');
    const previous=present?identity(lstatSync(normalFile(file),{bigint:true})):undefined;
    const text=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(text)>16*1024**2)throw Error('Operational JSON is too large');
    const temporary=file+'.'+randomUUID()+'.tmp';let fd;
    try {
        fd=openSync(temporary,'wx',0o600);writeFileSync(fd,text);fsyncSync(fd);closeSync(fd);fd=undefined;
        if(present?identity(lstatSync(normalFile(file),{bigint:true}))!==previous:existsSync(file))throw Error('Operational checkpoint changed before commit');
        renameSync(temporary,file);const directory=openSync(dirname(file),'r');try{fsyncSync(directory)}finally{closeSync(directory)}
    } finally {if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary)}catch(error){if(error.code!=='ENOENT')throw error}}
}
