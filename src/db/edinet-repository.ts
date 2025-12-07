import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { EdinetDocument } from "../edinet-xbrl-downloader";
import { EdinetMetadata } from "./edinet-metadata";

export interface DocumentSearchCriteria {
    secCode?: string;      // 5-digit code (e.g. 72030)
    docTypeCode?: string;  // e.g. 120, 130
    filerName?: string;    // Partial match (e.g. "Toyota")
    startDate?: string;    // YYYY-MM-DD
    endDate?: string;      // YYYY-MM-DD
    limit?: number;
}


export class EdinetRepository {
    private db: Database.Database;

    constructor(dbPath?: string) {
        const defaultPath = path.resolve(process.cwd(), "data", "edinet.db");
        const targetPath = dbPath || defaultPath;

        // データの保存ディレクトリを確保
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(targetPath);
        this.initSchema();
    }

    private initSchema() {
        // docs/REQUESTS_04.md & REQUESTS_05.md で定義されたスキーマ
        const schema = `
        CREATE TABLE IF NOT EXISTS documents (
          doc_id TEXT PRIMARY KEY,
          sec_code TEXT,        -- "72030" (末尾0付き)
          filer_name TEXT,      -- "トヨタ自動車株式会社"
          doc_type_code TEXT,   -- "120"(有報), "130"(四半期) 等
          submit_date TEXT,     -- "2024-06-25" (提出日)
          period_end TEXT,      -- "2024-03-31" (決算日)
          doc_description TEXT  -- "有価証券報告書" (念のためタイトルも)
        );

        CREATE INDEX IF NOT EXISTS idx_sec_code ON documents(sec_code);
        CREATE INDEX IF NOT EXISTS idx_submit_date ON documents(submit_date);
        -- 横断検索用のインデックス追加
        CREATE INDEX IF NOT EXISTS idx_filer_name ON documents(filer_name);
        CREATE INDEX IF NOT EXISTS idx_doc_type ON documents(doc_type_code);
        `;
        this.db.exec(schema);
    }

    public insertDocument(doc: EdinetDocument, submitDate: string) {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO documents 
            (doc_id, sec_code, filer_name, doc_type_code, submit_date, period_end, doc_description)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            doc.docID,
            doc.secCode,
            doc.filerName,
            doc.docTypeCode,
            submitDate,
            doc.periodEnd,
            doc.docDescription
        );
    }

    public insertBatch(docs: EdinetDocument[], submitDate: string) {
        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO documents 
            (doc_id, sec_code, filer_name, doc_type_code, submit_date, period_end, doc_description)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = this.db.transaction((documents: EdinetDocument[]) => {
            for (const doc of documents) {
                insert.run(
                    doc.docID,
                    doc.secCode,
                    doc.filerName,
                    doc.docTypeCode,
                    submitDate,
                    doc.periodEnd,
                    doc.docDescription
                );
            }
        });

        insertMany(docs);
    }

    public findDocuments(criteria: DocumentSearchCriteria): EdinetMetadata[] {
        let query = "SELECT * FROM documents WHERE 1=1";
        const params: any[] = [];

        if (criteria.secCode) {
            query += " AND sec_code = ?";
            params.push(criteria.secCode);
        }

        if (criteria.docTypeCode) {
            query += " AND doc_type_code = ?";
            params.push(criteria.docTypeCode);
        }

        if (criteria.filerName) {
            query += " AND filer_name LIKE ?";
            params.push(`%${criteria.filerName}%`);
        }

        if (criteria.startDate) {
            query += " AND submit_date >= ?";
            params.push(criteria.startDate);
        }

        if (criteria.endDate) {
            query += " AND submit_date <= ?";
            params.push(criteria.endDate);
        }

        // デフォルトで期間終了日(period_end)の降順でソート
        query += " ORDER BY period_end DESC";

        if (criteria.limit) {
            query += " LIMIT ?";
            params.push(criteria.limit);
        }

        return this.db.prepare(query).all(...params) as EdinetMetadata[];
    }

    public close() {
        this.db.close();
    }
}
