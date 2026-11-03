// Tiny integration fixtures exercise capacity boundaries without requiring 36 GiB on CI.
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const statfs=fs.statfsSync;
fs.statfsSync=(...args)=>({...statfs(...args),bsize:1024,bavail:Number(process.env.REGISTRY_JOB_TEST_FREE_BYTES??2**40)/1024});
syncBuiltinESMExports();
