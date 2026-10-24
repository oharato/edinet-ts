import {normalizeFinancialDetailSnapshot,screenFinancialDetailSnapshots,createFinancialDetailSnapshot,FinancialDetailMetricId} from "../../src/index";
const snapshot=normalizeFinancialDetailSnapshot({});
screenFinancialDetailSnapshots([snapshot],{metricIds:[FinancialDetailMetricId.CashAndDeposits],sortBy:FinancialDetailMetricId.CashAndDeposits});
// @ts-expect-error 財務明細ID以外を条件へ混ぜない
screenFinancialDetailSnapshots([],{sortBy:"netSales"});
// @ts-expect-error XML文字列をJSON snapshot配列と混同しない
screenFinancialDetailSnapshots(["<xbrl/>"]);
