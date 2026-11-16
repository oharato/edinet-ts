import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { CompanyFinancialComparison, ScreeningCriteria } from "../types.js";
import type { XbrlFactRow } from "./facts.js";

export interface ScreeningResultRow {
  edinetCode: string;
  securityCode: string;
  companyName: string;
  periodEnd: string;
  isConsolidated: boolean;
  netSalesCurrent?: number;
  operatingIncomeCurrent?: number;
  operatingMarginCurrent?: number;
  operatingMarginPrior?: number;
  operatingMarginGrowthRate?: number;
  operatingMarginDelta?: number;
  salesGrowthRate?: number;
  operatingIncomeGrowthRate?: number;
  equityRatioCurrent?: number;
  equityRatioPrior?: number;
  roeCurrent?: number;
  roaCurrent?: number;
  operatingCfCurrent?: number;
  investingCfCurrent?: number;
  freeCashFlowCurrent?: number;
  cashAndEquivalentsCurrent?: number;
  dividendPerShareCurrent?: number;
  dividendGrowthRate?: number;
  epsCurrent?: number;
  bpsCurrent?: number;
  numberOfEmployees?: number;
  operatingIncomePerEmployee?: number;
  docTypeCode?: string;
  periodType?: string;
}

export class FinancialStore {
  private instance?: DuckDBInstance;
  private connection?: DuckDBConnection;
  private dbPath: string;

  constructor(dbPath: string = ":memory:") {
    this.dbPath = dbPath;
  }

  public async init(): Promise<void> {
    if (this.dbPath !== ":memory:") {
      const { mkdirSync } = await import("node:fs");
      const { dirname } = await import("node:path");
      mkdirSync(dirname(this.dbPath), { recursive: true });
    }
    this.instance = await DuckDBInstance.create(this.dbPath);
    this.connection = await this.instance.connect();

    await this.connection.run(`
      CREATE TABLE IF NOT EXISTS financial_summary (
        edinet_code VARCHAR,
        security_code VARCHAR,
        company_name VARCHAR,
        period_end VARCHAR,
        is_consolidated BOOLEAN,
        net_sales_current DOUBLE,
        net_sales_prior DOUBLE,
        operating_income_current DOUBLE,
        operating_income_prior DOUBLE,
        operating_margin_current DOUBLE,
        operating_margin_prior DOUBLE,
        operating_margin_growth_rate DOUBLE,
        operating_margin_delta DOUBLE,
        sales_growth_rate DOUBLE,
        operating_income_growth_rate DOUBLE,
        net_assets_current DOUBLE,
        total_assets_current DOUBLE,
        operating_cf_current DOUBLE,
        investing_cf_current DOUBLE,
        free_cash_flow_current DOUBLE,
        cash_and_equivalents_current DOUBLE,
        equity_ratio_current DOUBLE,
        equity_ratio_prior DOUBLE,
        roe_current DOUBLE,
        roa_current DOUBLE,
        dividend_per_share_current DOUBLE,
        dividend_growth_rate DOUBLE,
        eps_current DOUBLE,
        bps_current DOUBLE,
        number_of_employees INTEGER,
        operating_income_per_employee DOUBLE,
        PRIMARY KEY (company_name, period_end)
      );
    `);

    // 半期報告書（160/170）・訂正有価証券報告書（130）など、年次以外の定期報告用。
    // 年次の financial_summary とは分離し、doc_id を主キーにする。
    await this.connection.run(`
      CREATE TABLE IF NOT EXISTS financial_summary_periodic (
        doc_id VARCHAR PRIMARY KEY,
        doc_type_code VARCHAR,
        period_type VARCHAR,
        edinet_code VARCHAR,
        security_code VARCHAR,
        company_name VARCHAR,
        period_end VARCHAR,
        is_consolidated BOOLEAN,
        net_sales_current DOUBLE,
        net_sales_prior DOUBLE,
        operating_income_current DOUBLE,
        operating_income_prior DOUBLE,
        operating_margin_current DOUBLE,
        operating_margin_prior DOUBLE,
        operating_margin_growth_rate DOUBLE,
        operating_margin_delta DOUBLE,
        sales_growth_rate DOUBLE,
        operating_income_growth_rate DOUBLE,
        net_assets_current DOUBLE,
        total_assets_current DOUBLE,
        operating_cf_current DOUBLE,
        investing_cf_current DOUBLE,
        free_cash_flow_current DOUBLE,
        cash_and_equivalents_current DOUBLE,
        equity_ratio_current DOUBLE,
        equity_ratio_prior DOUBLE,
        roe_current DOUBLE,
        roa_current DOUBLE,
        dividend_per_share_current DOUBLE,
        dividend_growth_rate DOUBLE,
        eps_current DOUBLE,
        bps_current DOUBLE,
        number_of_employees INTEGER,
        operating_income_per_employee DOUBLE
      );
    `);

    // XBRLの全Fact（数値・テキストBlock・セグメント軸）を保存する汎用テーブル。
    await this.connection.run(`
      CREATE TABLE IF NOT EXISTS xbrl_facts (
        doc_id VARCHAR,
        concept VARCHAR,
        qname VARCHAR,
        context_id VARCHAR,
        value_text VARCHAR,
        value_numeric DOUBLE,
        unit VARCHAR,
        period_start VARCHAR,
        period_end VARCHAR,
        instant VARCHAR,
        dimensions VARCHAR,
        decimals INTEGER,
        scale INTEGER
      );
    `);

    // Fact取込済みdocIDの管理（キャッシュ削除の判定にも使う）。
    await this.connection.run(`
      CREATE TABLE IF NOT EXISTS xbrl_fact_documents (
        doc_id VARCHAR PRIMARY KEY,
        fact_count INTEGER,
        ingested_at TIMESTAMP DEFAULT current_timestamp
      );
    `);
  }

