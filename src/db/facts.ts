import type { ParsedXbrlDocument } from "../xbrl/parser.js";

/** xbrl_facts テーブルに保存する1 Fact分の行 */
export interface XbrlFactRow {
  docId: string;
  concept: string;
  qname: string;
  contextId: string;
  valueText: string | null;
  valueNumeric: number | null;
  unit: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  instant: string | null;
  dimensions: string | null;
  decimals: number | null;
  scale: number | null;
}

/**
 * パース済みXBRLの全Factを、コンテキスト情報付きの行に変換する。
 */
export function buildFactRows(docId: string, doc: ParsedXbrlDocument): XbrlFactRow[] {
  return doc.facts.map((fact) => {
    const context = doc.contexts.get(fact.contextRef);
    return {
      docId,
      concept: fact.name,
      qname: fact.qname,
      contextId: fact.contextRef,
      valueText: fact.value,
      valueNumeric: fact.numericValue ?? null,
      unit: fact.unitRef ?? null,
      periodStart: context?.startDate ?? null,
      periodEnd: context?.endDate ?? null,
      instant: context?.instant ?? null,
      dimensions: context?.dimensions ? JSON.stringify(context.dimensions) : null,
      decimals: fact.decimals ?? null,
      scale: fact.scale ?? null,
    };
  });
}
