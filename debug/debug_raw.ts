async function main() {
    const apiKey = process.env.EDINET_API_KEY!;
    const date = "2024-06-27"; // Peak season

    // User suggested: https://api.edinet-fsa.go.jp
    // And Subscription-Key in query params
    const baseUrl = "https://api.edinet-fsa.go.jp/api/v2";
    const url = `${baseUrl}/documents.json?date=${date}&type=2&Subscription-Key=${apiKey}`;

    console.log(`Fetching: ${url}`);

    try {
        const res = await fetch(url); // No header this time, strictly testing User's suggestion

        console.log(`Status: ${res.status} ${res.statusText}`);

        const text = await res.text();
        console.log("Body length:", text.length);
        console.log("First 500 chars of body:", text.substring(0, 500));

        try {
            const json = JSON.parse(text);
            console.log("Metadata:", JSON.stringify(json.metadata, null, 2));
            console.log("Results count:", json.results ? json.results.length : "undefined");
        } catch (e) {
            console.log("Not JSON.");
        }

    } catch (e) {
        console.error("Fetch error:", e);
    }
}

main();
