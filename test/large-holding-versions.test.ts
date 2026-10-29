import {describe,it,expect} from 'vitest';
import {selectLargeHoldingReportVersions as select,type LargeHoldingVersionObservation as Observation} from '../src/index';
const cutoff='2026-10-28T00:00:00Z';
function obs(id='A',parent?:string,change:Partial<Observation['document']>={},observedAt='2025-06-25T00:00:00Z'):Observation{
 return {observationId:id+'-'+observedAt,observedAt,document:{docID:id,docTypeCode:parent?'360':'350',formCode:parent?'090001':'010002',parentDocID:parent,edinetCode:'E12345',issuerEdinetCode:'E54321',submitDateTime:parent?'2025-06-24 09:00':'2025-06-23 09:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0',...change}};
}
describe('大量保有の観測版選択',()=>{
 it('訂正末端だけを選び入力順序に依存しない',()=>{
  const a=obs(),b=obs('B','A'),c=obs('C','B',{submitDateTime:'2025-06-25 09:00'},'2025-06-26T00:00:00Z');
  const result=select([a,b,c],cutoff);expect(result.selected.map(s=>s.observation.document.docID)).toEqual(['C']);expect(result.decisions[0].chainDocIDs).toEqual(['A','B','C']);
  for(const inputs of [[c,b,a],[b,a,c],[b,c,a]])expect(select(inputs,cutoff)).toEqual(result);
 });
 it('350の親参照は自己参照も含め訂正系列へ合併しない',()=>{
  expect(select([obs('A',undefined,{parentDocID:'A'}),obs('B',undefined,{parentDocID:'A'})],cutoff).selected).toHaveLength(2);
 });
 it('cutoffより後の訂正を観測しなかった時点では親を選ぶ',()=>{
  const r=select([obs(),obs('B','A',{},'2026-10-29T00:00:00Z')],cutoff);expect(r.selected[0].rootDocID).toBe('A');expect(r.ignored[0].reason).toBe('after-cutoff');
 });
 it('後から確認した親のメタデータ時刻も選択の既知時刻へ反映する',()=>{
  const r=select([obs('A',undefined,{},'2025-07-01T00:00:00Z'),obs('B','A')],cutoff);expect(r.selected[0].observedAt).toBe('2025-07-01T00:00:00.000Z');
 });
 it('新しい非対応書類種別で上書きされた古い観測へ戻らない',()=>{
  const r=select([obs(),obs('A',undefined,{docTypeCode:'120'},'2025-07-01T00:00:00Z')],cutoff);expect(r.selected).toEqual([]);expect(r.ignored.map(i=>i.reason)).toContain('superseded-observation');
 });
 it('同時刻の異なる発行者宣言を不確定にする',()=>{
  const a=obs(),b=obs('A',undefined,{issuerEdinetCode:'E99999'});b.observationId='conflict';const r=select([a,b],cutoff);expect(r.selected).toEqual([]);expect(r.decisions[0].reason).toBe('conflicting-observations');
 });
 it('同時刻の数値と文字列の状態コードは同じ状態と扱う',()=>{
  const a=obs(),b=obs('A',undefined,{withdrawalStatus:0,disclosureStatus:0,docInfoEditStatus:0});b.observationId='numeric';expect(select([a,b],cutoff).selected[0].observationIds).toHaveLength(2);
 });
 it('同時刻の訂正の参照先競合は両方の旧版の選択を阻止する',()=>{
  const b=obs('B','A'),c=obs('B','X');c.observationId='conflict';const r=select([obs(),obs('X'),b,c],cutoff);expect(r.selected).toEqual([]);expect(r.decisions.filter(d=>d.reason==='unresolved-correction')).toHaveLength(2);
 });
 it.each([
  [{issuerEdinetCode:'E99999'},'issuer-mismatch'],
  [{edinetCode:'E99999'},'filer-mismatch'],
  [{submitDateTime:'2025-06-22 09:00'},'non-chronological-chain'],
 ] as const)('不整合訂正で旧版を採用しない %j',(change,reason)=>{
  const r=select([obs(),obs('B','A',change)],cutoff);expect(r.selected).toEqual([]);expect(r.decisions.some(d=>d.reason===reason)).toBe(true);
 });
 it.each([
  [{withdrawalStatus:'2'},'withdrawn','unavailable'],
  [{disclosureStatus:'2'},'non-disclosed','unavailable'],
  [{docInfoEditStatus:'1'},'notice-only','unavailable'],
  [{docInfoEditStatus:'2'},'edited-metadata-unverified','unresolved'],
  [{withdrawalStatus:undefined},'unknown-status','unresolved'],
  [{formCode:'999999'},'form-unavailable','unresolved'],
  [{issuerEdinetCode:null},'issuer-unavailable','unresolved'],
 ] as const)('利用状態を明示する %j',(change,reason,status)=>{
  const r=select([obs('A',undefined,change)],cutoff);expect(r.selected).toEqual([]);expect(r.decisions[0]).toMatchObject({reason,status});
 });
 it('撤回済み訂正は除外理由を残し原報告を選べる',()=>{
  const r=select([obs(),obs('B','A',{withdrawalStatus:'2'})],cutoff);expect(r.selected[0].observation.document.docID).toBe('A');expect(r.decisions[0].inactiveDocuments).toEqual([{docID:'B',reason:'withdrawn'}]);
 });
 it('撤回済み親を辿る有効な訂正は採用しない',()=>{
  expect(select([obs(),obs('B','A',{withdrawalStatus:'2'}),obs('C','B')],cutoff).decisions[0].reason).toBe('inactive-parent');
 });
 it('分岐訂正、親不明、循環は未確定にする',()=>{
  expect(select([obs(),obs('B','A'),obs('C','A')],cutoff).decisions[0].reason).toBe('multiple-correction-leaves');
  expect(select([obs('B','missing')],cutoff).decisions[0].reason).toBe('parent-missing');
  expect(select([obs('B','C'),obs('C','B')],cutoff).decisions.every(d=>d.reason==='cycle')).toBe(true);
 });
 it('不要な会計期間や未知プロパティを読まない',()=>{
  const a=obs();Object.defineProperty(a.document,'periodStart',{get(){throw Error('not used');}});expect(select([a],cutoff).selected).toHaveLength(1);
 });
 it('不正な時刻、重複観測ID、観測より未来の提出、件数超過を拒否する',()=>{
  for(const run of [()=>select([],cutoff.slice(0,-1)),()=>select([obs('A',undefined,{parentDocID:{} as never})],cutoff),()=>select([obs(),obs()],cutoff),()=>select([obs('A',undefined,{},'2024-01-01T00:00:00Z')],cutoff),()=>select(Array(10001).fill(obs()),cutoff)])expect(run).toThrow();
 });
});

