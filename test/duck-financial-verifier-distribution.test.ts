import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {recordDuckFinancialValueVerification as sdk} from '../src/duck-financial-value-verification';
import {recordDuckFinancialValueVerification as legacy} from '../scripts/roadmap/duck-financial-value-verification';
it('SDKと既存入口は同じ照合gateを使い、同梱Pythonは正本と一致する',()=>{
 expect(sdk).toBe(legacy);
 expect(readFileSync(new URL('../src/assets/verify-financial-values.py',import.meta.url))).toEqual(readFileSync(new URL('../scripts/roadmap/verify-financial-values.py',import.meta.url)));
});
