"""Independently compare every selected index value to its hash-verified XBRL source.

No SDK imports or database writes. This verifies direct XBRL facts, not PDF semantics.
"""
import collections
import datetime
import decimal
import gzip
import hashlib
import io
import json
import math
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

if not __debug__:
    sys.exit('Independent financial source verification requires assertions')

X = '{http://www.xbrl.org/2003/instance}'
D = '{http://xbrl.org/2006/xbrldi}'
NIL = '{http://www.w3.org/2001/XMLSchema-instance}nil'
LIMIT = 256 * 1024 * 1024

def digest(data):
    return hashlib.sha256(data).hexdigest()

def file_digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def readonly(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)

def source_document(archive, source_hash, compressed):
    row = archive.execute('select xml from archive_contents where sha256=?', (source_hash,)).fetchone()
    assert row is not None, 'Missing source content'
    raw = row[0]
    assert len(raw) <= LIMIT, 'Oversized source'
    if compressed:
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
            raw = stream.read(LIMIT + 1)
    assert len(raw) <= LIMIT and digest(raw) == source_hash, 'Source content fingerprint differs'
    assert b'<!DOCTYPE' not in raw.upper() and b'<!ENTITY' not in raw.upper(), 'Unsupported XML declaration'
    namespaces = {}
    for _, (prefix, uri) in ET.iterparse(io.BytesIO(raw), events=('start-ns',)):
        assert prefix not in namespaces or namespaces[prefix] == uri, 'Namespace rebinding requires separate verification'
        namespaces[prefix] = uri
    root = ET.fromstring(raw)
    contexts, units, facts = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(list)
    for node in root:
        if node.tag == X+'context':
            contexts[node.get('id')].append(node)
        elif node.tag == X+'unit':
            units[node.get('id')].append(node)
        elif node.get('contextRef') is not None:
            facts[(node.tag, node.get('contextRef'), node.get('unitRef'))].append(node)
    dei = collections.defaultdict(list)
    for node in root:
        match = re.fullmatch(r'\{http://disclosure\.edinet-fsa\.go\.jp/taxonomy/jpdei/\d{4}-\d{2}-\d{2}/jpdei_cor\}(.+)', node.tag)
        if match:
            dei[match[1]].append((node.text or '').strip())
    return namespaces, contexts, units, facts, dei

def strict_dei_date(value):
    assert re.fullmatch(r'\d{4}-\d{2}-\d{2}', value), 'DEI date format differs'
    return datetime.date.fromisoformat(value)

def verify_generic_dei(document, metadata, edinet_code):
    # Generic legacy rows may describe prior periods. Certify main basis and DEI
    # identity/chronology here; current-period row binding remains explicit below.
    _, contexts, _, facts, _ = document
    values, identities = {}, set()
    for tag in ('AccountingStandardsDEI', 'WhetherConsolidatedFinancialStatementsArePreparedDEI',
                'CurrentFiscalYearStartDateDEI', 'CurrentPeriodEndDateDEI',
                'CurrentFiscalYearEndDateDEI', 'EDINETCodeDEI', 'SecurityCodeDEI'):
        nodes = [(ref, unit, node) for (qname, ref, unit), group in facts.items()
                 if re.fullmatch(r'\{http://disclosure\.edinet-fsa\.go\.jp/taxonomy/jpdei/\d{4}-\d{2}-\d{2}/jpdei_cor\}' + tag, qname)
                 for node in group]
        if not nodes and tag == 'CurrentFiscalYearEndDateDEI':
            continue  # Legacy verifier inputs did not require fiscal end.
        assert len(nodes) == 1, 'Generic DEI absent or ambiguous'
        ref, unit, node = nodes[0]
        assert not unit and not list(node) and node.get(NIL) in (None, 'false', '0'), 'Generic DEI primitive differs'
        assert len(contexts[ref]) == 1, 'Generic DEI context differs'
        context = contexts[ref][0]
        assert not context.findall('.//'+D+'explicitMember') and not context.findall('.//'+D+'typedMember'), 'Generic DEI dimensions differ'
        entity = context.findall(X+'entity/'+X+'identifier')
        periods = context.findall(X+'period')
        instant = context.findall(X+'period/'+X+'instant')
        assert len(entity) == len(periods) == len(instant) == 1 and len(periods[0]) == 1, 'Generic DEI filing context differs'
        assert entity[0].get('scheme') == 'http://disclosure.edinet-fsa.go.jp' and (entity[0].text or '').strip() == edinet_code+'-000', 'Generic DEI issuer differs'
        identities.add(((entity[0].text or '').strip(), (instant[0].text or '').strip()))
        values[tag] = (node.text or '').strip()
    assert len(identities) == 1, 'Generic DEI identities differ'
    assert {'Japan GAAP':'J-GAAP', 'IFRS':'IFRS'}.get(values['AccountingStandardsDEI']) == metadata['accountingStandard'], 'Generic standard differs'
    main = values['WhetherConsolidatedFinancialStatementsArePreparedDEI']
    assert main in ('true', '1', 'false', '0'), 'Generic main scope unknown'
    assert metadata['scope'] in ('Consolidated', 'NonConsolidated') and (metadata['scope'] != 'Consolidated' or main in ('true', '1')), 'Generic main scope differs'
    assert values['EDINETCodeDEI'] == edinet_code and values['SecurityCodeDEI'] == metadata['secCode'], 'Generic code differs'
    start = strict_dei_date(values['CurrentFiscalYearStartDateDEI'])
    end = strict_dei_date(values['CurrentPeriodEndDateDEI'])
    assert start <= end, 'Generic current chronology differs'
    filing_raw = next(iter(identities))[1]
    filing = strict_dei_date(filing_raw)
    assert end <= filing, 'Generic current period is after filing'
    if 'CurrentFiscalYearEndDateDEI' in values:
        assert end <= strict_dei_date(values['CurrentFiscalYearEndDateDEI']), 'Generic fiscal chronology differs'

