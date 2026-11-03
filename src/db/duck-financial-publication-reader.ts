import {DuckFinancialSearchIndex} from './duck-financial-search-index';
import {FinancialIndexPublication,type FinancialIndexPublicationCandidate} from './financial-index-publication';
import type {FinancialIndexCohort,FinancialIndexSearchOptions} from './financial-search-index';
/** Reads an explicitly activated catalog. Formal activation must go through the independent source gate. */
export class DuckFinancialPublicationReader {
 private current?:{reader:DuckFinancialSearchIndex;publication:FinancialIndexPublicationCandidate};
 private reloading?:Promise<FinancialIndexPublicationCandidate>;
 private closing=false;
 private closeTask?:Promise<void>;
 static async open(catalog:FinancialIndexPublication,file:string){const result=new DuckFinancialPublicationReader();try{await result.reload(catalog,file);return result}catch(error){await result.close();throw error}}
 reload(catalog:FinancialIndexPublication,file:string):Promise<FinancialIndexPublicationCandidate>{
  if(this.closing)return Promise.reject(Error('DuckDB publication reader is closed'));
  if(this.reloading)return Promise.reject(Error('DuckDB publication reload is running'));
  const task=this.replace(catalog,file);this.reloading=task;task.then(()=>{this.reloading=undefined},()=>{this.reloading=undefined});return task;
 }
 private async replace(catalog:FinancialIndexPublication,file:string){
  let next:DuckFinancialSearchIndex|undefined;
  try{
   if(!(catalog instanceof FinancialIndexPublication))throw Error('A publication catalog is required');
   next=await DuckFinancialSearchIndex.open(file);const publication=await catalog.resolveAsync(next);
   if(!publication)throw Error('There is no active publication');if(this.closing)throw Error('DuckDB publication reader is closed');
   const old=this.current;this.current={reader:next,publication};next=undefined;await old?.reader.close();return structuredClone(publication);
  }finally{await next?.close()}
 }
 private selected(){if(this.closing||!this.current)throw Error('DuckDB publication reader is closed');return this.current}
 publication(){return structuredClone(this.selected().publication)}
 async screen(cohort:Omit<FinancialIndexCohort,'generation'>,options:FinancialIndexSearchOptions){
  const current=this.selected();if(cohort&&Object.hasOwn(cohort,'generation'))throw Error('Use the active publication generation');return current.reader.screen({...cohort,generation:current.publication.generation},options);
 }
 async generation(){const current=this.selected();return current.reader.generation(current.publication.generation)}
 async quality(){const current=this.selected();return current.reader.quality(current.publication.generation)}
 async snapshotSha256(){return this.selected().reader.snapshotSha256()}
 close(){return this.closeTask??=(async()=>{this.closing=true;try{await this.reloading}catch{}await this.current?.reader.close();this.current=undefined})()}
}
