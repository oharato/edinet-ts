import {expect,it} from 'vitest';
import {describeDocumentFormats,normalizeDocumentFormatFlag} from '../src/document-formats';
it('形式ごとの提供・未提供・未記録・null・未知コードを区別する',()=>{
 expect(describeDocumentFormats({xbrlFlag:0,pdfFlag:'1',csvFlag:null,attachDocFlag:'9'})).toEqual({xbrl:{state:'not-provided',code:'0'},pdf:{state:'provided',code:'1'},csv:{state:'unknown',reason:'null'},attachments:{state:'unknown',reason:'unrecognized-code',code:'9'},english:{state:'unknown',reason:'unrecorded'}});
});
it('自身の宣言だけを一度読み取り、余分な属性を参照しない',()=>{
 let calls=0;const document=Object.create({pdfFlag:'1'});Object.defineProperty(document,'xbrlFlag',{get(){calls++;return '1'}});Object.defineProperty(document,'extra',{get(){throw Error('extra')}});
 expect(describeDocumentFormats(document).xbrl.state).toBe('provided');expect(calls).toBe(1);expect(describeDocumentFormats(document).pdf).toEqual({state:'unknown',reason:'unrecorded'});
});
it.each([{},[],true,1.5,Number.MAX_SAFE_INTEGER+1,'a'.repeat(33),'0\n'])('不正なフラグ %j を拒否する',value=>expect(()=>normalizeDocumentFormatFlag(value)).toThrow());
