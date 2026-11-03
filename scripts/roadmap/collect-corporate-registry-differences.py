#!/usr/bin/env python3
"""Collect a bounded date range using the SDK's observed nonpublication calendar."""
import argparse
from contextlib import ExitStack
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import subprocess

spec=importlib.util.spec_from_file_location('registry_fetch',Path(__file__).with_name('fetch-corporate-registry-diff.py'))
daily=importlib.util.module_from_spec(spec);spec.loader.exec_module(daily)


def create_plan(calendar,query,sdk_cli,node):
    result=subprocess.run([node,str(sdk_cli),'plan-corporate-registry-differences','--calendar',str(calendar),'--query',str(query)],capture_output=True,timeout=30,check=True)
    if len(result.stdout)>2*1024**2:raise ValueError('oversized SDK plan')
    return json.loads(result.stdout.decode('utf-8'))


def collect(calendar,query,key,fingerprint,output,max_downloads=1,sdk_cli=None,node='node',opener_factory=None):
    if type(max_downloads) is not int or not 0<=max_downloads<=100:raise ValueError('invalid download budget')
    calendar=Path(calendar).absolute();query=Path(query).absolute();key=Path(key).absolute();root=Path(output).absolute()
    sdk_cli=Path(sdk_cli or Path(__file__).resolve().parents[2]/'dist/cli.js').absolute()
    difference_plan=create_plan(calendar,query,sdk_cli,node)
    q=difference_plan['query']
    if q['through']>dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date().isoformat() or dt.datetime.fromisoformat(q['knownAt'].replace('Z','+00:00'))>dt.datetime.now(dt.timezone.utc):raise ValueError('collection cannot use a future date or calendar cutoff')
    with ExitStack() as stack:
        fd,before=daily.sig.regular(stack,str(key),1024**2)
        plan={'format':'edinet-ts-corporate-registry-collection-v1','differencePlan':difference_plan,'fingerprint':fingerprint.upper(),'publicKeySha256':daily.sig.digest(fd,before.st_size)}
        root.mkdir(mode=0o700,parents=True,exist_ok=True)
        if root.is_symlink():raise ValueError('collection directory is a symlink')
        lock=os.open(root/'.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);stack.callback(os.close,lock)
        info=os.fstat(lock)
        if not daily.sig.stat.S_ISREG(info.st_mode) or info.st_nlink!=1:raise ValueError('invalid collection lock')
        daily.fcntl.flock(lock,daily.fcntl.LOCK_EX|daily.fcntl.LOCK_NB)
        if (root/'plan.json').exists():
            if daily.load(root/'plan.json')!=plan:raise ValueError('collection plan changed')
        else:daily.atomic_json(root/'plan.json',plan)
        completed=[];pending=[];downloads=0;requests=0
        def summary(status):
            return {'format':plan['format'],'status':status,'query':q,'calendar':difference_plan['calendar'],'nonPublicationDays':difference_plan['nonPublicationDays'],'completed':completed,'pendingDates':pending,'downloadsThisRun':downloads,'requestsThisRun':requests,'latestObservedAt':max([v['source']['observedAt'] for v in completed],default=None)}
        daily.atomic_json(root/'status.json',summary('checking'))
        for index,date in enumerate(difference_plan['expectedDates']):
            day=root/'days'/date
            if not (day/'complete.json').exists() and downloads>=max_downloads:
                pending.append(date);continue
            day_requested=False
            def on_request():
                nonlocal requests,downloads,day_requested
                requests+=1
                if not day_requested:downloads+=1;day_requested=True
            try:
                result=daily.fetch(date,key,fingerprint,day,opener_factory(date) if opener_factory else None,on_request=on_request)
                part=daily.load(Path(result['importManifest']))
                completed.append({'date':date,'status':result['status'],'importManifest':result['importManifest'],'source':part['source'],'sha256':part['sha256'],'acquisitionReceipt':str(day/'complete.json')})
                daily.atomic_json(root/'status.json',summary('checking'))
            except BaseException:
                pending.extend(difference_plan['expectedDates'][index:])
                daily.atomic_json(root/'status.json',summary('failed'))
                raise
        result=summary('complete' if not pending else 'pending')
        daily.atomic_json(root/'status.json',result)
        return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['calendar','query','public-key','fingerprint','out']:parser.add_argument('--'+name,required=True)
    parser.add_argument('--max-downloads',type=int,default=1)
    parser.add_argument('--sdk-cli')
    parser.add_argument('--node',default='node')
    args=parser.parse_args()
    print(json.dumps(collect(args.calendar,args.query,args.public_key,args.fingerprint,args.out,args.max_downloads,args.sdk_cli,args.node),ensure_ascii=False))


if __name__=='__main__':
    try:main()
    except (ValueError,OSError,TypeError,KeyError,subprocess.SubprocessError,daily.zip_audit.zipfile.BadZipFile):
        raise SystemExit('Collection stopped; retained daily attempts are preserved. Check the SDK/calendar/plan, download budget and failed day.')
