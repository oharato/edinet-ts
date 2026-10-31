import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {LargeHoldingStore} from '../src/db/large-holding-store';
import {Database} from '../src/db/node-sqlite';
import {largeDocument} from './fixtures/large-holding-report';
import {searchLargeHoldingTransactions} from '../src/large-holding-transactions';
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
function document(options:Parameters<typeof largeDocument>[0]={}){
 const d=largeDocument(options),tag='DetailsOfAcquisitionsAndDisposalsOfStocksEtcIssuedByIssuerOfSaidStocksEtcDuringLast60DaysTextBlock';
 const tr=(v:string[])=>'<tr>'+v.map(x=>`<td>${x}</td>`).join('')+'</tr>';
 const table='<table>'+tr(['年月日','株券等の種類','数量','割合','市場内外取引の別','取得又は処分の別','単価'])+tr(['2025年4月23日','普通株式','100','0.00','市場内','取得',''])+'</table>';
 d.xml=d.xml.replace('</xbrli:xbrl>',`<j:${tag} contextRef="holder1">${table.replaceAll('<','&lt;').replaceAll('>','&gt;')}</j:${tag}></xbrli:xbrl>`);return d;
}
const observation=(d:ReturnType<typeof document>)=>({observationId:d.metadata.docID,observedAt:d.metadata.knownAt,document:{...d.metadata}});
const source=(d:ReturnType<typeof document>)=>({docID:d.metadata.docID,availableAt:d.metadata.knownAt,sourceSha256:hash(d.xml),coverContextRef:d.metadata.coverContextRef,xml:d.xml});
const query={cutoff:'2026-10-29T00:00:00Z'};
function fixture(run:(file:string)=>void){const dir=mkdtempSync(join(tmpdir(),'holding-transactions-store-'));try{run(join(dir,'store.sqlite'));}finally{rmSync(dir,{recursive:true,force:true});}}
function editBody(file:string,edit:(body:any)=>void){const db=new Database(file);try{const row=db.prepare('SELECT * FROM holding_snapshots').get()!;const body=JSON.parse(String(row.body));edit(body);row.body=canonical(body);row.sha256=hash(canonical(['id','doc_id','source_sha256','metadata_body','body_status','duty_date','issuer_code','body'].map(k=>row[k])));db.prepare('UPDATE holding_snapshots SET body=?,sha256=? WHERE id=?').run(row.body,row.sha256,row.id);}finally{db.close();}}
it('保存・再open後、訂正選択済み取引が原本APIと一致し、readOnlyは全byteを保持する',()=>fixture(file=>{
 const parent=document({docID:'ORIGINAL'}),leaf=document({docID:'CORRECTED',correction:true}),writer=new LargeHoldingStore(file);
 writer.append([observation(parent),observation(leaf)],[source(parent),source(leaf)]);writer.close();
 const before=hash(readFileSync(file)),reader=new LargeHoldingStore(file,{readOnly:true});try{
  const r=reader.searchTransactions({...query,action:'acquisition'}),expected=searchLargeHoldingTransactions([leaf],{...query,action:'acquisition'});
  expect(r.matched).toBe(1);for(const k of ['reports','rows','matched','filtered','excluded'] as const)expect(r[k]).toEqual(expected[k]);
  expect(r.unavailableSources).toEqual([]);expect(r.storage.originalXmlStored).toBe(false);expect(reader.searchTransactions({...query,action:'disposal'}).matched).toBe(0);
 }finally{reader.close();}expect(hash(readFileSync(file))).toBe(before);
}));
it.each(['missing','future','unloaded','parse'] as const)('訂正原本%sを親の取引で補完しない',kind=>fixture(file=>{
 const parent=document({docID:'ORIGINAL'}),leaf=document({docID:'CORRECTED',correction:true}),s=source(leaf);
 if(kind==='future')s.availableAt='2026-10-30T00:00:00Z';if(kind==='parse'){s.xml='bad XML';s.sourceSha256=hash(s.xml);}
 const store=new LargeHoldingStore(file);try{store.append([observation(parent),observation(leaf)],[source(parent),...(kind==='missing'?[]:[kind==='unloaded'?{...s,xml:undefined}:s])]);const r=store.searchTransactions(query);expect(r.matched).toBe(0);expect(r.unavailableSources[0].reason).toBe({missing:'source-missing',future:'not-available-at-cutoff',unloaded:'source-not-loaded',parse:'source-parse-failed'}[kind]);}finally{store.close();}
}));
it('旧snapshotは数値検索を維持し、同じhashの原本再投入で取引だけを補完する',()=>fixture(file=>{
 const d=document(),w=new LargeHoldingStore(file),numericQuery={...query,dutyDate:'2025-06-16',scope:'report' as const,metric:'holdingPercent' as const};w.append([observation(d)],[source(d)]);const old=w.search(numericQuery);w.close();
 editBody(file,b=>{delete b.transactions;});const r=new LargeHoldingStore(file,{readOnly:true});try{expect(r.search(numericQuery)).toEqual(old);expect(r.searchTransactions(query).unavailableSources[0].reason).toBe('transactions-not-materialized');}finally{r.close();}
 const upgrade=new LargeHoldingStore(file);try{expect(upgrade.append([],[source(d)]).materializedSnapshots).toBe(1);expect(upgrade.searchTransactions(query).matched).toBe(1);expect(upgrade.search(numericQuery)).toEqual(old);expect(upgrade.append([],[source(d)]).materializedSnapshots).toBe(0);}finally{upgrade.close();}
}));
it.each(['quantity','reportedDate','action','rowKey','source'] as const)('外側hashを付け直しても保存%sの改変を拒否する',field=>fixture(file=>{
 const d=document(),w=new LargeHoldingStore(file);w.append([observation(d)],[source(d)]);w.close();editBody(file,b=>{const t=b.transactions.report;if(field==='source')t.sources[0].rawSha256='0'.repeat(64);else if(field==='quantity')t.rows[0].quantity.decimal='999';else if(field==='reportedDate')t.rows[0].reportedDate.iso='2000-01-01';else if(field==='action')t.rows[0].action.kind='disposal';else t.rows[0].rowKey='0'.repeat(64);});const reader=new LargeHoldingStore(file,{readOnly:true});try{expect(()=>reader.searchTransactions(query)).toThrow();}finally{reader.close();}
}));
it('原本hashが異なる宣言は競合として保留し、過去cutoffの取引を保つ',()=>fixture(file=>{
 const d=document(),s=source(d),store=new LargeHoldingStore(file);try{store.append([observation(d)],[s]);const changed={...s,xml:d.xml.replace('>0.0297<','>0.06<'),availableAt:'2026-10-30T00:00:00Z'};changed.sourceSha256=hash(changed.xml);store.append([],[changed]);expect(store.searchTransactions(query).matched).toBe(1);const r=store.searchTransactions({cutoff:'2026-10-31T00:00:00Z'});expect(r.matched).toBe(0);expect(r.unavailableSources[0].reason).toBe('conflicting-source-observations');}finally{store.close();}
}));
it('取引Store CLIは原XMLが無くても検索でき、不正条件でDBを変更しない',()=>fixture(file=>{
 const d=document(),w=new LargeHoldingStore(file);w.append([observation(d)],[source(d)]);const expected=w.searchTransactions(query);w.close();
 const before=hash(readFileSync(file));
 const run=(...args:string[])=>spawnSync(process.execPath,['--import','tsx','src/cli.ts','search-large-holding-transactions-store','--db',file,'--cutoff',query.cutoff,...args],{encoding:'utf8',timeout:30000});
 const good=run('--pretty');expect(good.status,good.stderr).toBe(0);expect(JSON.parse(good.stdout)).toEqual(JSON.parse(JSON.stringify(expected)));
 for(const args of [['--limit','1.5'],['--action','unknown'],['--reported-end-date','2025-02-30']]){const r=run(...args);expect(r.status).toBe(1);expect(r.stdout).toBe('');}
 expect(hash(readFileSync(file))).toBe(before);
}));
it('発行者の異なる訂正辺も調べ、親の取引を復活させない',()=>fixture(file=>{
 const a=document({docID:'ORIGINAL'}),b=document({docID:'CORRECTED',correction:true});b.metadata.issuerEdinetCode='E99999';const store=new LargeHoldingStore(file);try{store.append([observation(a),observation(b)],[source(a),source(b)]);const r=store.searchTransactions({...query,issuerEdinetCode:a.metadata.issuerEdinetCode});expect(r.matched).toBe(0);expect(r.selection.decisions.some(d=>d.reason==='issuer-mismatch')).toBe(true);}finally{store.close();}
}));
