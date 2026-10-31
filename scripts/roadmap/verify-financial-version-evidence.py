"""Reauthenticate persisted source-version evidence independently of the SDK.

This gate proves a version's evidence, not the amounts in its financial rows.
The expected manifest must come from the fixed build input, not the proof itself.
"""
import argparse
import binascii
import datetime as dt
import hashlib
import io
import json
import os
import sqlite3
from pathlib import Path
import re
import stat
import struct
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

POLICY = 'whole-attached-asr-q2r-v1'
METHOD = 'python-raw-zip-xml-official-financial-version-evidence-v1'
M = '{http://disclosure.edinet-fsa.go.jp/2013/manifest}'
X = '{http://www.xbrl.org/2003/instance}'
NIL = '{http://www.w3.org/2001/XMLSchema-instance}nil'
MIB = 1024 ** 2


def require(value, message):
    if not value:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def digest(value):
    return sha(canonical(value).encode())


def bounded(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= limit, 'file size/type')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(limit + 1)
        after = os.fstat(fd)
        require(len(raw) <= limit and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'file changed')
        return raw
    finally:
        os.close(fd)


def unique_pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def load(path):
    return json.loads(bounded(path, 272 * MIB).decode('utf-8'), object_pairs_hook=unique_pairs,
                      parse_constant=lambda _: require(False, 'nonfinite JSON'))


def timestamp(value, official=False):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?', value), 'timestamp type')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if official and parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone(dt.timedelta(hours=9)))
    require(parsed.tzinfo is not None, 'timezone required')
    return parsed.astimezone(dt.timezone.utc)


def xml(raw):
    require(len(raw) <= 64 * MIB and not re.search(br'<!\s*(?:DOCTYPE|ENTITY)', raw, re.I), 'unsafe XML')
    return ET.fromstring(raw)


def source_identity(raw, official):
    xml(raw)
    scopes, stack, pending = {}, [], {}
    parser = ET.iterparse(io.BytesIO(raw), events=('start-ns', 'start', 'end'))
    for event, value in parser:
        if event == 'start-ns':
            pending[value[0]] = value[1]
        elif event == 'start':
            scope = {**(stack[-1] if stack else {}), **pending}
            pending = {}
            scopes[id(value)] = scope
            stack.append(scope)
        else:
            stack.pop()
    root = parser.root
    fields = {}
    for fact in root:
        local = fact.tag.rsplit('}', 1)[-1]
        if local.endswith('DEI'):
            fields.setdefault(local, []).append(fact)
    context_ids, namespaces = set(), set()

    def one(name, empty=False):
        facts = fields.get(name, [])
        require(len(facts) == 1, 'DEI cardinality: ' + name)
        f = facts[0]
        ordinal = name == 'NumberOfSubmissionDEI'
        nil = f.get(NIL) in ('true', '1')
        require(re.fullmatch(r'\{http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/\d{4}-\d{2}-\d{2}/jpdei_cor\}' + name, f.tag) and
                not list(f) and (not nil or empty and not (f.text or '').strip()) and
                (bool(f.get('unitRef')) if ordinal else not f.get('unitRef')) and f.get('contextRef'), 'DEI primitive/basis')
        if ordinal:
            units = [u for u in root.findall(X + 'unit') if u.get('id') == f.get('unitRef')]
            require(len(units) == 1 and len(units[0]) == 1 and units[0][0].tag == X + 'measure', 'ordinal pure unit')
            measure = units[0][0].text or ''
            prefix, local = measure.split(':', 1) if ':' in measure else ('', measure)
            require(local == 'pure' and scopes[id(units[0][0])].get(prefix) == X[1:-1] and f.get('decimals') == '0', 'ordinal pure unit/precision')
        context_ids.add(f.get('contextRef'))
        namespaces.add(f.tag.rsplit('}', 1)[0])
        value = f.text or ''
        require(empty or value.strip(), 'empty DEI')
        return value

    names = {'issuer': 'EDINETCodeDEI', 'security': 'SecurityCodeDEI', 'form': 'DocumentTypeDEI',
             'currentPeriod': 'CurrentPeriodEndDateDEI', 'fiscalStart': 'CurrentFiscalYearStartDateDEI',
             'fiscalEnd': 'CurrentFiscalYearEndDateDEI', 'periodCode': 'TypeOfCurrentPeriodDEI'}
    identity = {key: one(name) for key, name in names.items()}
    require(one('AccountingStandardsDEI') == 'Japan GAAP' and one('WhetherConsolidatedFinancialStatementsArePreparedDEI') in ('true', '1'), 'unsupported reporting basis')
    identity.update(standard='J-GAAP', scope='Consolidated')
    number = one('NumberOfSubmissionDEI')
    require(re.fullmatch('[1-9][0-9]*', number) and int(number) <= 9007199254740991, 'submission ordinal')
    flags = tuple(one(name) for name in ('AmendmentFlagDEI', 'ReportAmendmentFlagDEI', 'XBRLAmendmentFlagDEI'))
    targets = fields.get('IdentificationOfDocumentSubjectToAmendmentDEI', [])
    target = one('IdentificationOfDocumentSubjectToAmendmentDEI', True) if targets else ''
    require(len(context_ids) == len(namespaces) == 1, 'mixed DEI contexts/namespaces')
    all_contexts = root.findall(X + 'context')
    require(len({c.get('id') for c in all_contexts}) == len(all_contexts), 'duplicate context ID')
    contexts = [c for c in all_contexts if c.get('id') in context_ids]
    require(len(contexts) == 1, 'DEI context cardinality')
    context = contexts[0]
    entity = context.findall(X + 'entity/' + X + 'identifier')
    instants = context.findall(X + 'period/' + X + 'instant')
    require(len(entity) == len(instants) == 1 and entity[0].text == identity['issuer'] + '-000' and
            entity[0].get('scheme') == 'http://disclosure.edinet-fsa.go.jp' and
            not context.findall(X + 'scenario') and not context.findall(X + 'entity/' + X + 'segment') and
            len(context.findall(X + 'period')[0]) == 1, 'DEI filing context')
    # Corrected whole attachments may retain the original filing instant.
    filing = dt.date.fromisoformat(instants[0].text)
    start, end, current = (dt.date.fromisoformat(identity[k]) for k in ('fiscalStart', 'fiscalEnd', 'currentPeriod'))
    require(start <= current <= end and current <= filing and identity['periodCode'] in ('FY', 'HY', 'Q2'), 'current period')
    require(identity['form'] == ('第三号様式' if identity['periodCode'] == 'FY' else '第四号の三様式') and
            (current == end if identity['periodCode'] == 'FY' else current < end), 'form/period')
    return identity, int(number), flags, target