  public async insert(record: CompanyFinancialComparison): Promise<void> {
    if (!this.connection) throw new Error("Database not initialized");

    const stmt = await this.connection.prepare(`
      INSERT OR REPLACE INTO financial_summary VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31
      );
    `);

    this.bindSummaryColumns(stmt, record, 0);
    await stmt.run();
  }

  /**
   * 半期報告書（160/170）・訂正有価証券報告書（130）などを別テーブルに保存する。
   */
  public async insertPeriodic(
    record: CompanyFinancialComparison,
    docId: string,
    docTypeCode: string,
  ): Promise<void> {
    if (!this.connection) throw new Error("Database not initialized");

    const stmt = await this.connection.prepare(`
      INSERT OR REPLACE INTO financial_summary_periodic VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
      );
    `);

    stmt.bindVarchar(1, docId);
    stmt.bindVarchar(2, docTypeCode);
    stmt.bindVarchar(3, record.metadata.periodType || "");
    this.bindSummaryColumns(stmt, record, 3);
    await stmt.run();
  }

  private bindSummaryColumns(
    stmt: any,
    record: CompanyFinancialComparison,
    base: number,
  ): void {
    stmt.bindVarchar(base + 1, record.metadata.edinetCode || "");
    stmt.bindVarchar(base + 2, record.metadata.securityCode || "");
    stmt.bindVarchar(base + 3, record.metadata.companyName || "");
    stmt.bindVarchar(base + 4, record.metadata.periodEnd || "");
    stmt.bindBoolean(base + 5, record.current.isConsolidated);

    this.bindNullableDouble(stmt, base + 6, record.current.netSales);
    this.bindNullableDouble(stmt, base + 7, record.prior.netSales);
    this.bindNullableDouble(stmt, base + 8, record.current.operatingIncome);
    this.bindNullableDouble(stmt, base + 9, record.prior.operatingIncome);
    this.bindNullableDouble(stmt, base + 10, record.operatingMarginCurrent);
    this.bindNullableDouble(stmt, base + 11, record.operatingMarginPrior);
    this.bindNullableDouble(stmt, base + 12, record.operatingMarginGrowthRate);
    this.bindNullableDouble(stmt, base + 13, record.operatingMarginDelta);
    this.bindNullableDouble(stmt, base + 14, record.salesGrowthRate);
    this.bindNullableDouble(stmt, base + 15, record.operatingIncomeGrowthRate);

    this.bindNullableDouble(stmt, base + 16, record.current.netAssets);
    this.bindNullableDouble(stmt, base + 17, record.current.totalAssets);
    this.bindNullableDouble(stmt, base + 18, record.current.operatingCashFlow);
    this.bindNullableDouble(stmt, base + 19, record.current.investingCashFlow);
    this.bindNullableDouble(stmt, base + 20, record.freeCashFlowCurrent);
    this.bindNullableDouble(stmt, base + 21, record.current.cashAndEquivalents);
    this.bindNullableDouble(stmt, base + 22, record.equityRatioCurrent);
    this.bindNullableDouble(stmt, base + 23, record.equityRatioPrior);
    this.bindNullableDouble(stmt, base + 24, record.roeCurrent);
    this.bindNullableDouble(stmt, base + 25, record.roaCurrent);
    this.bindNullableDouble(stmt, base + 26, record.current.dividendPerShare);
    this.bindNullableDouble(stmt, base + 27, record.dividendGrowthRate);
    this.bindNullableDouble(stmt, base + 28, record.current.eps);
    this.bindNullableDouble(stmt, base + 29, record.current.bps);

    if (
      record.current.numberOfEmployees !== undefined &&
      !Number.isNaN(record.current.numberOfEmployees)
    ) {
      stmt.bindInteger(base + 30, Math.round(record.current.numberOfEmployees));
    } else {
      stmt.bindNull(base + 30);
    }

    this.bindNullableDouble(stmt, base + 31, record.operatingIncomePerEmployee);
  }

