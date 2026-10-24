import {extractSubsidiaryHumanCapitalLabels,searchSubsidiaryHumanCapitalLabels,SubsidiaryHumanCapitalLabelOperator,type SubsidiaryHumanCapitalLabelMetadata} from '../../src/index';
const metadata:SubsidiaryHumanCapitalLabelMetadata={docID:'SYNTHETIC',instant:'2026-03-31',secCode:'1001'};
const snapshot=extractSubsidiaryHumanCapitalLabels('<synthetic/>',metadata);
const results=searchSubsidiaryHumanCapitalLabels([{xml:'<synthetic/>',metadata}],{conditions:[{operator:SubsidiaryHumanCapitalLabelOperator.Contains,value:'SYNTHETIC'}]});
const hash:string=snapshot.inputXmlSha256;
const lexical:'not-performed'=results.originalLexicalValidation;
void hash;void lexical;
