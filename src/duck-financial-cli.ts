import {recordDuckFinancialValueVerification,validateDuckFinancialValueVerification} from './duck-financial-value-verification';
import {Option,type Command} from 'commander';
import {spawn} from 'node:child_process';
import {lstatSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {buildDuckFinancialCycle} from './duck-financial-cycle';
import {resolve} from 'node:path';
import {DuckFinancialSearchIndex} from './db/duck-financial-search-index';
import {FinancialIndexPublication} from './db/financial-index-publication';
import {normalizeFinancialIndexSearch,type FinancialIndexSearchOptions} from './db/financial-search-index';
import {screenDuckCompanyFinancials} from './company-financial-screening';
import {compareDuckCompanyFinancialsByIndustry} from './company-industry-comparison';
import {readRegularFile,LOCAL_IMPORT_LIMITS} from './local-balance-sheet-import';
const readJSON=(file:string)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readRegularFile(resolve(file),LOCAL_IMPORT_LIMITS.manifestBytes).bytes));
const output=(value:unknown,pretty?:boolean)=>console.log(JSON.stringify(value,null,pretty?2:undefined));
/** Registers async commands without changing existing synchronous command behavior. */
export function registerDuckFinancialCommands(program:Command){
 program.command('build-duck-financial-cycle').description('固定原本SQLiteから版付き解析・検索DuckDB構築を分割再開します（正式切替は別工程）')
  .requiredOption('--config <path>','version/archivePath/parsedStorePath/outputDirectory/buildのJSON')
  .option('--max-documents <number>','一バッチの最大新規解析原本数（1〜100）','20')
  .option('--max-companies <number>','一バッチの最大構築会社数（1〜100）','20')
  .option('--max-batches <number>','各段階で同じ接続を使う最大バッチ数（1〜100）','1')
  .option('--pretty','JSONを整形').addOption(new Option('--locked').hideHelp())
  .action(async options=>{
   try{
    for(const value of [options.maxDocuments,options.maxCompanies,options.maxBatches])if(!/^[1-9]\d*$/.test(value)||Number(value)>100)throw Error('Invalid batch');
    const file=resolve(options.config),config=readJSON(file);
    if(typeof config.outputDirectory!=='string'||!isAbsolute(config.outputDirectory)||resolve(config.outputDirectory)!==config.outputDirectory||typeof config.parsedStorePath!=='string'||!isAbsolute(config.parsedStorePath)||resolve(config.parsedStorePath)!==config.parsedStorePath)throw Error('Invalid output directory');
    if(!options.locked){
     const lock=config.outputDirectory+'.lock',cacheLock=config.parsedStorePath+'.lock';for(const entry of [lock,cacheLock]){try{const s=lstatSync(entry);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('Invalid lock')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
     const args=['--no-fork','-n','-E','75',lock,'/usr/bin/flock','--no-fork','-n','-E','75',cacheLock,process.execPath,process.argv[1],'build-duck-financial-cycle','--config',file,'--max-documents',options.maxDocuments,'--max-companies',options.maxCompanies,'--max-batches',options.maxBatches,'--locked',...options.pretty?['--pretty']:[]];
     const child=spawn('/usr/bin/flock',args,{stdio:'inherit'}),forward=(signal:NodeJS.Signals)=>child.kill(signal),onInt=()=>forward('SIGINT'),onTerm=()=>forward('SIGTERM');process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
     try{process.exitCode=await new Promise<number>((done,reject)=>{child.once('error',reject);child.once('close',(code)=>done(code??1))});if(process.exitCode===75)console.error('別の処理がこの候補を使用中です')}finally{process.off('SIGINT',onInt);process.off('SIGTERM',onTerm)}return;
    }
    const controller=new AbortController(),stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
    try{const result=await buildDuckFinancialCycle(config,{maxDocuments:Number(options.maxDocuments),maxCompanies:Number(options.maxCompanies),maxBatches:Number(options.maxBatches),signal:controller.signal});output(result,options.pretty);if(result.status==='aborted')process.exitCode=2}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop)}
   }catch{console.error('固定入力・SDK・原本・出力先・排他・空き容量を確認してください（入力内容は非表示）');process.exitCode=1}
  });
 program.command('verify-duck-financial-values').description('検索DuckDBの採用値を独立原本照合し、検証記録を作成します（正式切替は行いません）')
  .requiredOption('--db <path>','停止した検索DuckDB').requiredOption('--catalog <path>','候補を登録したSQLite catalog')
  .requiredOption('--candidate <id>','照合する候補ID').requiredOption('--input-sha256 <hash>','固定入力のSHA-256')
  .requiredOption('--archive <path>','停止した原本SQLite').requiredOption('--record <path>','検証記録JSON')
  .option('--check','既存記録を再照合します（記録なしは失敗）').option('--pretty','JSONを整形')
  .action(async options=>{
   let index:DuckFinancialSearchIndex|undefined,catalog:FinancialIndexPublication|undefined;
   const controller=new AbortController(),stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
   try{
    index=await DuckFinancialSearchIndex.open(resolve(options.db));catalog=new FinancialIndexPublication(resolve(options.catalog),{readOnly:true});
    const input={reader:index,catalog,candidateId:options.candidate,inputSha256:options.inputSha256,archivePath:resolve(options.archive),recordPath:resolve(options.record),signal:controller.signal};
    const result=options.check?await validateDuckFinancialValueVerification(input):await recordDuckFinancialValueVerification(input);
    if(!result)throw Error('Verification record missing');output(result,options.pretty);
   }catch{console.error('候補・固定入力hash・原本・検証記録・Python実行環境を確認してください（入力内容は非表示）');process.exitCode=controller.signal.aborted?2:1}
   finally{try{await index?.close()}finally{catalog?.close();process.off('SIGINT',stop);process.off('SIGTERM',stop)}}
  });
 program.command('screen-duck-financial-index')
  .description('検査済みDuckDB世代の財務値を非同期で検索します')
  .requiredOption('--db <path>','停止した検索DuckDB')
  .requiredOption('--cohort <path>','generation/group/基準/scope/JPY/period/periodTypeのJSON')
  .requiredOption('--metrics <csv>','保存済み項目の明示subset')
  .option('--conditions <json>','metric/operator/valueの配列','[]')
  .option('--sort-by <metric>','並べ替える明示項目').option('--order <order>','ascまたはdesc')
  .option('--offset <number>','開始位置','0').option('--limit <number>','最大件数')
  .option('--company-master <path>','企業マスター完全観測の配列JSON（64MiB以下）')
  .option('--company-query <path>','asOf/業種等の属性条件JSON。knownAtは財務世代へ固定')
  .option('--pretty','JSONを整形')
  .action(async options=>{
   let index:DuckFinancialSearchIndex|undefined;
   try{
    for(const value of [options.offset,options.limit])if(value!==undefined&&!/^\d+$/.test(value))throw Error('Invalid pagination');
    if((options.companyMaster===undefined)!==(options.companyQuery===undefined))throw Error('Company input incomplete');
    const cohort=readJSON(options.cohort),query={metricIds:options.metrics.split(',').map((s:string)=>s.trim()),conditions:JSON.parse(options.conditions),sortBy:options.sortBy,order:options.order,offset:Number(options.offset),limit:options.limit===undefined?undefined:Number(options.limit)} as FinancialIndexSearchOptions;
    normalizeFinancialIndexSearch(cohort,query);
    if(options.companyMaster!==undefined){
     const snapshots=readJSON(options.companyMaster),company=readJSON(options.companyQuery);
     output(await screenDuckCompanyFinancials(resolve(options.db),snapshots,{cohort,company,search:query}),options.pretty);return;
    }
    index=await DuckFinancialSearchIndex.open(resolve(options.db));output(await index.screen(cohort,query),options.pretty);
   }catch{console.error('DuckDB・比較集合・企業マスター・企業条件・保存項目・数値条件を確認してください（入力内容は非表示）');process.exitCode=1}finally{await index?.close()}
  });
 program.command('compare-duck-financial-industries')
  .description('検査済みDuckDB世代の同一財務集合を業種別に非同期比較します')
  .requiredOption('--db <path>','停止した検索DuckDB')
  .requiredOption('--cohort <path>','同一世代・基準・scope・期間のJSON')
  .requiredOption('--metrics <csv>','共通採用を必要とする保存済み指標')
  .requiredOption('--company-master <path>','完全マスター観測の配列JSON（64MiB以下）')
  .requiredOption('--company-query <path>','企業条件JSON。knownAtは財務世代へ固定')
  .option('--pretty','JSONを整形')
  .action(async options=>{
   try{
    const result=await compareDuckCompanyFinancialsByIndustry(resolve(options.db),readJSON(options.companyMaster),{
     cohort:readJSON(options.cohort),company:readJSON(options.companyQuery),metricIds:options.metrics.split(',').map((m:string)=>m.trim())});
    output(result,options.pretty);
   }catch{console.error('DuckDB・同一財務集合・保存指標・企業マスターの観測条件を確認してください（入力内容は非表示）');process.exitCode=1}
  });
 for(const [name,method,label] of [['duck-financial-index-quality','quality','品質・母集団・値の充足'],['duck-financial-index-generation','generation','世代manifest']] as const){
  program.command(name).description(`検索DuckDBの${label}を読みます`).requiredOption('--db <path>','停止した検索DuckDB').requiredOption('--generation <id>','固定世代ID').option('--pretty','JSONを整形')
   .action(async options=>{let index:DuckFinancialSearchIndex|undefined;try{index=await DuckFinancialSearchIndex.open(resolve(options.db));output(await index[method](options.generation),options.pretty)}catch{console.error('DuckDB・固定世代・保存内容の整合を確認してください（入力内容は非表示）');process.exitCode=1}finally{await index?.close()}});
 }
 program.command('duck-financial-publication-status').description('SQLite catalogと検索DuckDBの現在候補を照合します')
  .requiredOption('--catalog <path>','公開catalog SQLite').requiredOption('--db <path>','停止した検索DuckDB').option('--pretty','JSONを整形')
  .action(async options=>{let catalog:FinancialIndexPublication|undefined,index:DuckFinancialSearchIndex|undefined;try{catalog=new FinancialIndexPublication(resolve(options.catalog),{readOnly:true});index=await DuckFinancialSearchIndex.open(resolve(options.db));const active=await catalog.resolveAsync(index);output({active:active??null,indexVerified:active!==undefined,history:catalog.history()},options.pretty)}catch{console.error('公開catalog・DuckDB・固定世代の整合を確認してください（入力内容は非表示）');process.exitCode=1}finally{await index?.close();catalog?.close()}});
}