  /**
   * 登録済みの最新の決算期末日を取得します
   */
  public async getLatestPeriodEnd(): Promise<string | undefined> {
    if (!this.connection) throw new Error("Database not initialized");
    const reader = await this.connection.runAndReadAll(
      "SELECT MAX(period_end) as max_date FROM financial_summary WHERE period_end != ''",
    );
    const rows = reader.getRows();
    return rows[0]?.[0] ? String(rows[0][0]) : undefined;
  }

  /**
   * 登録済みの全レコードのキー（company_name:period_end）のセットを取得します
   */
  public async getExistingKeys(): Promise<Set<string>> {
    if (!this.connection) throw new Error("Database not initialized");
    const reader = await this.connection.runAndReadAll(
      "SELECT company_name, period_end FROM financial_summary",
    );
    const rows = reader.getRows();
    const set = new Set<string>();
    for (const row of rows) {
      set.add(`${row[0]}:${row[1]}`);
    }
    return set;
  }

  /**
   * バックフィル用: 既存の (証券コード, 決算期) セット。
   * 証券コードは4桁に正規化済みの値が入っている。
   */
  public async getExistingSecurityPeriods(): Promise<Set<string>> {
    if (!this.connection) throw new Error("Database not initialized");
    const reader = await this.connection.runAndReadAll(
      "SELECT security_code, period_end FROM financial_summary WHERE security_code <> '' AND period_end <> ''",
    );
    const rows = reader.getRows();
    const set = new Set<string>();
    for (const row of rows) {
      set.add(`${row[0]}:${row[1]}`);
    }
    return set;
  }

  /**
   * 半期・訂正テーブルに登録済みの doc_id セット。
   */
  public async getExistingPeriodicDocIds(): Promise<Set<string>> {
    if (!this.connection) throw new Error("Database not initialized");
    const reader = await this.connection.runAndReadAll(
      "SELECT doc_id FROM financial_summary_periodic",
    );
    const rows = reader.getRows();
    return new Set(rows.map((row) => String(row[0])));
  }