def visible(raw):
    return re.sub(r'\s+', ' ', re.sub('<[^>]*>', ' ', raw.decode('utf-8-sig'))).strip()


def zip_proof(raw, source, evidence, ordinal, identity, day):
    require(sha(raw) == evidence['sha256'], 'raw ZIP hash')
    # Classic single-disk layout; reject the permissive trailing/prefixed forms zipfile accepts.
    end = next((at for at in range(len(raw) - 22, max(-1, len(raw) - 22 - 65536), -1)
                if raw[at:at + 4] == b'PK\x05\x06' and at + 22 + struct.unpack_from('<H', raw, at + 20)[0] == len(raw)), -1)
    require(end >= 0, 'ZIP end record')
    disk, central_disk, count_disk, count, size, offset = struct.unpack_from('<4H2I', raw, end + 4)
    require(disk == central_disk == 0 and count_disk == count < 65535 and offset + size == end, 'ZIP classic layout')
    members, content, seen, paths = [], {}, set(), {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        require(len(infos) == count <= 10000 and sum(i.file_size for i in infos) <= 256 * MIB, 'ZIP total limits')
        ranges = []
        for info in infos:
            name = info.filename
            parts = name.rstrip('/').split('/')
            normalized = unicodedata.normalize('NFC', name.rstrip('/')).lower()
            require(normalized not in seen and not name.startswith('/') and not re.search(r'[\\\x00-\x1f\x7f-\x9f:<>"|?*]', name) and
                    len(name.encode()) <= 4096 and all(p not in ('', '.', '..') and len(p.encode()) <= 255 and not re.search(r'[. ]$', p) and
                    not re.match(r'^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]*\.|[ .]*$)', p, re.I) for p in parts), 'ZIP unsafe/duplicate path')
            seen.add(normalized)
            paths[normalized] = info.is_dir()
            require(info.flag_bits & 0x800 or all(ord(c) < 128 for c in name), 'non-UTF8 ZIP name')
            require(info.file_size <= 64 * MIB and info.compress_type in (0, 8) and not info.flag_bits & ~0x080e and
                    stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG, stat.S_IFDIR) and info.extract_version < 45, 'ZIP entry type/limits')
            at = info.header_offset
            require(raw[at:at + 4] == b'PK\x03\x04' and at + 30 <= offset, 'ZIP local header')
            _, flags, method, _, _, crc, compressed, expanded, name_length, extra_length = struct.unpack_from('<5H3I2H', raw, at + 4)
            start = at + 30 + name_length + extra_length
            require(flags == info.flag_bits and method == info.compress_type and start + info.compress_size <= offset, 'ZIP local/central mismatch')
            local_name = raw[at + 30:at + 30 + name_length]
            require(local_name.decode('utf-8') == name, 'ZIP local UTF8 name')
            for extra in (info.extra, raw[at + 30 + name_length:start]):
                position = 0
                while position < len(extra):
                    require(position + 4 <= len(extra), 'ZIP extra field')
                    tag, length = struct.unpack_from('<HH', extra, position)
                    position += 4
                    require(position + length <= len(extra) and tag != 1, 'ZIP64/extra field')
                    if tag == 0x7075:
                        value = extra[position:position + length]
                        require(len(value) >= 5 and value[0] == 1 and struct.unpack_from('<I', value, 1)[0] == binascii.crc32(local_name) and value[5:].decode('utf-8') == name, 'ZIP Unicode override')
                    position += length
            stop = start + info.compress_size
            if flags & 8:
                descriptor = stop + (4 if raw[stop:stop + 4] == b'PK\x07\x08' else 0)
                require(descriptor + 12 <= offset and struct.unpack_from('<3I', raw, descriptor) == (info.CRC, info.compress_size, info.file_size), 'ZIP data descriptor')
                stop = descriptor + 12
            else:
                require((crc, compressed, expanded) == (info.CRC, info.compress_size, info.file_size), 'ZIP local sizes/CRC')
            ranges.append((at, stop))
            if info.is_dir():
                continue
            data = archive.read(info)  # zipfile independently checks local name and CRC.
            require(len(data) == info.file_size, 'ZIP size')
            content[name] = data
            members.append(dict(name=name, dir=False, compressedSize=info.compress_size, uncompressedSize=info.file_size, sha256=sha(data)))
        ranges.sort()
        require(bool(ranges) and ranges[0][0] == 0 and ranges[-1][1] == offset and all(a[1] == b[0] for a, b in zip(ranges, ranges[1:])), 'ZIP overlapping/gapped records')
        require(all(paths.get('/'.join(name.split('/')[:i]), True) for name in paths for i in range(1, len(name.split('/')))), 'ZIP file/directory collision')
    manifest_name = 'XBRL/PublicDoc/manifest_PublicDoc.xml'
    manifest = xml(content[manifest_name])
    require(manifest.tag == M + 'manifest', 'manifest namespace')
    instances, items = manifest.findall('.//' + M + 'instance'), manifest.findall('.//' + M + 'item')
    require(len(instances) == len(items) == 1, 'manifest cardinality')
    instance, item = instances[0], items[0]
    preferred, role = instance.get('preferredFilename'), item.get('extrole')
    require(instance.get('type') == 'PublicDoc' and item.get('ref') == instance.get('id') and
            re.search(r'rol_CabinetOfficeOrdinanceOnDisclosureOfCorporateInformationEtcFormNo(?:3Annual|43Quarterly)SecuritiesReport$', role or ''), 'whole report role')
    expected_role = 'http://disclosure.edinet-fsa.go.jp/role/jpcrp/rol_CabinetOfficeOrdinanceOnDisclosureOfCorporateInformationEtcFormNo' + ('3Annual' if identity['periodCode'] == 'FY' else '43Quarterly') + 'SecuritiesReport'
    require(role == expected_role, 'official attachment form role')
    names = [n.text for n in instance.findall(M + 'ixbrl')]
    require(len(names) >= 2 and len(set(names)) == len(names) and
            all(isinstance(n, str) and '/' not in n and '\\' not in n for n in names + [preferred]), 'inline manifest names')
    listed = ['XBRL/PublicDoc/' + n for n in names]
    require(content['XBRL/PublicDoc/' + preferred] == source and any('_honbun_' in n for n in listed), 'attached source/full body')
    headers = [n for n in listed if '_header_' in n]
    require(len(headers) == 1 and re.search(r'訂正報告書の添付\s*インライン\s*XBRL', visible(content[headers[0]]), re.I), 'attached inline cover')
    for name in content:
        if name.startswith('XBRL/PublicDoc/') and re.search(r'\.(?:xbrl|xsd|xml|htm|html)$', name) and name != manifest_name:
            match = re.search(r'_(E\d{5}-\d{3})_(\d{4}-\d{2}-\d{2})_(\d{2})_(\d{4}-\d{2}-\d{2})(?:_|\.|$)', name)
            require(match and match.groups() == (identity['issuer'] + '-000', identity['currentPeriod'], str(ordinal).zfill(2), day), 'filename ordinal/basis')
    bodies = [n for n in content if n.startswith('PublicDoc/') and re.search(r'\.html?$', n) and re.search('訂正事項|訂正箇所', visible(content[n]))]
    require(bodies, 'correction text missing')
    return dict(rawResponseSha256=evidence['sha256'], receivedAt=evidence['receivedAt'], manifestSha256=sha(content[manifest_name]),
                role=role, preferred=preferred, inlineDocuments=[dict(name=n, sha256=sha(content[n])) for n in listed],
                memberManifestSha256=digest(members), memberCount=len(members), cover=dict(path=headers[0], sha256=sha(content[headers[0]])),
                correctionBody=dict(path=bodies[0], sha256=sha(content[bodies[0]])))


