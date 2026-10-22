import * as fs from "node:fs";
import * as XLSX from "xlsx";

// SheetJS CE 0.20.xのESM buildはNodeのfilesystemを自動設定しません。
// 型/資料生成スクリプトで共有し、CLI本体のruntime依存にはしません。
XLSX.set_fs(fs);

export { XLSX };
