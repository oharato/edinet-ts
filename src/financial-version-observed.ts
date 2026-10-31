import {createObservedFinancialSnapshotsUsing, type ObservedFinancialSnapshotOptions, type ObservedFinancialSnapshotRecord} from './observed-financial-snapshots';
import {createAutomaticFinancialSnapshots,normalizeAutomaticFinancialDetailMetricIds,type AutomaticFinancialSnapshotOptions,type AutomaticFinancialSnapshots} from './automatic-financial-snapshots';
import {captureFinancialVersionEvidenceBundle,verifyFinancialVersionContext, type FinancialVersionRuntimeBinding, type FinancialVersionOptions} from './financial-version-selection';

/** 認証済みの添付金融原本を選択します。通常のmetadata選択とその未解決理由は残します。 */
export function createSourceBackedObservedFinancialSnapshots(binding: FinancialVersionRuntimeBinding, options: FinancialVersionOptions & Pick<ObservedFinancialSnapshotOptions,'detailMetricIds'>) {
    return createSourceBackedObservedFinancialSnapshotsUsing(binding,options,createAutomaticFinancialSnapshots);
}
/** 内部共有: 永続化側も認証後に同じ直接原本検査と純粋解析cacheを使用します。 */
export function createSourceBackedObservedFinancialSnapshotsUsing(binding:FinancialVersionRuntimeBinding,options:FinancialVersionOptions & Pick<ObservedFinancialSnapshotOptions,'detailMetricIds'>,resolve:(xml:string,input:AutomaticFinancialSnapshotOptions)=>AutomaticFinancialSnapshots,rootDocIDs?:ReadonlySet<string>){
    if (!binding || typeof binding !== 'object' || Array.isArray(binding) || Object.keys(binding).some(k=>!['context','bundle'].includes(k)) ||
        !options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k=>!['policy','evidenceManifestSha256','detailMetricIds'].includes(k))) throw Error('金融版の認証contextと明示policyが必要です');
    const detailMetricIds=normalizeAutomaticFinancialDetailMetricIds(options.detailMetricIds);
    const {context,bundle:input}=binding,bundle=captureFinancialVersionEvidenceBundle(input),proof=verifyFinancialVersionContext(context,bundle);
    if(options.policy!==proof.policy || options.evidenceManifestSha256!==proof.evidenceManifestSha256) throw Error('金融版policy・証拠指紋が不一致です');
    const query={cutoff:bundle.cutoff,detailMetricIds};
    const related=rootDocIDs===undefined?undefined:new Set(rootDocIDs);
    if(related)for(let changed=true;changed;){changed=false;for(const o of bundle.observations)if(related.has(o.document.parentDocID??'')&&!related.has(o.document.docID)){related.add(o.document.docID);changed=true}}
    const observations=related?bundle.observations.filter(o=>related.has(o.document.docID)):bundle.observations,sources=related?bundle.sources.filter(s=>related.has(s.docID)):bundle.sources;
    const normal=createObservedFinancialSnapshotsUsing(observations,sources,query,resolve);
    const selection=structuredClone(normal.selection), metadataSelection=structuredClone(normal.selection);
    const records:(ObservedFinancialSnapshotRecord & {financialVersionDecisionSha256?:string;financialVersionEvidenceSha256?:string})[]=[...normal.records];
    for(const decision of proof.decisions){
        if(decision.status!=='selected-source' || rootDocIDs && !rootDocIDs.has(decision.rootDocID)) continue;
        const ids=new Set([decision.rootDocID,decision.selectedDocID]);
        const direct=createObservedFinancialSnapshotsUsing(observations.filter(o=>ids.has(o.document.docID)),sources.filter(s=>ids.has(s.docID)),query,resolve);
        const record=direct.records[0];
        if(direct.records.length!==1 || record.docID!==decision.selectedDocID || record.result.status!=='resolved' || records.some(r=>r.rootDocID===decision.rootDocID)) throw Error('認証済み金融原本の直接抽出が不一致です');
        const version=decision.sourceVersions.find(v=>v.docID===record.docID);
        if(!version || record.sourceSha256!==version.sourceSha256 || !bundle.sources.some(s=>s.docID===record.docID && s.sourceSha256===version.sourceSha256 && s.availableAt===version.availableAt))throw Error('金融版の採用原本宣言が不一致です');
        const m=record.result.basis.metadata,i=version.identity;
        const actual=[m.edinetCode,m.securityCode,m.documentType,m.instant,m.fiscalYear.startDate,m.fiscalYear.endDate,m.reportingPeriodCode,m.accountingStandard,m.scope];
        const expected=[i.issuer,i.security,i.form,i.currentPeriod,i.fiscalStart,i.fiscalEnd,i.periodCode,i.standard,i.scope];
        if(actual.some((value,n)=>value!==expected[n]))throw Error('金融版の認証済み基準・主範囲・期間と解析cacheが不一致です');
        const selected=structuredClone(decision.selected);
        if(selected.rootDocID!==record.rootDocID || selected.observation.document.docID!==record.docID || JSON.stringify(selected.chainDocIDs)!==JSON.stringify(record.chainDocIDs)) throw Error('金融版の公式系列が直接原本と不一致です');
        // 因果時刻と観測集合には採用しなかった兄弟原本の確認も含みます。
        record.knownAt=decision.knownAt;
        record.observationIds=[...decision.observationIds];
        records.push({...record,financialVersionDecisionSha256:decision.sha256,financialVersionEvidenceSha256:proof.sha256});
        selection.selected.push(selected);
        selection.decisions=selection.decisions.filter(d=>d.rootDocID!==decision.rootDocID).concat(direct.selection.decisions.map(d=>({...d,observationIds:[...decision.observationIds]})));
    }
    return {...normal,selectionMode:proof.policy,selection,records,metadataSelection,financialVersionSelection:structuredClone(proof.decisions.filter(d=>rootDocIDs===undefined||rootDocIDs.has(d.rootDocID))),financialVersionProof:proof};
}
export type SourceBackedObservedFinancialSnapshots=ReturnType<typeof createSourceBackedObservedFinancialSnapshots>;