def verify(bundle, proof, expected):
    require(re.fullmatch('[0-9a-f]{64}', expected or ''), 'external manifest pin required')
    observations, sources, evidence = (bundle[k] for k in ('observations', 'sources', 'evidence'))
    require(len(observations) <= 10000 and len(sources) <= 100 and len(evidence) <= 100 and len(canonical(observations).encode()) <= 16 * MIB, 'input count limits')
    hashes = dict(observationsSha256=digest(observations),
                  sourcesSha256=digest([{k: s[k] for k in ('docID', 'sourceSha256', 'availableAt')} for s in sources]),
                  evidenceSha256=digest([{k: e[k] for k in ('docID', 'sha256', 'receivedAt')} for e in evidence]))
    manifest_hash = digest(dict(cutoff=bundle['cutoff'], **hashes))
    require(manifest_hash == expected == bundle['evidenceManifestSha256'] == proof['evidenceManifestSha256'], 'manifest fingerprint')
    require(proof['version'] == '1' and proof['policy'] == POLICY and proof['cutoff'] == bundle['cutoff'] and
            all(proof[k] == v for k, v in hashes.items()) and digest({k: v for k, v in proof.items() if k != 'sha256'}) == proof['sha256'], 'proof fingerprint/policy')
    cutoff = timestamp(bundle['cutoff'])
    require(len({o['observationId'] for o in observations}) == len(observations), 'duplicate observation ID')
    raw_sources, raw_zips = {}, {}
    for s in sources:
        require(s['docID'] not in raw_sources, 'duplicate source')
        raw = s['xml'].encode('utf-8') if 'xml' in s else bounded(s['file'], 64 * MIB)
        require(sha(raw) == s['sourceSha256'], 'source raw hash')
        raw_sources[s['docID']] = raw
    for e in evidence:
        require(e['docID'] not in raw_zips and 'bytes' not in e and isinstance(e.get('path'), str), 'persisted ZIP path required')
        raw = bounded(e['path'], 64 * MIB)
        require(sha(raw) == e['sha256'], 'ZIP raw hash')
        raw_zips[e['docID']] = raw
    require(sum(map(len, raw_sources.values())) <= 256 * MIB and sum(map(len, raw_zips.values())) <= 256 * MIB, 'aggregate raw limit')
    metadata = proof['metadataSelection']
    require(metadata['cutoff'] == bundle['cutoff'] and metadata['financialValuesMerged'] is False and metadata['reconstructedUnobservedHistory'] is False, 'metadata mode')
    metadata_decisions = {d['rootDocID']: d for d in metadata['decisions']}
    require(len(metadata_decisions) == len(metadata['decisions']) and len({d['rootDocID'] for d in proof['decisions']}) == len(proof['decisions']), 'duplicate decision')
    require({d['rootDocID'] for d in proof['decisions']} == {k for k, d in metadata_decisions.items() if d['status'] != 'selected'}, 'missing unresolved decision')
    selected, held, members = 0, 0, 0
    for decision in proof['decisions']:
        if decision['status'] == 'held':
            held += 1
            continue  # A hold grants no financial admission.
        require(decision['status'] == 'selected-source' and decision['reason'] == 'same-root-complete-attached-inline-submission-sequence' and
                digest({k: v for k, v in decision.items() if k != 'sha256'}) == decision['sha256'], 'decision hash/status')
        root_id = decision['rootDocID']
        relevant = [o for o in observations if timestamp(o['observedAt']) <= cutoff and (o['document']['docID'] == root_id or o['document'].get('parentDocID') == root_id)]
        latest = {}
        for o in relevant:
            doc_id = o['document']['docID']
            old = latest.get(doc_id)
            if old is None or timestamp(o['observedAt']) > timestamp(old['observedAt']):
                latest[doc_id] = o
            elif timestamp(o['observedAt']) == timestamp(old['observedAt']):
                require(o['document'] == old['document'], 'conflicting official metadata')
        require(len(latest) == 3 and root_id in latest, 'complete root/sibling closure')
        original = metadata_decisions[root_id]
        require(original['status'] == 'unresolved' and original['reason'] == 'multiple-correction-leaves' and
                len(original['chainDocIDs']) == 3 and set(original['chainDocIDs']) == set(latest) and
                not any(s['rootDocID'] == root_id for s in metadata['selected']), 'metadata unresolved not preserved')
        root = latest[root_id]['document']
        require(root.get('parentDocID') is None and root['docTypeCode'] in ('120', '160') and root['formCode'] == ('030000' if root['docTypeCode'] == '120' else '043A00') and root['legalStatus'] == '1', 'original official form')
        versions = decision['sourceVersions']
        require(len(versions) == 3 and {v['docID'] for v in versions} == set(latest) and versions[0]['docID'] == root_id, 'proof source closure')
        identities, ordinals, dates = [], {}, {}
        known = [timestamp(o['observedAt']) for o in relevant]
        for v in versions:
            doc_id = v['docID']
            official = latest[doc_id]['document']
            declaration = next(s for s in sources if s['docID'] == doc_id)
            require(v['sourceSha256'] == declaration['sourceSha256'] and v['availableAt'] == declaration['availableAt'], 'source declaration binding')
            submitted, available = timestamp(official['submitDateTime'], True), timestamp(declaration['availableAt'])
            require(submitted <= available <= cutoff and official.get('xbrlFlag') in ('1', 1) and
                    str(official.get('withdrawalStatus')) == str(official.get('disclosureStatus')) == '0', 'source/official availability')
            edit = str(official.get('docInfoEditStatus'))
            require(edit == '0' or edit == '2' and latest[doc_id].get('listDate') == official['submitDateTime'][:10] and official.get('opeDateTime') is None, 'official edit status')
            identity, ordinal, flags, target = source_identity(raw_sources[doc_id], official)
            require(identity == v['identity'] and ordinal == v['ordinal'] and identity['issuer'] == official['edinetCode'] == root['edinetCode'] and
                    identity['security'] == official['secCode'] == root['secCode'], 'raw identity binding')
            identities.append(identity)
            require(ordinal not in ordinals, 'duplicate ordinal')
            ordinals[ordinal], dates[ordinal] = doc_id, submitted
            known.append(available)
            if doc_id == root_id:
                require(ordinal == 1 and flags == ('false', 'false', 'false') and not target and 'zip' not in v, 'original DEI')
                require(identity['periodCode'] in (('FY',) if root['docTypeCode'] == '120' else ('HY', 'Q2')), 'official form family')
                require(root['periodStart'] == identity['fiscalStart'] and root['periodEnd'] in (identity['currentPeriod'], identity['fiscalEnd']), 'official root period')
                continue
            require(official.get('periodStart') in (None, root['periodStart']) and official.get('periodEnd') in (None, root['periodEnd']), 'official sibling period conflict')
            require(official['parentDocID'] == target == root_id and official['docTypeCode'] == ('130' if root['docTypeCode'] == '120' else '170') and
                    flags in (('true', 'true', 'false'), ('true', 'false', 'true')), 'correction target/flags')
            e = next(e for e in evidence if e['docID'] == doc_id)
            received = timestamp(e['receivedAt'])
            require(submitted <= received <= available <= cutoff, 'ZIP observation time')
            actual = zip_proof(raw_zips[doc_id], raw_sources[doc_id], e, ordinal, identity, official['submitDateTime'][:10])
            require(actual == v['zip'], 'raw ZIP evidence mismatch')
            members += actual['memberCount']
            known.append(received)
        require(set(ordinals) == {1, 2, 3} and dates[2] < dates[3] and all(i == identities[0] for i in identities), 'submission sequence/common basis')
        chosen = ordinals[3]
        ids = sorted(o['observationId'] for o in relevant)
        require(decision['selectedDocID'] == chosen and decision['chainDocIDs'] == [root_id, chosen] and decision['observationIds'] == ids and
                len(original['observationIds']) == len(ids) and set(original['observationIds']) == set(ids) and timestamp(decision['knownAt']) == max(known), 'causal selection binding')
        s = decision['selected']
        require(s['rootDocID'] == root_id and s['chainDocIDs'] == [root_id, chosen] and s['observationIds'] == ids and
                timestamp(s['observedAt']) == max(timestamp(o['observedAt']) for o in relevant) and
                s['targetPeriod'] == dict(startDate=root['periodStart'], endDate=root['periodEnd'], sourceDocID=root_id), 'selected projection lineage')
        observation = s['observation']
        official = latest[chosen]['document']
        keys = ('docID', 'parentDocID', 'withdrawalStatus', 'docInfoEditStatus', 'disclosureStatus', 'docTypeCode', 'edinetCode',
                'secCode', 'submitDateTime', 'opeDateTime', 'xbrlFlag', 'pdfFlag', 'csvFlag', 'attachDocFlag', 'englishDocFlag')
        normalized = {k: str(v) if k.endswith('Flag') and v is not None else v for k, v in official.items() if k in keys}
        require(observation['observationId'] == latest[chosen]['observationId'] and
                observation.get('listDate') == latest[chosen].get('listDate') and observation['document'] == normalized, 'selected official observation')
        for key in ('withdrawalStatus', 'docInfoEditStatus', 'disclosureStatus'):
            require(observation['statuses'][key]['presence'] == 'known' and observation['statuses'][key]['code'] == str(official[key]), 'selected official statuses')
        availability = s['formatAvailability']
        require(availability['observationId'] == latest[chosen]['observationId'] and timestamp(availability['observedAt']) == timestamp(latest[chosen]['observedAt']), 'format observation')
        for key, name in (('xbrlFlag', 'xbrl'), ('pdfFlag', 'pdf'), ('csvFlag', 'csv'), ('attachDocFlag', 'attachments'), ('englishDocFlag', 'english')):
            code = official.get(key)
            expected_format = ({'state': 'unknown', 'reason': 'unrecorded'} if key not in official else
                               {'state': 'unknown', 'reason': 'null'} if code is None else
                               {'state': 'provided' if str(code) == '1' else 'not-provided', 'code': str(code)} if str(code) in ('0', '1') else
                               {'state': 'unknown', 'reason': 'unrecognized-code', 'code': str(code)})
            require(availability['formats'][name] == expected_format, 'selected format binding')
        selected += 1
    return dict(status='passed', method=METHOD, evidenceManifestSha256=expected, proofSha256=proof['sha256'],
                selectedSourceDecisions=selected, heldDecisions=held, documentsChecked=len(raw_sources), zipFilesChecked=len(raw_zips),
                sourceVersionDocumentsChecked=selected * 3, metadataDecisionsRetained=len(metadata['decisions']),
                zipMembersChecked=members, financialValuesValidated=False, networkRequests=0)