  /**
   * XBRLの全Factを一括投入する。大量行を想定してAppenderを使う。
   */
  public async appendFacts(rows: XbrlFactRow[]): Promise<void> {
    if (!this.connection) throw new Error("Database not initialized");
    if (rows.length === 0) return;

    const appender = await this.connection.createAppender("xbrl_facts");
    try {
      for (const row of rows) {
        appender.appendVarchar(row.docId);
        appender.appendVarchar(row.concept);
        appender.appendVarchar(row.qname);
        appender.appendVarchar(row.contextId);
        if (row.valueText === null) appender.appendNull();
        else appender.appendVarchar(row.valueText);
        if (row.valueNumeric === null) appender.appendNull();
        else appender.appendDouble(row.valueNumeric);
        if (row.unit === null) appender.appendNull();
        else appender.appendVarchar(row.unit);
        if (row.periodStart === null) appender.appendNull();
        else appender.appendVarchar(row.periodStart);
        if (row.periodEnd === null) appender.appendNull();
        else appender.appendVarchar(row.periodEnd);
        if (row.instant === null) appender.appendNull();
        else appender.appendVarchar(row.instant);
        if (row.dimensions === null) appender.appendNull();
        else appender.appendVarchar(row.dimensions);
        if (row.decimals === null) appender.appendNull();
        else appender.appendInteger(row.decimals);
        if (row.scale === null) appender.appendNull();
        else appender.appendInteger(row.scale);
        appender.endRow();
      }
      appender.flushSync();
    } finally {
      appender.closeSync();
    }
  }

  public async markFactDocument(docId: string, factCount: number): Promise<void> {
    if (!this.connection) throw new Error("Database not initialized");
    await this.connection.run(
      "INSERT OR REPLACE INTO xbrl_fact_documents (doc_id, fact_count) VALUES (?, ?)",
      [docId, factCount],
    );
  }

  public async getIngestedFactDocIds(): Promise<Set<string>> {
    if (!this.connection) throw new Error("Database not initialized");
    const reader = await this.connection.runAndReadAll("SELECT doc_id FROM xbrl_fact_documents");
    return new Set(reader.getRows().map((row) => String(row[0])));
  }

