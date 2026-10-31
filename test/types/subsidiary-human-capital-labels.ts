import {extractSubsidiaryHumanCapitalLabels,searchSubsidiaryHumanCapitalLabels,SubsidiaryHumanCapitalLabelOperator,type SubsidiaryHumanCapitalLabelMetadata} from '../../src/index';
const metadata:SubsidiaryHumanCapitalLabelMetadata={docID:'SYNTHETIC',instant:'2026-03-31',secCode:'1001'};
const snapshot=extractSubsidiaryHumanCapitalLabels('<synthetic/>',metadata);
const results=searchSubsidiaryHumanCapitalLabels([{xml:'<synthetic/>',metadata}],{conditions:[{operator:SubsidiaryHumanCapitalLabelOperator.Contains,value:'SYNTHETIC'}]});
const hash:string=snapshot.inputXmlSha256;
const lexical:'not-performed'=results.originalLexicalValidation;
void hash;void lexical;

import {extractSubsidiaryHumanCapitalMetrics,screenSubsidiaryHumanCapitalMetrics,SubsidiaryHumanCapitalMetricId,type SubsidiaryHumanCapitalAnnotationInput,type SubsidiaryHumanCapitalNoteInterpretation} from '../../src/index';
const automaticNotes:SubsidiaryHumanCapitalAnnotationInput='auto';
const automaticallyExtracted=extractSubsidiaryHumanCapitalMetrics('<synthetic/>',metadata,[SubsidiaryHumanCapitalMetricId.MaleChildcareLeaveAllRatio],automaticNotes);
const automaticEvidence:SubsidiaryHumanCapitalNoteInterpretation|undefined=automaticallyExtracted.noteInterpretation;
const automaticSearch=screenSubsidiaryHumanCapitalMetrics([{xml:'<synthetic/>',metadata,annotations:'auto'}],SubsidiaryHumanCapitalMetricId.MaleChildcareLeaveAllRatio,{childcareMethod:'ordinance-item2'});
const sourceEvidence:SubsidiaryHumanCapitalNoteInterpretation|undefined=automaticSearch.sources[0]?.noteInterpretation;
// @ts-expect-error unsupported automatic mode
const unsupportedMode:SubsidiaryHumanCapitalAnnotationInput='automatic';
