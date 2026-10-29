import {queryCompanyMaster, type CompanyMasterRecord, type CompanyMasterSnapshot} from './company-master';
const fields = ['securityCode','corporateNumber','name','filerType','listingStatus','industry','fiscalYearEndRaw','fiscalYearEndMonth'] as const;
export type CompanyMasterChangedField = typeof fields[number];
export interface CompanyMasterChange {
    entityId: string; edinetCode: string;
    kind: 'record-added' | 'record-absent' | 'attributes-changed';
    before: CompanyMasterRecord | null; after: CompanyMasterRecord | null;
    fields: CompanyMasterChangedField[];
}
/** 二つの完全なコードリスト間で観測された差。法的な上廃/合併日を推測しません。 */
export function compareCompanyMasterSnapshots(previous: CompanyMasterSnapshot, current: CompanyMasterSnapshot) {
    const snapshots = structuredClone([previous,current]);
    const [a,b] = snapshots.map(s => {
        if (!s) throw new Error('二つの企業マスターが必要です');
        const result = queryCompanyMaster([s],{asOf:s.asOf,knownAt:s.observedAt});
        if (result.status !== 'available') throw new Error('企業マスターを確定できません');
        return result;
    });
    if (a.sourceUrl !== b.sourceUrl || a.asOf > b.asOf || Date.parse(a.observedAt) > Date.parse(b.observedAt)) throw new Error('同じ出典の時系列順で指定してください');
    const sameRows = JSON.stringify(a.rows.map(r=>[r.edinetCode,...fields.map(f=>r[f]??null)])) === JSON.stringify(b.rows.map(r=>[r.edinetCode,...fields.map(f=>r[f]??null)]));
    if (a.sourceSha256 === b.sourceSha256 && (!sameRows || a.asOf !== b.asOf) || a.asOf === b.asOf && Date.parse(a.observedAt) === Date.parse(b.observedAt) && a.sourceSha256 !== b.sourceSha256) throw new Error('企業マスターの出典/同時点が競合しています');
    const old = new Map(a.rows.map(r=>[r.edinetCode,r])), now = new Map(b.rows.map(r=>[r.edinetCode,r]));
    const rows: CompanyMasterChange[] = [];
    for (const code of [...new Set([...old.keys(),...now.keys()])].sort()) {
        const before=old.get(code)??null,after=now.get(code)??null;
        const changed=fields.filter(f=>before?.[f]!==after?.[f]);
        if (!before || !after || changed.length) rows.push({entityId:`edinet:${code}`,edinetCode:code,kind:!before?'record-added':!after?'record-absent':'attributes-changed',before,after,fields:[...changed]});
    }
    const source = (s: typeof a) => ({asOf:s.asOf,observedAt:s.observedAt,sourceUrl:s.sourceUrl,sourceSha256:s.sourceSha256});
    return {previous:source(a),current:source(b),dateMeaning:'snapshot-boundaries' as const,rows,total:rows.length};
}