  public async screen(criteria: ScreeningCriteria = {}): Promise<ScreeningResultRow[]> {
    if (!this.connection) throw new Error("Database not initialized");

    const tableName =
      criteria.table === "periodic" ? "financial_summary_periodic" : "financial_summary";
    const conditions: string[] = [];

    if (criteria.whereClause) {
      conditions.push(`(${criteria.whereClause})`);
    }

    if (criteria.minMarginGrowth !== undefined) {
      conditions.push(`operating_margin_growth_rate >= ${criteria.minMarginGrowth}`);
    }
    if (criteria.minCurrentMargin !== undefined) {
      conditions.push(`operating_margin_current >= ${criteria.minCurrentMargin}`);
    }
    if (criteria.minSalesGrowth !== undefined) {
      conditions.push(`sales_growth_rate >= ${criteria.minSalesGrowth}`);
    }
    if (criteria.minOperatingIncomeGrowth !== undefined) {
      conditions.push(`operating_income_growth_rate >= ${criteria.minOperatingIncomeGrowth}`);
    }
    if (criteria.minEquityRatio !== undefined) {
      conditions.push(`equity_ratio_current >= ${criteria.minEquityRatio}`);
    }
    if (criteria.minRoe !== undefined) {
      conditions.push(`roe_current >= ${criteria.minRoe}`);
    }
    if (criteria.minRoa !== undefined) {
      conditions.push(`roa_current >= ${criteria.minRoa}`);
    }
    if (criteria.minFcf !== undefined) {
      conditions.push(`free_cash_flow_current >= ${criteria.minFcf}`);
    }
    if (criteria.consolidatedOnly) {
      conditions.push(`is_consolidated = true`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let orderCol = "operating_margin_current";
    if (criteria.orderBy === "margin_growth") orderCol = "operating_margin_growth_rate";
    else if (criteria.orderBy === "current_margin") orderCol = "operating_margin_current";
    else if (criteria.orderBy === "sales_growth") orderCol = "sales_growth_rate";
    else if (criteria.orderBy === "operating_income_growth")
      orderCol = "operating_income_growth_rate";
    else if (criteria.orderBy === "equity_ratio") orderCol = "equity_ratio_current";
    else if (criteria.orderBy === "roe") orderCol = "roe_current";
    else if (criteria.orderBy === "roa") orderCol = "roa_current";
    else if (criteria.orderBy === "fcf") orderCol = "free_cash_flow_current";
    else if (criteria.orderBy === "per_employee") orderCol = "operating_income_per_employee";

    const direction = criteria.orderDirection?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const limitClause = criteria.limit ? `LIMIT ${criteria.limit}` : "LIMIT 100";

    const query = `
      SELECT
        edinet_code,
        security_code,
        company_name,
        period_end,
        is_consolidated,
        net_sales_current,
        operating_income_current,
        operating_margin_current,
        operating_margin_prior,
        operating_margin_growth_rate,
        operating_margin_delta,
        sales_growth_rate,
        operating_income_growth_rate,
        equity_ratio_current,
        equity_ratio_prior,
        roe_current,
        roa_current,
        operating_cf_current,
        investing_cf_current,
        free_cash_flow_current,
        cash_and_equivalents_current,
        dividend_per_share_current,
        dividend_growth_rate,
        eps_current,
        bps_current,
        number_of_employees,
        operating_income_per_employee,
        ${criteria.table === "periodic" ? "doc_type_code" : "NULL::VARCHAR AS doc_type_code"},
        ${criteria.table === "periodic" ? "period_type" : "NULL::VARCHAR AS period_type"}
      FROM ${tableName}
      ${whereClause}
      ORDER BY ${orderCol} ${direction} NULLS LAST
      ${limitClause};
    `;

    const reader = await this.connection.runAndReadAll(query);
    const rows = reader.getRows();

    return rows.map((row) => ({
      edinetCode: String(row[0] ?? ""),
      securityCode: String(row[1] ?? ""),
      companyName: String(row[2] ?? ""),
      periodEnd: String(row[3] ?? ""),
      isConsolidated: Boolean(row[4]),
      netSalesCurrent: row[5] !== null ? Number(row[5]) : undefined,
      operatingIncomeCurrent: row[6] !== null ? Number(row[6]) : undefined,
      operatingMarginCurrent: row[7] !== null ? Number(row[7]) : undefined,
      operatingMarginPrior: row[8] !== null ? Number(row[8]) : undefined,
      operatingMarginGrowthRate: row[9] !== null ? Number(row[9]) : undefined,
      operatingMarginDelta: row[10] !== null ? Number(row[10]) : undefined,
      salesGrowthRate: row[11] !== null ? Number(row[11]) : undefined,
      operatingIncomeGrowthRate: row[12] !== null ? Number(row[12]) : undefined,
      equityRatioCurrent: row[13] !== null ? Number(row[13]) : undefined,
      equityRatioPrior: row[14] !== null ? Number(row[14]) : undefined,
      roeCurrent: row[15] !== null ? Number(row[15]) : undefined,
      roaCurrent: row[16] !== null ? Number(row[16]) : undefined,
      operatingCfCurrent: row[17] !== null ? Number(row[17]) : undefined,
      investingCfCurrent: row[18] !== null ? Number(row[18]) : undefined,
      freeCashFlowCurrent: row[19] !== null ? Number(row[19]) : undefined,
      cashAndEquivalentsCurrent: row[20] !== null ? Number(row[20]) : undefined,
      dividendPerShareCurrent: row[21] !== null ? Number(row[21]) : undefined,
      dividendGrowthRate: row[22] !== null ? Number(row[22]) : undefined,
      epsCurrent: row[23] !== null ? Number(row[23]) : undefined,
      bpsCurrent: row[24] !== null ? Number(row[24]) : undefined,
      numberOfEmployees: row[25] !== null ? Number(row[25]) : undefined,
      operatingIncomePerEmployee: row[26] !== null ? Number(row[26]) : undefined,
      docTypeCode: row[27] !== null ? String(row[27]) : undefined,
      periodType: row[28] !== null ? String(row[28]) : undefined,
    }));
  }

  public close(): void {
    if (this.connection) {
      this.connection.closeSync();
      this.connection = undefined;
    }
  }

  private bindNullableDouble(stmt: any, index: number, value?: number): void {
    if (value !== undefined && !Number.isNaN(value)) {
      stmt.bindDouble(index, value);
    } else {
      stmt.bindNull(index);
    }
  }
}
