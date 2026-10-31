import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('performance', Path(__file__).resolve().parents[1] / 'scripts/evaluate-duck-financial-performance.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def summary():
    return dict(allResultsEqual=True, cases=12, warmups=1, repeats=5,
                fileBytes=dict(sqlite=1000, duckdb=500),
                results=[dict(mode=mode, initialReadMs=100, maxRssBytes=1000,
                              samples=[dict(name=str(case), repeat=repeat, elapsedMs=100)
                                       for case in range(12) for repeat in range(5)])
                         for mode in ['sqlite', 'uncached', 'cached']])


class PerformanceTest(unittest.TestCase):
    def test_cli_fails_when_numeric_limits_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'summary.json'
            for size, expected in [(500, 0), (501, 1)]:
                data = summary()
                data['fileBytes']['duckdb'] = size
                path.write_text(json.dumps(data))
                result = subprocess.run([sys.executable, str(spec.origin), str(path)], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, expected)
                self.assertEqual(json.loads(result.stdout)['numericCriteriaPassed'], expected == 0)

    def test_limits_and_single_slow_case(self):
        data = summary()
        self.assertTrue(module.evaluate(data)['numericCriteriaPassed'])
        for sample in data['results'][2]['samples'][:5]:
            sample['elapsedMs'] = 126
        result = module.evaluate(data)
        self.assertFalse(result['numericCriteriaPassed'])
        self.assertTrue(result['checks']['medianCaseLatencyRatio'])
        self.assertFalse(result['checks']['worstCaseLatencyRatio'])
        self.assertFalse(result['publicationApproved'])

    def test_incomplete_or_invalid_measurements_are_rejected(self):
        for mutation in ['duplicate', 'missing', 'nan', 'mismatched', 'unequal']:
            with self.subTest(mutation=mutation):
                data = copy.deepcopy(summary())
                samples = data['results'][2]['samples']
                if mutation == 'duplicate':
                    samples[-1] = samples[-2]
                elif mutation == 'missing':
                    samples.pop()
                elif mutation == 'nan':
                    samples[0]['elapsedMs'] = float('nan')
                elif mutation == 'mismatched':
                    for sample in samples[:5]:
                        sample['name'] = 'different-case'
                else:
                    data['allResultsEqual'] = False
                with self.assertRaises(AssertionError):
                    module.evaluate(data)
