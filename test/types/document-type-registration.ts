import {EdinetDocumentType, EdinetXbrlDownloader} from '../../src/index';
const notice: EdinetDocumentType = EdinetDocumentType.SecuritiesNotice;
const registration: EdinetDocumentType = EdinetDocumentType.RegistrationStatement;
// 実行しない型使用例。登録030と旧名010が既存search引数型へ渡せる。
declare const downloader: EdinetXbrlDownloader;
void (() => downloader.search('2026-01-01',[notice,registration,EdinetDocumentType.SecuritiesRegistrationStatement]));
