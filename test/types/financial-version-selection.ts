import {
 FINANCIAL_VERSION_POLICY,authenticateFinancialVersionEvidence,financialVersionEvidenceManifestSha256,
 readFinancialVersionProof,verifyFinancialVersionContext,createSourceBackedObservedFinancialSnapshots,
 ObservedFinancialArchive,FinancialSearchIndex,FinancialIndexBuild,
 type DocumentVersionObservation,type ObservedFinancialSource,type FinancialVersionZipEvidence,
 type FinancialVersionEvidenceInput,type FinancialVersionEvidenceBundle,type AuthenticatedFinancialVersionContext,
 type FinancialVersionRuntimeBinding,type FinancialVersionProof,type FinancialVersionOptions,
 type SourceBackedObservedFinancialSnapshots,type SourceBackedArchivedFinancialSnapshotOptions,
 type SourceBackedArchivedFinancialSnapshots,type FinancialIndexBuildInput,type FinancialIndexPopulation,
 type FinancialIndexGeneration,type FinancialIndexGenerationV1,type FinancialIndexGenerationV2,
} from '../../src/index';

export function readonlyInputs(cutoff:string,observations:readonly DocumentVersionObservation[],sources:readonly ObservedFinancialSource[],evidence:readonly FinancialVersionZipEvidence[]):FinancialVersionEvidenceInput{
 return {cutoff,observations,sources,evidence};
}
export async function authenticatePinned(input:FinancialVersionEvidenceInput,expectedManifestSha256:string):Promise<FinancialVersionRuntimeBinding>{
 if(financialVersionEvidenceManifestSha256(input)!==expectedManifestSha256)throw Error('Pinned manifest differs');
 const bundle:FinancialVersionEvidenceBundle={...input,evidenceManifestSha256:expectedManifestSha256};
 const context:AuthenticatedFinancialVersionContext=await authenticateFinancialVersionEvidence(bundle);
 return {context,bundle};
}
export function readSelectedRaw(binding:FinancialVersionRuntimeBinding):SourceBackedObservedFinancialSnapshots{
 const proof:FinancialVersionProof=verifyFinancialVersionContext(binding.context,binding.bundle);
 const options:FinancialVersionOptions={policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:proof.evidenceManifestSha256};
 return createSourceBackedObservedFinancialSnapshots(binding,{...options,detailMetricIds:['costOfSales']});
}
export function archiveAndIndex(archive:ObservedFinancialArchive,index:FinancialSearchIndex,binding:FinancialVersionRuntimeBinding):FinancialIndexGenerationV2{
 const proof=verifyFinancialVersionContext(binding.context,binding.bundle);
 const options:SourceBackedArchivedFinancialSnapshotOptions={cutoff:proof.cutoff,extractorVersion:'financial-details-1',detailMetricIds:['costOfSales'],financialVersion:{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:proof.evidenceManifestSha256}};
 const cached:SourceBackedArchivedFinancialSnapshots=archive.createSourceBackedSnapshots(options,binding);
 const decisionSha:string=cached.provenance.financialVersion.proofSha256;
 void decisionSha;
 return index.materializeSourceBacked('private-source-backed',archive,options,binding);
}
export function buildInput(readOnlyArchive:ObservedFinancialArchive,population:FinancialIndexPopulation,binding:FinancialVersionRuntimeBinding):FinancialIndexBuildInput{
 const proof=readFinancialVersionProof(binding.context);
 return {id:'source-backed-build',generation:'source-backed-generation',archiveSha256:readOnlyArchive.snapshotSha256(),population,options:{cutoff:proof.cutoff,extractorVersion:'financial-details-1',detailMetricIds:['costOfSales'],financialVersion:{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:proof.evidenceManifestSha256,proofSha256:proof.sha256}}};
}
export function oneCheckpoint(state:FinancialIndexBuild,archive:ObservedFinancialArchive,index:FinancialSearchIndex,input:FinancialIndexBuildInput,binding:FinancialVersionRuntimeBinding):FinancialIndexGeneration|undefined{
 state.begin(input);
 const progress=state.runNext(input.id,archive,index,{limit:1,financialVersion:binding});
 return progress.pending===0&&progress.failed===0?state.finish(input.id,index):undefined;
}
export function versionedRead(generation:FinancialIndexGeneration):string{
 if(generation.indexVersion==='2'){
  const v2:FinancialIndexGenerationV2=generation;
  return v2.financialVersionProof.sha256;
 }
 const v1:FinancialIndexGenerationV1=generation;
 // @ts-expect-error v1 has no financial evidence capability/fields
 void v1.financialVersionProof;
 return v1.id;
}
export function typesDoNotMintAuthentication(bundle:FinancialVersionEvidenceBundle,persisted:unknown){
 // @ts-expect-error Opaque contexts cannot be constructed as ordinary JSON objects.
 const notAuthenticated:AuthenticatedFinancialVersionContext={};
 // @ts-expect-error Persisted unknown JSON is not an authenticated token.
 verifyFinancialVersionContext(persisted,bundle);
 // An explicit cast can silence TypeScript, but runtime WeakMap verification still rejects a JSON clone.
 const forged=persisted as AuthenticatedFinancialVersionContext;
 const rejectedAtRuntime=()=>verifyFinancialVersionContext(forged,bundle);
 void notAuthenticated;return rejectedAtRuntime;
}
export function inputsRemainReadonly(input:FinancialVersionEvidenceInput){
 // @ts-expect-error Caller source arrays may be readonly.
 input.sources.push({docID:'not-admitted'});
}
// @ts-expect-error Internal capture helpers are not root-package public exports.
import {captureFinancialVersionEvidenceBundle} from '../../src/index';
void captureFinancialVersionEvidenceBundle;
