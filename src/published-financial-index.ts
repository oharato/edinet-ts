import { resolve } from "node:path";
import { FinancialIndexPublication, type FinancialIndexPublicationCandidate } from "./db/financial-index-publication";
import { FinancialSearchIndex, type FinancialIndexCohort, type FinancialIndexSearchOptions, type FinancialIndexSearchResult, type FinancialIndexQuality } from "./db/financial-search-index";
export interface PublishedFinancialIndexSnapshot {
    publication: string;
    generation: string;
    generationSha256: string;
    qualitySha256: string;
    cutoff: string;
    populationCompanies: number;
}
export interface PublishedFinancialIndexSearchResult extends FinancialIndexSearchResult {
    snapshot: PublishedFinancialIndexSnapshot;
}
/** 公開済みの検査済みsnapshotで検索。新候補の検査失敗を通知し、既存の読取snapshotを保持します。 */
export class PublishedFinancialIndex {
    private readonly catalogFile: string;
    private readonly indexFile: string;
    private loaded?: {
        index: FinancialSearchIndex;
        candidate: FinancialIndexPublicationCandidate;
    };
    private closed = false;
    constructor(catalogFile: string, indexFile: string) {
        if (typeof catalogFile !== "string" || !catalogFile.trim() || typeof indexFile !== "string" || !indexFile.trim())
            throw new Error("公開catalogと財務索引のパスが必要です");
        this.catalogFile = resolve(catalogFile);
        this.indexFile = resolve(indexFile);
        this.reload();
    }
    private current() { if (this.closed || !this.loaded)
        throw new Error("公開財務snapshotはclose済みまたは未ロードです"); return this.loaded; }
    private describe(candidate: FinancialIndexPublicationCandidate): PublishedFinancialIndexSnapshot {
        const populationCompanies = candidate.quality.populationCompanies;
        if (populationCompanies === undefined)
            throw new Error("公開候補に固定母集団がありません");
        return { publication: candidate.id, generation: candidate.generation, generationSha256: candidate.generationSha256, qualitySha256: candidate.qualitySha256, cutoff: candidate.quality.cutoff, populationCompanies };
    }
    snapshot(): PublishedFinancialIndexSnapshot { return this.describe(this.current().candidate); }
    quality(): FinancialIndexQuality { return structuredClone(this.current().candidate.quality); }
    reload(): PublishedFinancialIndexSnapshot {
        if (this.closed)
            throw new Error("公開財務snapshotはclose済みです");
        let catalog: FinancialIndexPublication | undefined, index: FinancialSearchIndex | undefined;
        try {
            catalog = new FinancialIndexPublication(this.catalogFile, { readOnly: true });
            if (!catalog.current())
                throw new Error("公開候補がありません");
            index = new FinancialSearchIndex(this.indexFile, { readOnly: true });
            const candidate = catalog.resolve(index);
            if (!candidate)
                throw new Error("公開候補がありません");
            const metadata = this.describe(candidate), previous = this.loaded;
            this.loaded = { index, candidate };
            index = undefined;
            previous?.index.close();
            return metadata;
        }
        finally {
            index?.close();
            catalog?.close();
        }
    }
    screen(cohort: Omit<FinancialIndexCohort, "generation">, options: FinancialIndexSearchOptions): PublishedFinancialIndexSearchResult {
        const current = this.current();
        if (!cohort || typeof cohort !== "object" || Object.hasOwn(cohort, "generation"))
            throw new Error("公開snapshotの世代は検索条件で指定できません");
        const result = current.index.screen({ ...cohort, generation: current.candidate.generation }, options);
        return { ...result, snapshot: this.describe(current.candidate) };
    }
    close(): void { if (this.closed)
        return; this.loaded?.index.close(); this.loaded = undefined; this.closed = true; }
}