describe('大量保有の項目削除を伴う日次再観測',()=>{
 const removed=(id='A',withdrawalStatus='0')=>obs(id,undefined,{docTypeCode:null,formCode:null,edinetCode:null,issuerEdinetCode:null,submitDateTime:null,parentDocID:null,withdrawalStatus},'2025-07-01T00:00:00Z');
 it('種類の消えた元書類を取下げとして記録する',()=>{
  const result=select([obs(),removed('A','2')],cutoff);expect(result.selected).toEqual([]);expect(result.decisions[0]).toMatchObject({status:'unavailable',reason:'withdrawn',observationIds:expect.arrayContaining([obs().observationId,removed().observationId])});
 });
 it('訂正の親まで消えたときも、以前の参照根拠で古い元書類へのfallbackを止める',()=>{
  const root=obs(),correction=obs('B','A'),after=removed('B');const result=select([root,correction,after],cutoff);
  expect(result.selected).toEqual([]);expect(result.decisions.find(d=>d.rootDocID==='A')).toMatchObject({reason:'unresolved-correction',observationIds:expect.arrayContaining([correction.observationId,after.observationId])});expect(result.decisions.find(d=>d.rootDocID==='B')?.reason).toBe('document-type-unavailable');
 });
 it('取下げられた訂正は元を残し、350の旧parent参照では別系列を阻止しない',()=>{
  const restored=select([obs(),obs('B','A'),removed('B','2')],cutoff);expect(restored.selected[0].rootDocID).toBe('A');expect(restored.selected[0].observedAt).toBe('2025-07-01T00:00:00.000Z');expect(restored.decisions.find(d=>d.rootDocID==='A')?.observationIds).toContain(removed('B').observationId);expect(select([obs(),obs('B','A'),removed('B','2')],'2025-06-30T00:00:00Z').selected[0].observation.document.docID).toBe('B');
  const result=select([obs(),obs('X',undefined,{parentDocID:'A'}),removed('X')],cutoff);expect(result.selected.map(s=>s.rootDocID)).toEqual(['A']);
 });
 it('将来の項目削除は以前のcutoffに持ち込まない',()=>{
  const after=removed();after.observedAt='2026-10-29T00:00:00Z';expect(select([obs(),after],cutoff).selected[0].rootDocID).toBe('A');
 });
});

it('同時刻の種別消失を伴う参照先競合でも、両方の旧大量保有系列を止める',()=>{
 const a=obs(),x=obs('X'),b=obs('B','A'),other=obs('B','X',{docTypeCode:null});other.observationId='conflict';
 const result=select([a,x,b,other],cutoff);expect(result.selected).toEqual([]);
 for(const id of ['A','X'])expect(result.decisions.find(d=>d.rootDocID===id)).toMatchObject({reason:'unresolved-correction',observationIds:expect.arrayContaining([b.observationId,'conflict'])});
 expect(select([other,b,x,a],cutoff)).toEqual(result);
});
it('種別が消えた大量保有訂正の旧参照先と新宣言先を、根拠付きで両方止める',()=>{
 const b=obs('B','A'),after=obs('B','X',{docTypeCode:null},'2025-07-01T00:00:00Z');
 const result=select([obs(),obs('X'),b,after],cutoff);expect(result.selected).toEqual([]);
 for(const id of ['A','X'])expect(result.decisions.find(d=>d.rootDocID===id)?.observationIds).toEqual(expect.arrayContaining([b.observationId,after.observationId]));
});