def verify_current_standalone_ifrs(document, metadata, edinet_code):
    if metadata['accountingStandard'] != 'IFRS' or metadata['scope'] != 'NonConsolidated':
        return False
    namespaces, contexts, _, facts, _ = document
    values, identities = {}, set()
    for tag in ('AccountingStandardsDEI', 'WhetherConsolidatedFinancialStatementsArePreparedDEI',
                'CurrentFiscalYearStartDateDEI', 'CurrentPeriodEndDateDEI', 'TypeOfCurrentPeriodDEI',
                'CurrentFiscalYearEndDateDEI', 'DocumentTypeDEI',
                'EDINETCodeDEI', 'SecurityCodeDEI'):
        nodes = [(ref, unit, node) for (qname, ref, unit), group in facts.items()
                 if re.fullmatch(r'\{http://disclosure\.edinet-fsa\.go\.jp/taxonomy/jpdei/\d{4}-\d{2}-\d{2}/jpdei_cor\}' + tag, qname)
                 for node in group]
        if not nodes and tag in ('CurrentFiscalYearEndDateDEI', 'DocumentTypeDEI'):
            continue  # Legacy non-Q4 verifier inputs did not require these fields.
        assert len(nodes) == 1, 'Standalone IFRS DEI is absent or ambiguous'
        ref, unit, node = nodes[0]
        assert not unit and not list(node) and node.get(NIL) in (None, 'false', '0'), 'Standalone IFRS DEI unit/nil differs'
        assert len(contexts[ref]) == 1, 'Standalone IFRS DEI context differs'
        context = contexts[ref][0]
        assert not context.findall('.//'+D+'explicitMember') and not context.findall('.//'+D+'typedMember'), 'Standalone IFRS DEI dimensions differ'
        entity = context.findall(X+'entity/'+X+'identifier')
        periods = context.findall(X+'period')
        instant = context.findall(X+'period/'+X+'instant')
        assert len(periods) == len(entity) == len(instant) == 1 and len(periods[0]) == 1, 'Standalone IFRS DEI identity/period differs'
        identifier, filing_instant = (entity[0].text or '').strip(), (instant[0].text or '').strip()
        assert entity[0].get('scheme') == 'http://disclosure.edinet-fsa.go.jp' and identifier == edinet_code+'-000', 'Standalone IFRS DEI issuer differs'
        identities.add((identifier, filing_instant))
        values[tag] = (node.text or '').strip()
    assert len(identities) == 1 and values['AccountingStandardsDEI'] == 'IFRS', 'Standalone IFRS basis differs'
    assert values['WhetherConsolidatedFinancialStatementsArePreparedDEI'] in ('false', '0'), 'Standalone IFRS main scope differs'
    assert values['EDINETCodeDEI'] == edinet_code and values['SecurityCodeDEI'] == metadata['secCode'], 'Standalone IFRS code differs'
    period = metadata['period']
    start, end = values['CurrentFiscalYearStartDateDEI'], values['CurrentPeriodEndDateDEI']
    assert all(re.fullmatch(r'\d{4}-\d{2}-\d{2}', date) for date in (start, end)) and datetime.date.fromisoformat(start) <= datetime.date.fromisoformat(end), 'Standalone IFRS current dates differ'
    assert values['TypeOfCurrentPeriodDEI'] in ('FY', 'HY', 'Q1', 'Q2', 'Q3', 'Q4'), 'Standalone IFRS period classification is unknown'
    if values['TypeOfCurrentPeriodDEI'] == 'Q4':
        first = datetime.date.fromisoformat(start)
        def boundary(months):
            month = first.year * 12 + first.month - 1 + months
            return datetime.date(month // 12, month % 12 + 1, first.day)
        assert values['DocumentTypeDEI'] == '第四号の三様式', 'Q4 form differs'
        assert end == (boundary(12)-datetime.timedelta(days=1)).isoformat() and strict_dei_date(values['CurrentFiscalYearEndDateDEI']) > datetime.date.fromisoformat(end), 'Q4 extended fiscal year differs'
        expected = [{'startDate': boundary(9).isoformat(), 'endDate': end}]
        matches = set()
        for group in contexts.values():
            for context in group:
                p = context.findall(X+'period')
                members = context.findall('.//'+D+'explicitMember')
                entity = context.findall(X+'entity/'+X+'identifier')
                if len(p) == 1 and {n.tag.removeprefix(X):(n.text or '').strip() for n in p[0]} in expected:
                    if len(entity) == 1 and entity[0].get('scheme') == 'http://disclosure.edinet-fsa.go.jp' and (entity[0].text or '').strip() == edinet_code+'-000' and len(members) == 1 and members[0].get('dimension','').split(':')[-1] == 'ConsolidatedOrNonConsolidatedAxis' and (members[0].text or '').strip().split(':')[-1] == 'NonConsolidatedMember' and not context.findall('.//'+D+'typedMember'):
                        assert len(group) == 1, 'Q4 quarter context duplicated'
                        for qname in (members[0].get('dimension'), (members[0].text or '').strip()):
                            assert re.fullmatch(r'http://disclosure\.edinet-fsa\.go\.jp/taxonomy/(jppfs|jpcrp)/\d{4}-\d{2}-\d{2}/(jppfs_cor|jpcrp_cor)', namespaces.get(qname.split(':')[0], '')), 'Q4 dimension namespace differs'
                        matches.add(canonical({n.tag.removeprefix(X):(n.text or '').strip() for n in p[0]}))
        assert matches == set(map(canonical, expected)), 'Q4 current context absent'
    if 'instant' in period:
        assert period == {'instant': end}, 'Standalone IFRS is not the declared current instant'
    else:
        assert period == {'startDate': start, 'endDate': end}, 'Standalone IFRS is not the declared current period'
        assert metadata['periodType'] == ('annual' if values['TypeOfCurrentPeriodDEI'] == 'FY' else 'ytd'), 'Standalone IFRS period classification differs'
    return True

def verify_evidence(document, evidence, metadata):
    namespaces, contexts, units, facts, _ = document
    context = contexts[evidence['contextRef']]
    assert len(context) == 1, 'Context is absent or duplicated'
    context = context[0]
    identifier = context.findall(X+'entity/'+X+'identifier')
    assert len(identifier) == 1, 'Entity identifier is absent or duplicated'
    entity = {'scheme': identifier[0].get('scheme'), 'identifier': (identifier[0].text or '').strip()}
    assert entity == evidence['entity'], 'Entity differs'
    periods = context.findall(X+'period')
    assert len(periods) == 1, 'Context period is absent or duplicated'
    period = {node.tag.removeprefix(X): (node.text or '').strip() for node in periods[0]}
    assert len(period) == len(periods[0]) and period == evidence['period'] == metadata['period'], 'Period differs'
    dimensions = context.findall('.//'+D+'explicitMember')
    assert not context.findall('.//'+D+'typedMember'), 'Typed dimension requires separate verification'
    if metadata['scope'] == 'Consolidated':
        assert not dimensions and evidence['dimensions'] == [], 'Consolidated scope differs'
    else:
        assert metadata['scope'] == 'NonConsolidated' and len(dimensions) == 1, 'Standalone scope differs'
        member = dimensions[0]
        assert member.get('dimension', '').split(':')[-1] == 'ConsolidatedOrNonConsolidatedAxis', 'Standalone axis differs'
        assert (member.text or '').strip().split(':')[-1] == 'NonConsolidatedMember', 'Standalone member differs'
        for qname in (member.get('dimension'), (member.text or '').strip()):
            prefix = qname.split(':')[0]
            assert re.fullmatch(r'http://disclosure\.edinet-fsa\.go\.jp/taxonomy/(jppfs|jpcrp)/\d{4}-\d{2}-\d{2}/(jppfs_cor|jpcrp_cor)', namespaces.get(prefix, '')), 'Standalone dimension namespace differs'
        assert evidence['dimensions'] == ['NonConsolidatedMember'], 'Standalone evidence differs'
    assert evidence['scope'] == metadata['scope'], 'Scope evidence differs'
    unit = units[evidence['unitRef']]
    assert len(unit) == 1 and len(unit[0]) == 1 and unit[0][0].tag == X+'measure', 'Unit is absent, duplicated or divided'
    measure = (unit[0][0].text or '').strip().split(':')
    assert len(measure) == 2 and namespaces.get(measure[0]) == 'http://www.xbrl.org/2003/iso4217' and measure[1] == 'JPY', 'Currency differs'
    assert evidence['unit'] == 'iso4217:JPY' and metadata['currency'] == 'JPY', 'Currency evidence differs'
    local = evidence['key'].split(':')[1]
    matching = facts[('{'+evidence['namespaceURI']+'}'+local, evidence['contextRef'], evidence['unitRef'])]
    assert matching, 'Selected fact is absent'
    for fact in matching:
        assert not list(fact) and fact.get(NIL, 'false') in ('false', '0'), 'Selected fact is nil or structured'
        assert (fact.text or '').strip() == evidence['raw'] and fact.get('decimals') == evidence.get('decimals'), 'Raw amount or precision differs'
    return len(matching)

def timestamp(value):
    parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    assert parsed.tzinfo is not None, 'Timestamp must have a timezone'
    return parsed

def verify_sql_value(value, selection):
    raw = selection.get('raw')
    safe = None
    if selection['status'] == 'selected':
        number = float(raw)
        if math.isfinite(number) and abs(number) <= 9007199254740991 and decimal.Decimal(raw) == decimal.Decimal(str(number)):
            safe = number
        assert selection.get('safeNumber') == safe, 'Safe number differs from independent decimal conversion'
    failure = selection['status'] if selection['status'] != 'selected' else 'unsafe-number' if safe is None else None
    assert value == (int(failure is None), safe, raw, selection['status'], selection['reason'], failure), 'SQL projection differs'

def verify_lineage(row, selected, dei):
    doc_id = row['snapshot']['metadata']['docID']
    assert selected is not None, 'Row document is not selected'
    for field in ('rootDocID', 'chainDocIDs', 'observationIds'):
        assert row[field] == selected[field], 'Row selection lineage differs'
    chain = row['chainDocIDs']
    assert isinstance(chain, list) and chain and all(isinstance(doc, str) and doc for doc in chain), 'Invalid selected chain'
    assert len(set(chain)) == len(chain) and chain[0] == row['rootDocID'] and chain[-1] == doc_id, 'Selected chain endpoints differ'
    # Match the SDK: explicit amendment targets constrain correction chains only.
    if len(chain) == 1:
        return False, False
    targets = dei['IdentificationOfDocumentSubjectToAmendmentDEI']
    if not any(targets):
        return False, True
    assert len(targets) == 1 and targets[0] in chain[:-1], 'Explicit amendment target is not a strict ancestor'
    return True, False

def main():
    index_path, archive_path, generation, expected_archive_hash = sys.argv[1:]
    assert file_digest(archive_path) == expected_archive_hash, 'Archive fingerprint differs'
    with readonly(index_path) as index, readonly(archive_path) as archive:
        kind = archive.execute('select kind from archive_format').fetchone()[0]
        assert kind in ('edinet-ts-observed-financial-archive-v1', 'edinet-ts-observed-financial-archive-gzip-v1'), 'Unknown archive format'
        report = json.loads(index.execute('select body from financial_generations where id=?', (generation,)).fetchone()[0])
        cutoff = timestamp(report['selection']['cutoff'])
        selected_by_doc = {}
        for selected in report['selection']['selected']:
            doc_id = selected['observation']['document']['docID']
            assert doc_id not in selected_by_doc, 'Duplicate selected document'
            selected_by_doc[doc_id] = selected
        sql_values = {(row[0], row[1]): row[2:] for row in index.execute('select row_id,metric_id,available,numeric_value,raw_text,status,reason,failure_kind from financial_values where generation=?', (generation,))}
        # One source at a time bounds XML memory while retaining deterministic coverage.
        rows = collections.defaultdict(list)
        for columns in index.execute('select generation,row_id,group_id,standard,scope,currency,period_start,period_end,period_type,edinet_code,sec_code,doc_id,body from financial_rows where generation=? order by row_id', (generation,)):
            row_id, body = columns[1], columns[-1]
            row = json.loads(body)
            m = row['snapshot']['metadata']; period = m['period']
            expected = (generation,row_id,row['group'],m['accountingStandard'],m['scope'],m['currency'],period.get('startDate',''),period.get('endDate',period.get('instant')),m.get('periodType',''),row['edinetCode'],m['secCode'],m['docID'])
            assert columns[:-1] == expected, 'SQL row metadata differs'
            rows[row['sourceSha256']].append((row_id, row))
        checks, documents, checked_facts = [], set(), 0
        explicit_targets, legacy_corrections = set(), set()
        standalone_current_rows = 0
        for source_hash, source_rows in sorted(rows.items()):
            document = source_document(archive, source_hash, kind.endswith('-gzip-v1'))
            for row_id, row in source_rows:
                metadata = row['snapshot']['metadata']
                assert timestamp(row['knownAt']) <= cutoff, 'Row was not known by cutoff'
                declarations = [json.loads(source[0]) for source in archive.execute('select body from archive_sources where doc_id=?', (metadata['docID'],))]
                assert any(source.get('docID') == metadata['docID'] and source.get('sourceSha256') == source_hash and timestamp(source['availableAt']) <= cutoff for source in declarations), 'Source identity or cutoff differs'
                dei = document[4]
                verify_generic_dei(document, metadata, row['edinetCode'])
                standalone_current_rows += int(verify_current_standalone_ifrs(document, metadata, row['edinetCode']))
                explicit, legacy = verify_lineage(row, selected_by_doc.get(metadata['docID']), dei)
                if explicit:
                    explicit_targets.add(metadata['docID'])
                if legacy:
                    legacy_corrections.add(metadata['docID'])
                assert dei['EDINETCodeDEI'] and all(code == row['edinetCode'] for code in dei['EDINETCodeDEI']), 'Issuer DEI differs'
                assert dei['SecurityCodeDEI'] and all(code == metadata['secCode'] for code in dei['SecurityCodeDEI']), 'Security code DEI differs'
                for metric, selection in sorted(row['snapshot']['selections'].items()):
                    value = sql_values.pop((row_id, metric))
                    verify_sql_value(value, selection)
                    if selection['status'] != 'selected':
                        continue
                    assert selection['source']['raw'] == selection['raw'], 'Selection/source raw differs'
                    positive = [e for e in selection['evidence'] if e['reason'] in ('selected', 'selected-raw-only')]
                    assert positive and selection['source'] in positive, 'Selected evidence is absent'
                    for evidence in positive:
                        assert evidence['raw'] == selection['raw'], 'Competing raw amount differs'
                        checked_facts += verify_evidence(document, evidence, metadata)
                    documents.add(metadata['docID'])
                    checks.append([row_id, metric, source_hash, selection['raw'], selection['source'], positive])
        assert checks, 'No selected values verified'
        assert not sql_values, 'Unexpected SQL values'
        assert file_digest(archive_path) == expected_archive_hash, 'Archive changed during verification'
        print(canonical(dict(version=1, method='python-sqlite-gzip-elementtree-direct-facts-lineage-generic-dei-sql-v5', generation=generation,
                             rows=sum(map(len, rows.values())), selectedValues=len(checks), documents=len(documents),
                             checkedFacts=checked_facts, lineageRowsChecked=sum(map(len, rows.values())),
                             currentStandaloneIfrsRowsChecked=standalone_current_rows,
                             explicitTargetDocumentsChecked=len(explicit_targets), legacyCorrectionDocumentsWithoutTarget=len(legacy_corrections),
                             valuesSha256=digest(canonical(sorted(checks)).encode()))))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.exit('Independent financial source verification failed')
