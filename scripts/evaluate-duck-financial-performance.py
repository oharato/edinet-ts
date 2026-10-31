"""Evaluate plan section 7 numeric limits; this never approves publication."""
import json
import math
from pathlib import Path
import statistics
import sys


def evaluate(summary):
    def positive(value):
        assert type(value) in (int, float) and math.isfinite(value) and value > 0
        return value

    assert summary['allResultsEqual'] is True
    assert summary['cases'] == 12 and summary['warmups'] == 1 and summary['repeats'] == 5
    results = {result['mode']: result for result in summary['results']}
    assert len(results) == len(summary['results']) == 3
    assert set(results) == {'sqlite', 'uncached', 'cached'}

    def medians(result):
        cases = {}
        for sample in result['samples']:
            repeat = sample['repeat']
            assert type(repeat) is int and 0 <= repeat < 5
            samples = cases.setdefault(sample['name'], {})
            assert repeat not in samples
            samples[repeat] = positive(sample['elapsedMs'])
        assert len(cases) == 12
        assert all(set(samples) == set(range(5)) for samples in cases.values())
        return {name: statistics.median(samples.values()) for name, samples in cases.items()}

    timings = {mode: medians(result) for mode, result in results.items()}
    assert all(set(values) == set(timings['sqlite']) for values in timings.values())
    ratios = {name: timings['cached'][name] / baseline for name, baseline in timings['sqlite'].items()}
    measured = {
        'fileSizeRatio': positive(summary['fileBytes']['duckdb']) / positive(summary['fileBytes']['sqlite']),
        'medianCaseLatencyRatio': statistics.median(ratios.values()),
        'worstCaseLatencyRatio': max(ratios.values()),
        'initialReadRatio': positive(results['cached']['initialReadMs']) / positive(results['sqlite']['initialReadMs']),
        'maxRssRatio': positive(results['cached']['maxRssBytes']) / positive(results['sqlite']['maxRssBytes']),
    }
    limits = dict(fileSizeRatio=0.5, medianCaseLatencyRatio=1.10,
                  worstCaseLatencyRatio=1.25, initialReadRatio=1.25, maxRssRatio=1.25)
    checks = {name: value <= limits[name] for name, value in measured.items()}
    return dict(version=1, measured=measured, limits=limits, checks=checks,
                caseLatencyRatios=ratios, numericCriteriaPassed=all(checks.values()),
                publicationApproved=False,
                scope='Numeric reader benchmark only; full-company correctness, local storage, competing load, daily operation and capacity guards require separate evidence.')


if __name__ == '__main__':
    result = evaluate(json.loads(Path(sys.argv[1]).read_text()))
    print(json.dumps(result, indent=2, allow_nan=False))
    sys.exit(0 if result['numericCriteriaPassed'] else 1)
