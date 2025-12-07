import { EdinetRepository } from "../src/db/edinet-repository";
import { EdinetDocument } from "../src/edinet-xbrl-downloader";

async function main() {
    console.log("=== Testing DB Repository ===");
    const repo = new EdinetRepository("./data/test_edinet.db");

    const mockDoc: EdinetDocument = {
        docID: "TEST0001",
        secCode: "72030", // Toyota
        docDescription: "Test Report",
        docTypeCode: "120",
        filerName: "Toyota Motor Corp",
        periodEnd: "2024-03-31",
        docInfoEditStatus: 0,
        // other fields
    } as any;

    console.log("Inserting document...");
    repo.insertDocument(mockDoc, "2024-06-25");

    console.log("Searching document...");
    const results = repo.findDocuments({
        secCode: "72030",
        docTypeCode: "120"
    });

    console.log("Results found:", results.length);
    if (results.length > 0) {
        console.log("Found:", results[0]);
    }

    console.log("Cleaning up...");
    repo.close();
    // fs.unlinkSync("./data/test_edinet.db"); // Keep for inspection if needed
}

main();
