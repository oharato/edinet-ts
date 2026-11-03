import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { CompanyFinancialComparison, ScreeningCriteria } from "../types.js";

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
        PRIMARY KEY (company_name, period_end)
      );
    `);
  }

  public async insert(record: CompanyFinancialComparison): Promise<void> {
    if (!this.connection) throw new Error("Database not initialized");

    const stmt = await this.connection.prepare(`
      INSERT OR REPLACE INTO financial_summary VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      );
    `);

    stmt.bindVarchar(1, record.metadata.edinetCode || "");
    stmt.bindVarchar(2, record.metadata.securityCode || "");
    stmt.bindVarchar(3, record.metadata.companyName || "");
    stmt.bindVarchar(4, record.metadata.periodEnd || "");
    stmt.bindBoolean(5, record.current.isConsolidated);

    this.bindNullableDouble(stmt, 6, record.current.netSales);
    this.bindNullableDouble(stmt, 7, record.prior.netSales);
    this.bindNullableDouble(stmt, 8, record.current.operatingIncome);
    this.bindNullableDouble(stmt, 9, record.prior.operatingIncome);
    this.bindNullableDouble(stmt, 10, record.operatingMarginCurrent);
    this.bindNullableDouble(stmt, 11, record.operatingMarginPrior);
    this.bindNullableDouble(stmt, 12, record.operatingMarginGrowthRate);
    this.bindNullableDouble(stmt, 13, record.operatingMarginDelta);
    this.bindNullableDouble(stmt, 14, record.salesGrowthRate);
    this.bindNullableDouble(stmt, 15, record.operatingIncomeGrowthRate);

    await stmt.run();
  }

  public async screen(criteria: ScreeningCriteria = {}): Promise<ScreeningResultRow[]> {
    if (!this.connection) throw new Error("Database not initialized");

    const conditions: string[] = [];

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
    if (criteria.consolidatedOnly) {
      conditions.push(`is_consolidated = true`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    let orderCol = "operating_margin_current";
    if (criteria.orderBy === "margin_growth") orderCol = "operating_margin_growth_rate";
    else if (criteria.orderBy === "current_margin") orderCol = "operating_margin_current";
    else if (criteria.orderBy === "sales_growth") orderCol = "sales_growth_rate";
    else if (criteria.orderBy === "operating_income_growth") orderCol = "operating_income_growth_rate";

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
        operating_income_growth_rate
      FROM financial_summary
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
