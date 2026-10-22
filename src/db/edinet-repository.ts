import type { SQLInputValue } from "node:sqlite";
import { Database, type NativeDatabase } from "./node-sqlite";
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


export interface EdinetRepositoryOptions {
    /** 既存DBを変更せず開きます。schema初期化・親directory作成も行いません。 */
    readOnly?: boolean;
    /** lock待ち時間(ms)。従来のbetter-sqlite3既定値と同じ5000ms。 */
    timeout?: number;
}

export class EdinetRepository {
    private db: NativeDatabase;

    constructor(dbPath?: string, options: EdinetRepositoryOptions = {}) {
        const defaultPath = path.resolve(process.cwd(), "data", "edinet.db");
        const targetPath = dbPath || defaultPath;

        // データの保存ディレクトリを確保
        const dir = path.dirname(targetPath);
        if (!options.readOnly && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(targetPath, { readOnly: options.readOnly ?? false, timeout: options.timeout ?? 5000 });
        try {
            if (!options.readOnly) this.initSchema();
        } catch (error) {
            this.db.close();
            throw error;
        }
    }

    private initSchema() {
        // 設計経緯: docs/history/requests/REQUESTS_04.md と REQUESTS_05.md
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
        
        -- 高速化用複合インデックス
        -- 特定企業の特定書類を日付順で取得するクエリ用
        CREATE INDEX IF NOT EXISTS idx_sec_doc_type_date ON documents(sec_code, doc_type_code, period_end DESC);
        `;
        this.db.exec(schema);
    }

    private documentValues(doc: EdinetDocument, submitDate: string): SQLInputValue[] {
        return [doc.docID, doc.secCode, doc.filerName, doc.docTypeCode, submitDate, doc.periodEnd, doc.docDescription]
            .map(value => {
                if (value === null || value === undefined) return null;
                if (typeof value !== "string") throw new TypeError("書類メタデータは文字列またはnullで指定してください");
                return value;
            });
    }

    private prepareInsert() {
        return this.db.prepare(`
            INSERT OR IGNORE INTO documents
            (doc_id, sec_code, filer_name, doc_type_code, submit_date, period_end, doc_description)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
    }

    public insertDocument(doc: EdinetDocument, submitDate: string) {
        const statement = this.prepareInsert();
        try {
            statement.run(...this.documentValues(doc, submitDate));
        } finally {
            statement.close();
        }
    }

    public insertBatch(docs: EdinetDocument[], submitDate: string) {
        const statement = this.prepareInsert();
        try {
            this.db.exec("BEGIN");
            try {
                for (const doc of docs) statement.run(...this.documentValues(doc, submitDate));
                this.db.exec("COMMIT");
            } catch (error) {
                if (this.db.isTransaction) this.db.exec("ROLLBACK");
                throw error;
            }
        } finally {
            statement.close();
        }
    }

    public hasMetadataForDate(dateStr: string): boolean {
        const stmt = this.db.prepare("SELECT 1 FROM documents WHERE submit_date = ? LIMIT 1");
        try {
            return !!stmt.get(dateStr);
        } finally {
            stmt.close();
        }
    }

    public findDocuments(criteria: DocumentSearchCriteria): EdinetMetadata[] {
        let query = `
            SELECT 
                doc_id as docID, 
                sec_code as secCode, 
                filer_name as filerName, 
                doc_type_code as docTypeCode, 
                submit_date as submitDate, 
                period_end as periodEnd, 
                doc_description as docDescription
            FROM documents WHERE 1=1
        `;
        const params: SQLInputValue[] = [];

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

        const statement = this.db.prepare(query);
        try {
            // node:sqliteのnull-prototype行を、従来と同じ通常のオブジェクトで公開します。
            return statement.all(...params).map(row => ({ ...row })) as unknown as EdinetMetadata[];
        } finally {
            statement.close();
        }
    }

    public close() {
        this.db.close();
    }
}
