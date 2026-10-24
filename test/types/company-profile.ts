import {createCompanyProfile,CompanyProfileFieldId,type CompanyProfile} from "../../src/index";
const profile:CompanyProfile=createCompanyProfile("","SYNTHETIC1");
const selected=profile.fields[CompanyProfileFieldId.SecurityCode];
if(selected.status==="selected"){const raw:string=selected.raw;const id:string=selected.source.docID;}
// @ts-expect-error 未知の会社情報IDを拒否
const invalid:CompanyProfileFieldId="industry";
// @ts-expect-error 書類IDは明示文字列
createCompanyProfile("",123);
