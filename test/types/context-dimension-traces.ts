import {EdinetXbrlObject,type ContextDimensionsTraceResult,type ContextDimensionEntryTrace,type DimensionQNameTrace} from '../../src/index';
const object=new EdinetXbrlObject('SYNTHETIC');
const legacy=new EdinetXbrlObject();
const result:ContextDimensionsTraceResult=object.traceContextDimensions('row-context');
for(const candidate of result.candidates)for(const dimension of candidate.dimensions){
 const value:ContextDimensionEntryTrace=dimension;
 if(value.kind==='explicit'){
  const axis:DimensionQNameTrace=value.axis,member:DimensionQNameTrace=value.member;
  void axis;void member;
 }
}
const validation:'not-performed'=result.dtsValidation;
void validation;void legacy;

const lexical: "not-performed" = result.originalLexicalValidation;
void lexical;
