import {screenCompanyDocuments,CompanyProfileFieldId,CompanyProfileOperator,SortOrder} from "../../src/index";
screenCompanyDocuments([{xml:"",docID:"SYNTHETIC1"}],{conditions:[{field:CompanyProfileFieldId.FilerName,operator:CompanyProfileOperator.Contains,value:"合成"}],fiscalYearEndMonth:3,sortBy:CompanyProfileFieldId.EdinetCode,order:SortOrder.Ascending});
// @ts-expect-error 未実装の業種fieldを混ぜない
screenCompanyDocuments([],{sortBy:"industry"});
// @ts-expect-error 数値比較を文字列原文条件に混ぜない
screenCompanyDocuments([],{conditions:[{field:CompanyProfileFieldId.EdinetCode,operator:"gte",value:"E00001"}]});
// @ts-expect-error コードを数値化しない
screenCompanyDocuments([],{conditions:[{field:CompanyProfileFieldId.SecurityCode,operator:CompanyProfileOperator.Equal,value:1234}]});