ROW_COLUMNS = ('generation', 'row_id', 'group_id', 'standard', 'scope', 'currency', 'period_start', 'period_end', 'period_type', 'edinet_code', 'sec_code', 'doc_id')


def file_fingerprint(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), 'index regular file required')
        h = hashlib.sha256()
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            for chunk in iter(lambda: stream.read(MIB), b''):
                h.update(chunk)
        after = os.fstat(fd)
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        require(identity(before) == identity(after), 'index changed while hashing')
        return h.hexdigest(), identity(after)
    finally:
        os.close(fd)


def verify_index(path, generation, plan_pin, archive_pin, build_path, bundle, proof):
    require(all(re.fullmatch('[0-9a-f]{64}', value or '') for value in (plan_pin, archive_pin)), 'external plan/archive pins required')
    path = Path(path).absolute()
    require(not any(Path(str(path) + suffix).exists() for suffix in ('-wal', '-shm', '-journal')), 'stopped index without sidecars required')
    build_path = Path(build_path).absolute()
    require(not any(Path(str(build_path) + suffix).exists() for suffix in ('-wal', '-shm', '-journal')), 'stopped build state without sidecars required')
    before = file_fingerprint(path)
    build_before = file_fingerprint(build_path)
    database = sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)
    database.row_factory = sqlite3.Row
    state = sqlite3.connect(build_path.as_uri() + '?mode=ro&immutable=1', uri=True)
    state.row_factory = sqlite3.Row
    try:
        database.execute('PRAGMA query_only=ON')
        require([r[0] for r in database.execute('SELECT kind FROM financial_index_format')] == ['edinet-ts-financial-search-index-v1'], 'index physical format')
        reports, rows_by_generation = {}, {}
        expected_provenance_pin = dict(policy=POLICY, evidenceManifestSha256=proof['evidenceManifestSha256'], proofSha256=proof['sha256'])
        state.execute('PRAGMA query_only=ON')
        require([r[0] for r in state.execute('SELECT kind FROM financial_build_format')] == ['edinet-ts-financial-index-build-v1'], 'build state physical format')
        plan_headers = state.execute('SELECT id,length(CAST(body AS BLOB)) AS bytes FROM financial_build_plans WHERE sha256=?', (plan_pin,)).fetchall()
        require(len(plan_headers) == 1 and plan_headers[0]['bytes'] <= 64 * MIB, 'externally pinned plan absent/oversize')
        stored_plan = state.execute('SELECT * FROM financial_build_plans WHERE id=?', (plan_headers[0]['id'],)).fetchone()
        require(sha(stored_plan['body'].encode()) == stored_plan['sha256'] == plan_pin, 'plan SQL body hash')
        plan = json.loads(stored_plan['body'], object_pairs_hook=unique_pairs)
        require(stored_plan['body'] == canonical(plan) and plan['id'] == stored_plan['id'] and re.fullmatch('[A-Za-z0-9_.:-]{1,200}', plan['id']) and
                plan['buildVersion'] == '1' and plan['indexVersion'] == '2' and plan['generation'] == generation and plan['archiveSha256'] == archive_pin and
                plan['options']['cutoff'] == proof['cutoff'] and plan['options']['financialVersion'] == expected_provenance_pin and
                plan['provenance']['financialVersion'] == expected_provenance_pin and plan['options']['extractorVersion'] == plan['provenance']['extractorVersion'] and
                plan['options'].get('sourceCommit') == plan['provenance'].get('sourceCommit'), 'plan identity/version/proof/archive contract')
        proof_decisions = {d['rootDocID']: d for d in proof['decisions']}
        proof_metadata = {d['rootDocID']: d for d in proof['metadataSelection']['decisions']}
        latest = {}
        for o in bundle['observations']:
            if timestamp(o['observedAt']) <= timestamp(proof['cutoff']):
                old = latest.get(o['document']['docID'])
                if old is None or timestamp(o['observedAt']) > timestamp(old['observedAt']):
                    latest[o['document']['docID']] = o

        def keyed(items, key):
            result = {item[key]: item for item in items}
            require(len(result) == len(items), 'duplicate stored selection key')
            return result

        def read_report(identifier):
            sizes = database.execute('SELECT length(CAST(body AS BLOB)) FROM financial_generations WHERE id=?', (identifier,)).fetchall()
            require(len(sizes) == 1 and sizes[0][0] <= 64 * MIB, 'generation absent/oversize')
            stored = database.execute('SELECT id,body,sha256 FROM financial_generations WHERE id=?', (identifier,)).fetchone()
            require(digest([identifier, stored['body']]) == stored['sha256'], 'generation SQL hash')
            report = json.loads(stored['body'], object_pairs_hook=unique_pairs)
            require(stored['body'] == canonical(report) and report['id'] == identifier and report['indexVersion'] == '2' and report.get('selectionMode') == POLICY, 'v2 generation required')
            require(report.get('financialVersionProof') == proof and report['provenance'].get('financialVersion') == expected_provenance_pin, 'stored full proof/provenance binding')
            owners = report['provenance']['edinetCodes']
            require(isinstance(owners, list) and owners and owners == sorted(set(owners)) and all(re.fullmatch('E[0-9]{5}', code) for code in owners), 'fixed generation owners')
            metadata, selection = report['metadataSelection'], report['selection']
            for value in (metadata, selection):
                require(value['cutoff'] == proof['cutoff'] and value['financialValuesMerged'] is False and value['reconstructedUnobservedHistory'] is False, 'stored selection mode')
            metadata_decisions = keyed(metadata['decisions'], 'rootDocID')
            scope = {root: d for root, d in proof_decisions.items() if root in latest and latest[root]['document']['edinetCode'] in owners}
            require(keyed(report['financialVersionSelection'], 'rootDocID') == scope, 'stored financial decision scope')
            for root in scope:
                require(metadata_decisions.get(root) == proof_metadata[root], 'stored metadata unresolved changed')
            chosen = {root: d for root, d in scope.items() if d['status'] == 'selected-source'}
            expected_selected = keyed(metadata['selected'], 'rootDocID')
            expected_decisions = dict(metadata_decisions)
            for root, d in chosen.items():
                require(root not in expected_selected, 'metadata selected overridden')
                expected_selected[root] = d['selected']
                expected_decisions[root] = dict(rootDocID=root, status='selected', reason='selected', selectedDocID=d['selectedDocID'], chainDocIDs=d['chainDocIDs'], observationIds=d['observationIds'], targetPeriod=d['selected']['targetPeriod'])
            require(keyed(selection['selected'], 'rootDocID') == expected_selected and keyed(selection['decisions'], 'rootDocID') == expected_decisions and selection['ignored'] == metadata['ignored'], 'stored effective selection changed')
            manifests = keyed(report['rows'], 'id')
            count = database.execute('SELECT count(*) FROM financial_rows WHERE generation=?', (identifier,)).fetchone()[0]
            require(count == len(manifests) <= 200000, 'stored row count')
            stored_rows = {}
            headers = database.execute('SELECT substr(row_id,1,65) AS row_id,length(CAST(body AS BLOB)) AS body_bytes FROM financial_rows WHERE generation=? ORDER BY row_id', (identifier,))
            query = 'SELECT ' + ','.join(ROW_COLUMNS) + ',sha256,body FROM financial_rows WHERE generation=? AND row_id=?'
            for header in headers:
                require(re.fullmatch('[a-f0-9]{64}', header['row_id']) and header['body_bytes'] <= 64 * MIB, 'stored row capacity/key')
                row = database.execute(query, (identifier, header['row_id'])).fetchone()
                value = json.loads(row['body'], object_pairs_hook=unique_pairs)
                m = value['snapshot']['metadata']
                period = m['period']
                expected_columns = [identifier, row['row_id'], value['group'], m['accountingStandard'], m['scope'], m['currency'], period.get('startDate', ''), period.get('endDate', period.get('instant')), m.get('periodType', ''), value['edinetCode'], m['secCode'], m['docID']]
                require(value['group'] in ('balanceSheet', 'details') and row['row_id'] == digest([m['docID'], value['group']]) and [row[k] for k in ROW_COLUMNS] == expected_columns and digest([expected_columns, row['body']]) == row['sha256'] and
                        manifests[row['row_id']]['metadata'] == expected_columns and manifests[row['row_id']]['sha256'] == row['sha256'], 'stored row SQL/hash/projection binding')
                selected = expected_selected.get(value['rootDocID'])
                require(selected is not None and m['docID'] == selected['observation']['document']['docID'] and value['edinetCode'] in owners and
                        value['edinetCode'] == selected['observation']['document']['edinetCode'] and value['chainDocIDs'] == selected['chainDocIDs'] and value['observationIds'] == selected['observationIds'], 'stored row official lineage')
                d = chosen.get(value['rootDocID'])
                if d is None:
                    require('financialVersionDecisionSha256' not in value and 'financialVersionEvidenceSha256' not in value, 'ordinary row has financial proof')
                else:
                    source = next(s for s in d['sourceVersions'] if s['docID'] == d['selectedDocID'])
                    identity = source['identity']
                    require(value['financialVersionDecisionSha256'] == d['sha256'] and value['financialVersionEvidenceSha256'] == proof['sha256'] and
                            value['sourceSha256'] == source['sourceSha256'] and value['knownAt'] == d['knownAt'] and value['chainDocIDs'] == d['chainDocIDs'] and
                            value['observationIds'] == d['observationIds'] and m['docID'] == d['selectedDocID'] and m['secCode'] == identity['security'] and
                            m['accountingStandard'] == identity['standard'] and m['scope'] == identity['scope'] and m['currency'] == 'JPY', 'stored source-backed row evidence binding')
                    require((value['group'] == 'balanceSheet' and period == dict(instant=identity['currentPeriod']) and 'periodType' not in m) or
                            (value['group'] == 'details' and period == dict(startDate=identity['fiscalStart'], endDate=identity['currentPeriod']) and m['periodType'] == ('annual' if identity['periodCode'] == 'FY' else 'ytd')), 'stored source-backed reporting period')
                stored_rows[row['row_id']] = value
            reports[identifier] = report
            rows_by_generation[identifier] = stored_rows
            return report, stored['sha256']

        aggregate, generation_sha = read_report(generation)
        assembly = aggregate['assembly']
        require(assembly['planSha256'] == plan_pin and assembly['archiveSha256'] == archive_pin, 'assembly external plan/archive pin')
        population = assembly['population']
        require(population == plan['population'] and {k: v for k, v in aggregate['provenance'].items() if k != 'edinetCodes'} == plan['provenance'], 'assembly population/provenance differs from pinned plan')
        owners = aggregate['provenance']['edinetCodes']
        require(population['edinetCodes'] == owners and timestamp(population['observedAt']) <= timestamp(proof['cutoff']) and
                re.fullmatch('[0-9a-f]{64}', population['sourceSha256']) and isinstance(population['source'], str) and population['source'].strip(), 'assembly fixed population')
        day = dt.date.fromisoformat(population['asOf'])
        require(day <= (timestamp(proof['cutoff']) + dt.timedelta(hours=9)).date(), 'population future asOf')
        parts = keyed(assembly['parts'], 'id')
        expected_part_ids = {'buildpart:' + digest([plan_pin, owner]): owner for owner in owners}
        require(set(parts) == set(expected_part_ids), 'assembly company part IDs')
        union_rows = {}
        for identifier, owner in expected_part_ids.items():
            part, part_sha = read_report(identifier)
            require(part_sha == parts[identifier]['sha256'] and 'assembly' not in part and part['provenance']['edinetCodes'] == [owner] and
                    {k: v for k, v in part['provenance'].items() if k != 'edinetCodes'} == {k: v for k, v in aggregate['provenance'].items() if k != 'edinetCodes'}, 'part generation hash/owner/provenance')
            for key, value in rows_by_generation[identifier].items():
                require(key not in union_rows, 'duplicate part row')
                union_rows[key] = value
        require(union_rows == rows_by_generation[generation], 'aggregate rows differ from fixed parts')
        task_count = state.execute('SELECT count(*) FROM financial_build_tasks WHERE build=?', (plan['id'],)).fetchone()[0]
        require(task_count == len(owners), 'fixed build checkpoint count')
        tasks = {}
        headers = state.execute('SELECT substr(edinet_code,1,7) AS edinet_code,length(CAST(body AS BLOB)) AS bytes FROM financial_build_tasks WHERE build=?', (plan['id'],))
        for header in headers:
            require(header['edinet_code'] in owners and header['bytes'] <= MIB, 'checkpoint owner/capacity')
            stored = state.execute('SELECT * FROM financial_build_tasks WHERE build=? AND edinet_code=?', (plan['id'], header['edinet_code'])).fetchone()
            require(digest([plan['id'], stored['edinet_code'], stored['status'], stored['body']]) == stored['sha256'], 'checkpoint SQL hash')
            task = json.loads(stored['body'], object_pairs_hook=unique_pairs)
            require(stored['body'] == canonical(task) and task['edinetCode'] == stored['edinet_code'] and task['status'] == stored['status'] == 'complete' and
                    type(task['attempts']) is int and 1 <= task['attempts'] <= 9007199254740991, 'checkpoint complete/attempt binding')
            identifier = 'buildpart:' + digest([plan_pin, task['edinetCode']])
            part = reports[identifier]
            require(task['partID'] == identifier and task['partSha256'] == parts[identifier]['sha256'], 'checkpoint part binding')
            counts = dict(rowCount=len(part['rows']), selectedDocuments=sum(1 for selected in part['selection']['selected'] if selected['observation']['document']['edinetCode'] == task['edinetCode']),
                          unavailableSources=len(part['unavailableSources']), unresolvedRecords=len(part['unresolvedRecords']), unavailableGroups=len(part['unavailableGroups']))
            require(all(type(task[key]) is int and task[key] == value for key, value in counts.items()), 'checkpoint row/evidence counts')
            require(task['edinetCode'] not in tasks, 'duplicate checkpoint owner')
            tasks[task['edinetCode']] = task
        require(set(tasks) == set(owners), 'checkpoint population incomplete')
        completion_headers = state.execute('SELECT length(CAST(body AS BLOB)) FROM financial_build_completions WHERE build=?', (plan['id'],)).fetchall()
        require(len(completion_headers) == 1 and completion_headers[0][0] <= MIB, 'finished build receipt missing/oversize')
        completion = state.execute('SELECT * FROM financial_build_completions WHERE build=?', (plan['id'],)).fetchone()
        require(digest([plan['id'], completion['body']]) == completion['sha256'], 'finished build receipt SQL hash')
        expected_completion = dict(id=plan['id'], generation=generation, planSha256=plan_pin, generationSha256=generation_sha)
        require(completion['body'] == canonical(expected_completion), 'finished build plan/generation binding')
        def merge(field, key):
            merged = {}
            for identifier in expected_part_ids:
                items = reports[identifier]
                for segment in field:
                    items = items[segment]
                for item in items:
                    name = key(item)
                    require(name not in merged or merged[name] == item, 'conflicting part evidence')
                    merged[name] = item
            return merged
        for field in ('selection', 'metadataSelection'):
            for collection, key in (('selected', 'rootDocID'), ('decisions', 'rootDocID'), ('ignored', 'observationId')):
                require(keyed(aggregate[field][collection], key) == merge((field, collection), lambda item: item[key]), 'aggregate selection differs from parts')
        for collection, key in (('financialVersionSelection', lambda item: item['rootDocID']), ('unavailableSources', lambda item: item['docID']), ('unresolvedRecords', lambda item: item['docID']), ('unavailableGroups', lambda item: (item['docID'], item['group']))):
            require({key(item): item for item in aggregate[collection]} == merge((collection,), key), 'aggregate evidence differs from parts')
    finally:
        database.close()
        state.close()
    after = file_fingerprint(path)
    build_after = file_fingerprint(build_path)
    require(before == after and build_before == build_after, 'index/build state changed during independent verification')
    return dict(method='python-stored-v2-index-plan-checkpoint-binding-v1', generation=generation, generationSha256=generation_sha, planSha256=plan_pin, archiveSha256=archive_pin,
                indexSha256=before[0], indexUnchanged=True, buildStateSha256=build_before[0], buildStateUnchanged=True, buildID=plan['id'], completedCheckpointsChecked=len(tasks), companyPartsChecked=len(parts), storedRowsChecked=len(union_rows),
                storedGenerationsChecked=len(reports), financialValuesValidated=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--proof', required=True)
    parser.add_argument('--expected-manifest-sha256', required=True)
    for flag in ('index', 'generation', 'expected-plan-sha256', 'expected-archive-sha256', 'build-state'):
        parser.add_argument('--' + flag)
    args = parser.parse_args()
    optional = (args.index, args.generation, args.expected_plan_sha256, args.expected_archive_sha256, args.build_state)
    require(all(value is not None for value in optional) or all(value is None for value in optional), 'index/generation/plan/archive/build-state options are all-or-none')
    bundle, proof = load(args.bundle), load(args.proof)
    result = verify(bundle, proof, args.expected_manifest_sha256)
    if args.index is not None:
        result['indexBinding'] = verify_index(args.index, args.generation, args.expected_plan_sha256, args.expected_archive_sha256, args.build_state, bundle, proof)
    print(canonical(result))


if __name__ == '__main__':
    try:
        require(__debug__, 'requires assertions enabled')
        main()
    except Exception as error:
        print('Independent financial version evidence verification failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
