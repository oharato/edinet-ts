import { describe, it, expect } from "vitest";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";

describe("EdinetXbrlParser - Quarterly Reports", () => {
    const parser = new EdinetXbrlParser();

    /**
     * Test that quarterly reports with document-specific namespaces are parsed correctly.
     * Quarterly reports use namespaces like jpcrp040300-q2r_E39268-000 instead of jpcrp_cor.
     */
    it("parses quarterly report with document-specific namespace", () => {
        // Minimal quarterly report XBRL with document-specific namespace
        const quarterlyXbrl = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
    xmlns:jpcrp040300-q2r_E39268-000="http://disclosure.edinet-fsa.go.jp/jpcrp040300/q2r/001/E39268-000/2024-06-30/01/2024-08-09"
    xmlns:jpcrp_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2023-12-01/jpcrp_cor"
    xmlns:jppfs_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2023-12-01/jppfs_cor">
    
    <xbrli:context id="FilingDateInstant">
        <xbrli:entity>
            <xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E39268-000</xbrli:identifier>
        </xbrli:entity>
        <xbrli:period>
            <xbrli:instant>2024-08-09</xbrli:instant>
        </xbrli:period>
    </xbrli:context>
    
    <xbrli:context id="CurrentYearDuration">
        <xbrli:entity>
            <xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E39268-000</xbrli:identifier>
        </xbrli:entity>
        <xbrli:period>
            <xbrli:startDate>2024-04-01</xbrli:startDate>
            <xbrli:endDate>2024-06-30</xbrli:endDate>
        </xbrli:period>
    </xbrli:context>
    
    <!-- Text blocks with document-specific namespace -->
    <jpcrp040300-q2r_E39268-000:BusinessRisksTextBlock contextRef="FilingDateInstant">This is the business risks content from quarterly report.</jpcrp040300-q2r_E39268-000:BusinessRisksTextBlock>
    
    <jpcrp040300-q2r_E39268-000:ManagementAnalysisOfFinancialPositionOperatingResultsAndCashFlowsTextBlock contextRef="FilingDateInstant">This is the management analysis content from quarterly report.</jpcrp040300-q2r_E39268-000:ManagementAnalysisOfFinancialPositionOperatingResultsAndCashFlowsTextBlock>
    
    <!-- Financial data using standard namespace -->
    <jppfs_cor:NetSales contextRef="CurrentYearDuration" unitRef="JPY" decimals="0">1000000000</jppfs_cor:NetSales>
</xbrli:xbrl>`;

        const parsed = parser.parse(quarterlyXbrl);

        // Check that contexts are parsed
        expect(parsed.contextMap.size).toBeGreaterThan(0);

        // Check that data is collected (this should work)
        expect(parsed.dataMap.size).toBeGreaterThan(0);

        // Debug: Check what keys are in the dataMap
        const keys = parsed.getKeys();
        console.log("Keys in dataMap:", keys);
        
        // Check raw data extraction
        const businessRisksData = parsed.getDataListByTagName("BusinessRisksTextBlock");
        console.log("BusinessRisksTextBlock data:", businessRisksData);

        // The issue: Text blocks should be accessible via getQualitativeInfo
        const qualInfo = parsed.getQualitativeInfo();
        
        // These should NOT be undefined - this is the bug we're fixing
        expect(qualInfo.businessRisks).toBeDefined();
        expect(qualInfo.businessRisks).toContain("business risks content");
        
        expect(qualInfo.financialAnalysis).toBeDefined();
        expect(qualInfo.financialAnalysis).toContain("management analysis content");
    });

    /**
     * Test that semi-annual reports with document-specific namespaces are also parsed correctly.
     */
    it("parses semi-annual report with document-specific namespace", () => {
        const semiAnnualXbrl = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
    xmlns:jpcrp040100-shr_E12345-000="http://disclosure.edinet-fsa.go.jp/jpcrp040100/shr/001/E12345-000/2024-09-30/01/2024-11-15"
    xmlns:jpcrp_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2023-12-01/jpcrp_cor">
    
    <xbrli:context id="FilingDateInstant">
        <xbrli:entity>
            <xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E12345-000</xbrli:identifier>
        </xbrli:entity>
        <xbrli:period>
            <xbrli:instant>2024-11-15</xbrli:instant>
        </xbrli:period>
    </xbrli:context>
    
    <jpcrp040100-shr_E12345-000:ResearchAndDevelopmentActivitiesTextBlock contextRef="FilingDateInstant">
        R&amp;D activities from semi-annual report.
    </jpcrp040100-shr_E12345-000:ResearchAndDevelopmentActivitiesTextBlock>
</xbrli:xbrl>`;

        const parsed = parser.parse(semiAnnualXbrl);
        const qualInfo = parsed.getQualitativeInfo();
        
        expect(qualInfo.researchAndDevelopment).toBeDefined();
        expect(qualInfo.researchAndDevelopment).toContain("R&D activities");
    });

    /**
     * Test that typed proxy also works with document-specific namespaces.
     * This verifies that getJpcrpCor() can retrieve text blocks from quarterly reports.
     */
    it("accesses quarterly report data via typed proxy", () => {
        const quarterlyXbrl = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
    xmlns:jpcrp040300-q2r_E39268-000="http://disclosure.edinet-fsa.go.jp/jpcrp040300/q2r/001/E39268-000/2024-06-30/01/2024-08-09"
    xmlns:jpcrp_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2023-12-01/jpcrp_cor">
    
    <xbrli:context id="FilingDateInstant">
        <xbrli:entity>
            <xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E39268-000</xbrli:identifier>
        </xbrli:entity>
        <xbrli:period>
            <xbrli:instant>2024-08-09</xbrli:instant>
        </xbrli:period>
    </xbrli:context>
    
    <jpcrp040300-q2r_E39268-000:CorporateGovernanceTextBlock contextRef="FilingDateInstant">Corporate governance information from quarterly report.</jpcrp040300-q2r_E39268-000:CorporateGovernanceTextBlock>
</xbrli:xbrl>`;

        const parsed = parser.parse(quarterlyXbrl);
        
        // Test namespace-agnostic method
        const dataList = parsed.getDataListByTagName("CorporateGovernanceTextBlock");
        expect(dataList.length).toBeGreaterThan(0);
        expect(dataList[0].value).toContain("Corporate governance");
        
        // Test typed proxy - should now also work with fallback mechanism
        const jpcrpCor = parsed.getJpcrpCor();
        expect(jpcrpCor.CorporateGovernanceTextBlock).toBeDefined();
        expect(jpcrpCor.CorporateGovernanceTextBlock).toContain("Corporate governance");
    });

    /**
     * Test quarterly reports that use STANDARD jpcrp_cor namespace (not document-specific).
     * Some quarterly reports DO use the standard namespace, not document-specific ones.
     */
    it("parses quarterly report with standard jpcrp_cor namespace", () => {
        const quarterlyXbrl = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
    xmlns:jpcrp_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2023-12-01/jpcrp_cor"
    xmlns:jppfs_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2023-12-01/jppfs_cor">
    
    <xbrli:context id="FilingDateInstant">
        <xbrli:entity>
            <xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E05563-000</xbrli:identifier>
        </xbrli:entity>
        <xbrli:period>
            <xbrli:instant>2025-07-23</xbrli:instant>
        </xbrli:period>
    </xbrli:context>
    
    <xbrli:context id="CurrentQuarterDuration">
        <xbrli:entity>
            <xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E05563-000</xbrli:identifier>
        </xbrli:entity>
        <xbrli:period>
            <xbrli:startDate>2025-05-01</xbrli:startDate>
            <xbrli:endDate>2025-07-31</xbrli:endDate>
        </xbrli:period>
    </xbrli:context>
    
    <!-- Text blocks with STANDARD namespace -->
    <jpcrp_cor:BusinessRisksTextBlock contextRef="FilingDateInstant">Standard namespace business risks text.</jpcrp_cor:BusinessRisksTextBlock>
    <jpcrp_cor:ManagementAnalysisOfFinancialPositionOperatingResultsAndCashFlowsTextBlock contextRef="FilingDateInstant">Standard namespace management analysis.</jpcrp_cor:ManagementAnalysisOfFinancialPositionOperatingResultsAndCashFlowsTextBlock>
    <jpcrp_cor:ResearchAndDevelopmentActivitiesTextBlock contextRef="FilingDateInstant">R&amp;D activities text.</jpcrp_cor:ResearchAndDevelopmentActivitiesTextBlock>
    
    <!-- Numeric data -->
    <jppfs_cor:NetSales contextRef="CurrentQuarterDuration" unitRef="JPY" decimals="-3">6098405000</jppfs_cor:NetSales>
</xbrli:xbrl>`;

        const parsed = parser.parse(quarterlyXbrl);
        
        // Check that data is collected
        expect(parsed.dataMap.size).toBeGreaterThan(0);
        
        // Check qualitative info extraction
        const qualInfo = parsed.getQualitativeInfo();
        expect(qualInfo.businessRisks).toBeDefined();
        expect(qualInfo.businessRisks).toContain("Standard namespace business risks");
        expect(qualInfo.financialAnalysis).toBeDefined();
        expect(qualInfo.financialAnalysis).toContain("Standard namespace management analysis");
        expect(qualInfo.researchAndDevelopment).toBeDefined();
        expect(qualInfo.researchAndDevelopment).toContain("R&D activities");
        
        // Check numeric data
        const metrics = parsed.getKeyMetrics();
        expect(metrics.netSales).toBe(6098405000);
    });
});
