import { createHash } from "node:crypto";
import { DisclosureTableKind, type MainCustomerDocument } from "../../src/index";
export const customerHeader = '<tr><th>顧客の名称又は氏名</th><th>売上高</th><th>関連するセグメント名</th></tr>';
export const customerGroup = (name = '架空顧客㈱（旧 架空旧社㈱）', amount = '1,234.5') => `<tr><td rowspan="2">${name}</td><td rowspan="2">${amount}</td><td>通信</td></tr><tr><td>設備</td></tr>`;
export function customerDocument(docID = "A", options: { body?: string; raw?: string; period?: string; dimensions?: string; scope?: "Consolidated" | "NonConsolidated"; namespace?: string; context?: string; year?: number; entity?: string } = {}): MainCustomerDocument {
    const { body = customerGroup(), raw = `<p>（単位：百万円）</p><table>${customerHeader}${body}</table>`, year = 2026,
        period = `<xbrli:startDate>${year - 1}-04-01</xbrli:startDate><xbrli:endDate>${year}-03-31</xbrli:endDate>`, dimensions = "", entity = docID,
        namespace = 'http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor' } = options;
    const context = options.context ?? `<xbrli:context id="period"><xbrli:entity><xbrli:identifier scheme="fixture">${entity}</xbrli:identifier></xbrli:entity><xbrli:period>${period}</xbrli:period>${dimensions ? `<xbrli:scenario>${dimensions}</xbrli:scenario>` : ''}</xbrli:context>`;
    const escaped = raw.replaceAll('&','&amp;').replaceAll('<','&lt;');
    return { xml: `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:j="${namespace}" xmlns:p="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2025-11-01/jppfs_cor">${context}<j:InformationForEachOfMainCustomersTextBlock contextRef="period">${escaped}</j:InformationForEachOfMainCustomersTextBlock></xbrli:xbrl>`, selection: { docID, kind: DisclosureTableKind.MainCustomers, contextRef: 'period' }, accountingStandard: 'J-GAAP', scope: options.scope ?? 'Consolidated', proof: { rawSha256: createHash('sha256').update(raw).digest('hex') } };
}
