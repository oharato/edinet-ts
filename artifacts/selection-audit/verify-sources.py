"""Independently check selected QName/context/raw hashes against saved XML, without printing values."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as E

count = 0
for filename in ['artifacts/selection-audit/results.json', 'data/selection-research/results.json']:
    report = json.loads(Path(filename).read_text())
    trees, namespaces = {}, {}
    for item in report['inputs']:
        path = Path(item['file'])
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']
        trees[item['file']] = E.parse(path).getroot()
        namespaces[item['file']] = dict(pair for _, pair in E.iterparse(path, events=['start-ns']))
    for row in report['rows']:
        if row['status'] != 'selected':
            continue
        source = row['source']
        prefix, local = source['key'].split(':')
        tag = '{' + namespaces[row['file']][prefix] + '}' + local
        assert any(
            element.tag == tag and element.get('contextRef') == source['contextRef']
            and hashlib.sha256((element.text or '').strip().encode()).hexdigest() == source['rawSha256']
            for element in trees[row['file']]
        )
        count += 1
assert count == 604
print('OK: 604 selected facts match independent XML source/raw hashes; 7 inputs unchanged')
