import { Edinet, EdinetXbrlDownloader, type EdinetClientOptions, type EdinetConfig } from "../../src/index";
const options: EdinetClientOptions = { maxRetryDelayMs: 60_000, maxRetries: 2, requestTimeoutMs: 10_000 };
const client = new EdinetXbrlDownloader(options);
const config: EdinetConfig = { maxRetryDelayMs: 30_000 };
function facade() { return new Edinet(config); }
void client; void facade;
// @ts-expect-error 待ち上限は数値で指定
new EdinetXbrlDownloader({ maxRetryDelayMs: "60000" });
