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
    private readonly readOnly:boolean;

    constructor(dbPath?: string, options: EdinetRepositoryOptions = {}) {
        this.readOnly=options.readOnly??false;
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
          doc_type_code TEXT,   -- "120"(有報), "130"(訂正有報) 等
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
        CREATE TABLE IF NOT EXISTS document_list_fetches (
          list_date TEXT PRIMARY KEY,
          fetched_at TEXT NOT NULL,
          document_count INTEGER NOT NULL CHECK(document_count >= 0)
        );
        CREATE TABLE IF NOT EXISTS document_observations (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          list_date TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          doc_id TEXT NOT NULL,
          document_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_document_observations_id ON document_observations(doc_id, observed_at, sequence);
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
        this.writeBatch(docs, submitDate, false);
    }

    /** 公式の1日分一覧を原子的に保存。0件の日も取得した証跡を残します。 */
    public saveDocumentList(docs: EdinetDocument[], date: string): void {
        if (!Array.isArray(docs) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
            throw new Error("一覧の日付または配列が不正です");
        this.writeBatch(Array.from(docs, doc => structuredClone(doc)), date, true);
    }

    /** 当日中の取得は完了扱いせず、日付が閉じた後に一度取り直します（日本時間）。 */
    public hasCompleteListForDate(date: string): boolean {
        const table = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='document_list_fetches'");
        try { if (!table.get()) return false; } finally { table.close(); }
        const statement = this.db.prepare("SELECT 1 FROM document_list_fetches WHERE list_date=? AND date(fetched_at, '+9 hours') > list_date");
        try { return !!statement.get(date); } finally { statement.close(); }
    }

    private writeBatch(docs: EdinetDocument[], submitDate: string, complete: boolean) {
        const statement = this.prepareInsert();
        try {
            this.db.exec("BEGIN");
            try {
                for (const doc of docs) statement.run(...this.documentValues(doc, submitDate));
                if (complete) {
                    const observedAt = new Date().toISOString();
                    const observation = this.db.prepare("INSERT INTO document_observations(list_date, observed_at, doc_id, document_json) VALUES (?, ?, ?, ?)");
                    try {
                        for (const doc of docs) observation.run(submitDate, observedAt, doc.docID, JSON.stringify(doc));
                    } finally { observation.close(); }
                    const marker = this.db.prepare("INSERT INTO document_list_fetches (list_date, fetched_at, document_count) VALUES (?, ?, ?) ON CONFLICT(list_date) DO UPDATE SET fetched_at=excluded.fetched_at, document_count=excluded.document_count");
                    try { marker.run(submitDate, observedAt, docs.length); } finally { marker.close(); }
                }
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

    public assertWritable():void {
        if(this.readOnly||!this.db.isOpen)throw new Error("書込可能なメタデータDBが必要です");
    }

    /** 観測転送の開始時点を固定し、転送中に増えた観測は次の巡回へ回します。 */
    public getLastObservationSequence(): number {
        const table=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='document_observations'");
        try {if(!table.get())return 0;}finally{table.close();}
        const statement=this.db.prepare("SELECT COALESCE(MAX(sequence),0) AS sequence FROM document_observations");
        try {return Number(statement.get()!.sequence);}finally{statement.close();}
    }

    /** 一覧の原観測を上書きせず読む。旧DBにない履歴を復元した扱いにはしません。 */
    public getDocumentObservations(options: { docID?: string; knownAt?: string; afterSequence?: number; limit?: number } = {}) {
        const { docID, knownAt, afterSequence = 0, limit = 10000 } = options;
        if (Object.keys(options).some(key => !["docID", "knownAt", "afterSequence", "limit"].includes(key)) ||
            docID !== undefined && (typeof docID !== "string" || !docID.trim()) ||
            !Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 10000 ||
            knownAt !== undefined && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(knownAt) || !Number.isFinite(Date.parse(knownAt)))) throw new Error("観測の検索条件が不正です");
        const table = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='document_observations'");
        try { if (!table.get()) return []; } finally { table.close(); }
        const parameters: SQLInputValue[] = [afterSequence], clauses = ["sequence > ?"];
        if (docID !== undefined) { clauses.push("doc_id = ?"); parameters.push(docID); }
        if (knownAt !== undefined) { clauses.push("observed_at <= ?"); parameters.push(new Date(knownAt).toISOString()); }
        parameters.push(limit);
        const statement = this.db.prepare(`SELECT sequence, list_date, observed_at, doc_id, document_json FROM document_observations WHERE ${clauses.join(" AND ")} ORDER BY sequence LIMIT ?`);
        try {
            return statement.all(...parameters).map(row => {
                let document: EdinetDocument;
                try { document = JSON.parse(String(row.document_json)); } catch { throw new Error("保存観測のJSONが不正です（内容は非表示）"); }
                if (!document || typeof document !== "object" || document.docID !== row.doc_id) throw new Error("保存観測の書類IDが不整合です");
                return { sequence: Number(row.sequence), observationId: `metadata-${row.sequence}`,
                    listDate: String(row.list_date), observedAt: String(row.observed_at), document };
            });
        } finally { statement.close(); }
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
