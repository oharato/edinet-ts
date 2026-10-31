import {openSync,closeSync,lstatSync,fstatSync,realpathSync,constants} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
/** Linux flock uses the inherited open-file description; the parent fd retains the lock until close or process death. */
export async function withOperationalLocks(paths,work){
 if(!Array.isArray(paths)||new Set(paths).size!==paths.length||typeof work!=='function')throw Error('Invalid operational locks');
 const descriptors=[];
 try{
  for(const path of paths){
   if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||realpathSync(dirname(path))!==dirname(path))throw Error('Invalid operational lock path');
   const fd=openSync(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);descriptors.push(fd);
   const check=()=>{const s=fstatSync(fd),p=lstatSync(path);if(!s.isFile()||s.nlink!==1||p.isSymbolicLink()||s.dev!==p.dev||s.ino!==p.ino)throw Error('Invalid operational lock file')};check();
   const lock=spawnSync('/usr/bin/flock',['-n','-E','75','3'],{stdio:['ignore','pipe','pipe',fd],timeout:10000});
   if(lock.error||lock.status!==0){const error=Error('Operational lock unavailable');error.exitCode=lock.status===75?75:1;throw error}check();
  }
  return await work();
 }finally{for(const fd of descriptors.reverse())closeSync(fd)}
}
