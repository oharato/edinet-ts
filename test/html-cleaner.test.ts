import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, stripHtmlTags, cleanHtml } from '../src/utils/html-cleaner';

describe('html-cleaner', () => {
    describe('decodeHtmlEntities', () => {
        it('should decode common HTML entities', () => {
            expect(decodeHtmlEntities('&lt;p&gt;')).toBe('<p>');
            expect(decodeHtmlEntities('&amp;apos;')).toBe("'");
            expect(decodeHtmlEntities('&quot;hello&quot;')).toBe('"hello"');
            expect(decodeHtmlEntities('&nbsp;')).toBe(' ');
        });

        it('should decode numeric HTML entities', () => {
            expect(decodeHtmlEntities('&#39;')).toBe("'");
            expect(decodeHtmlEntities('&#x27;')).toBe("'");
            expect(decodeHtmlEntities('&#65;')).toBe('A');
            expect(decodeHtmlEntities('&#x41;')).toBe('A');
        });

        it('should handle mixed entities', () => {
            const input = '&lt;p&gt;Hello &amp;apos;world&amp;apos;&lt;/p&gt;';
            const expected = "<p>Hello 'world'</p>";
            expect(decodeHtmlEntities(input)).toBe(expected);
        });

        it('should return empty string for empty input', () => {
            expect(decodeHtmlEntities('')).toBe('');
        });

        it('should handle text without entities', () => {
            expect(decodeHtmlEntities('Hello world')).toBe('Hello world');
        });
    });

    describe('stripHtmlTags', () => {
        it('should remove simple HTML tags', () => {
            expect(stripHtmlTags('<p>Hello</p>')).toBe('Hello');
            expect(stripHtmlTags('<h3>Title</h3>')).toBe('Title');
            expect(stripHtmlTags('<div>Content</div>')).toBe('Content');
        });

        it('should remove tags with attributes', () => {
            expect(stripHtmlTags('<p style="color: red;">Hello</p>')).toBe('Hello');
            expect(stripHtmlTags('<h3 class="smt_head2">Title</h3>')).toBe('Title');
        });

        it('should remove self-closing tags', () => {
            expect(stripHtmlTags('Before<br/>After')).toBe('BeforeAfter');
        });

        it('should handle nested tags', () => {
            expect(stripHtmlTags('<div><p>Hello</p></div>')).toBe('Hello');
        });

        it('should preserve text content', () => {
            const input = '<p>This is <strong>important</strong> text.</p>';
            expect(stripHtmlTags(input)).toBe('This is important text.');
        });

        it('should clean up multiple spaces', () => {
            expect(stripHtmlTags('Hello    world')).toBe('Hello world');
        });

        it('should trim lines', () => {
            expect(stripHtmlTags('  Hello  \n  World  ')).toBe('Hello\nWorld');
        });

        it('should return empty string for empty input', () => {
            expect(stripHtmlTags('')).toBe('');
        });
    });

    describe('cleanHtml', () => {
        it('should decode entities and strip tags', () => {
            const input = '&lt;p&gt;Hello&lt;/p&gt;';
            expect(cleanHtml(input)).toBe('Hello');
        });

        it('should handle complex EDINET-style HTML', () => {
            const input = '&lt;p style="page-break-before:always;"&gt; &lt;/p&gt;&lt;h3 class="smt_head2"&gt;３ 【事業等のリスク】&lt;/h3&gt;&lt;p class="smt_text2"&gt;当社の事業内容&lt;/p&gt;';
            const result = cleanHtml(input);
            expect(result).toContain('３ 【事業等のリスク】');
            expect(result).toContain('当社の事業内容');
            expect(result).not.toContain('<');
            expect(result).not.toContain('>');
        });

        it('should handle &apos; entity', () => {
            const input = '&lt;p&gt;font-family:&amp;apos;ＭＳ 明朝&amp;apos;&lt;/p&gt;';
            const result = cleanHtml(input);
            expect(result).toContain('font-family');
            expect(result).not.toContain('&apos;');
            expect(result).not.toContain('&amp;');
        });

        it('should return undefined for undefined input', () => {
            expect(cleanHtml(undefined)).toBe(undefined);
        });

        it('should handle empty string', () => {
            expect(cleanHtml('')).toBe('');
        });

        it('should handle real EDINET data sample', () => {
            // Example from actual EDINET data
            const input = '&lt;p style="page-break-before:always; line-height:0.75pt; width:100%; font-size:0.75pt;"&gt; &lt;/p&gt;&lt;h3 class="smt_head2"&gt;３ 【事業等のリスク】&lt;/h3&gt;&lt;p class="smt_text2" style="orphans:0;widows:0;"&gt;当社の事業内容、経営成績及び財政状態等に関するリスク要因について、投資者の判断に重要な影響を与える可能性のある事項を以下に記載しております。&lt;/p&gt;';
            const result = cleanHtml(input);
            
            // Should contain the content
            expect(result).toContain('３ 【事業等のリスク】');
            expect(result).toContain('当社の事業内容、経営成績及び財政状態等に関するリスク要因について');
            
            // Should not contain HTML tags or entities
            expect(result).not.toContain('<p');
            expect(result).not.toContain('<h3');
            expect(result).not.toContain('&lt;');
            expect(result).not.toContain('&gt;');
            expect(result).not.toContain('style=');
            expect(result).not.toContain('class=');
        });
    });
});
