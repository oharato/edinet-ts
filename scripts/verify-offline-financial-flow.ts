import { Command } from "commander";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BalanceSheetSqliteStore, createBalanceSheetSnapshot, screenBalanceSheetSnapshots, calculateCurrentRatio,
    type BalanceSheetSnapshot, type BalanceSheetScreeningOptions } from "../src/index";
import { readRegularFile, LOCAL_IMPORT_LIMITS } from "../src/local-balance-sheet-import";

const moneyIds = ["currentAssets", "currentLiabilities", "totalLiabilities"] as const;
const baselineVersion = "offline-verification-base", reparseVersion = "offline-verification-reparse";
const modulePath = fileURLToPath(import.meta.url), root = resolve(dirname(modulePath), "..");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
class OfflineVerificationError extends Error {}
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new OfflineVerificationError(message); }
const object = (v: any): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
function keys(v: unknown, allowed: readonly string[]): boolean { return object(v) && Object.keys(v).every(key => allowed.includes(key)); }
function metadataKey(entry: Record<string, any>): string {
    check(object(entry) && typeof entry.secCode === "string" && /^[0-9A-Z]{4}0?$/.test(entry.secCode), "metadataの証券コードが不正です");
    return JSON.stringify([entry.secCode.length === 4 ? entry.secCode + "0" : entry.secCode, entry.docID, entry.instant,
        entry.scope, entry.accountingStandard, entry.currency ?? "JPY"]);
}
function cohortKey(entry: Record<string, any>): string { return JSON.stringify([entry.instant, entry.scope, entry.accountingStandard, entry.currency ?? "JPY"]); }
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, item[key]])) : item);
const jsonEqual = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export interface OfflineFlowOptions { sourceCli?: boolean; }

/** 明示入力のみ。自作した一時DBだけを使い、stdoutへ金額・原本・IDを出さない検証runner。 */
export function verifyOfflineFinancialFlow(configPath: string, options: OfflineFlowOptions = {}) {
    const fingerprints = new Map<string, { hash: string; limit: number; identity: string; requests: Set<string> }>();
    function read(file: string, limit: number) {
        const input = readRegularFile(file, limit);
        const digest = hash(input.bytes), existing = fingerprints.get(input.path);
        check(!existing || existing.hash === digest && existing.identity === input.identity, "入力ファイルが読取間で変化しました（内容は出力しません）");
        if (!existing) fingerprints.set(input.path, { hash: digest, limit, identity: input.identity, requests: new Set([resolve(file)]) });
        else existing.requests.add(resolve(file));
        return input;
    }
    function json(file: string) {
        try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read(file, 2 * 1024 * 1024).bytes)); }
        catch { throw new OfflineVerificationError("検証用JSONを読めません（内容は出力しません）"); }
    }
    const configFile = resolve(configPath), config = json(configFile);
    check(keys(config, ["manifest", "expectations", "queries"]) && [config.manifest, config.expectations, config.queries].every(value => typeof value === "string" && value.trim()), "configはmanifest/expectations/queriesの3パスを指定してください");
    const manifestFile = resolve(dirname(configFile), config.manifest), manifest = json(manifestFile);
    const expected = json(resolve(dirname(configFile), config.expectations)), queries = json(resolve(dirname(configFile), config.queries));
    check(Array.isArray(manifest) && manifest.length > 0 && manifest.length <= LOCAL_IMPORT_LIMITS.entries, "manifestは1～100件の明示一覧です");
    check(Array.isArray(expected) && expected.length === manifest.length, "期待値はmanifestと1対1で指定してください");
    check(Array.isArray(queries) && queries.length > 0 && queries.length <= 1000, "検索期待値は1～1000件で指定してください");
    const expectedByKey = new Map<string, any>();
    for (const entry of expected) {
        check(keys(entry, ["metadata", "metrics", "currentRatio", "expectedDiff", "origin"]) && object(entry.metadata) && object(entry.metrics) && object(entry.currentRatio), "期待値の形式が不正です");
        check(keys(entry.metadata, ["secCode", "docID", "instant", "scope", "accountingStandard", "currency"]), "期待値metadataの形式が不正です");
        const key = metadataKey(entry.metadata); check(!expectedByKey.has(key), "期待値metadataが重複しています");
        check(Object.keys(entry.metrics).length === 3 && moneyIds.every(id => object(entry.metrics[id])), "期待値にはBS3全項目の状態を指定してください");
        for (const id of moneyIds) {
            const metric = entry.metrics[id];
            check(keys(metric, ["status", "raw", "reason"]) && ["selected", "missing", "unsupported", "ambiguous"].includes(metric.status), "期待値の採用状態が不正です");
            check(metric.status === "selected" ? typeof metric.raw === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(metric.raw) : metric.raw === undefined && typeof metric.reason === "string" && !!metric.reason.trim(), "期待値の原値/欠損理由が不正です");
            check(metric.reason === undefined || typeof metric.reason === "string", "期待値の理由が不正です");
        }
        const ratio = entry.currentRatio;
        check(keys(ratio, ["status", "exact", "reason"]) && (ratio.status === "calculated" ?
            keys(ratio.exact, ["numerator", "denominator"]) && typeof ratio.exact.numerator === "string" && /^\d+$/.test(ratio.exact.numerator) &&
                typeof ratio.exact.denominator === "string" && /^\d+$/.test(ratio.exact.denominator) && /[1-9]/.test(ratio.exact.denominator) && ratio.reason === undefined :
            ratio.status === "unavailable" && typeof ratio.reason === "string" && !!ratio.reason.trim() && ratio.exact === undefined), "期待する流動比率の状態/分数が不正です");
        check(["unchanged", "incomparable"].includes(entry.expectedDiff), "同一コードで再解析するdiff期待状態を指定してください");
        check(keys(entry.origin, ["column", "filingYear"]) && ["current", "prior", "synthetic", "unknown"].includes(entry.origin.column) &&
            (entry.origin.filingYear === undefined || Number.isInteger(entry.origin.filingYear) && entry.origin.filingYear >= 1900 && entry.origin.filingYear <= 9999), "原本の列/提出年の宣言が不正です");
        expectedByKey.set(key, entry);
    }
    const snapshots: BalanceSheetSnapshot[] = [], seen = new Set<string>(); let totalBytes = 0;
    for (let i = 0; i < manifest.length; i++) {
        const entry = manifest[i];
        check(keys(entry, ["file", "secCode", "docID", "instant", "scope", "accountingStandard", "currency"]) && typeof entry.file === "string" && !!entry.file.trim(), "manifest項目が不正です");
        const key = metadataKey(entry); check(expectedByKey.has(key) && !seen.has(key), "manifestと期待値metadataが一致しないか重複しています"); seen.add(key);
        try {
            const input = read(resolve(dirname(manifestFile), entry.file), Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - totalBytes));
            totalBytes += input.bytes.byteLength;
            snapshots.push(createBalanceSheetSnapshot(new TextDecoder("utf-8", { fatal: true }).decode(input.bytes), { secCode: entry.secCode, docID: entry.docID,
                instant: entry.instant, scope: entry.scope, accountingStandard: entry.accountingStandard, currency: entry.currency ?? "JPY" }));
        } catch { throw new OfflineVerificationError(`原本の読取/解析に失敗しました: 項目${i + 1}（内容は出力しません）`); }
    }
    check(seen.size === expectedByKey.size, "期待値に余分なmetadataがあります");
    for (const query of queries) {
        check(keys(query, ["cohort", "options", "expectedCodes"]) && keys(query.cohort, ["instant", "scope", "accountingStandard", "currency"]) && object(query.options) &&
            Array.isArray(query.expectedCodes) && query.expectedCodes.every((code: unknown) => typeof code === "string" && /^[0-9A-Z]{4}0$/.test(code)), "検索期待値の形式が不正です");
        const members = new Set(snapshots.filter(row => cohortKey(row) === cohortKey(query.cohort)).map(row => row.secCode));
        check(members.size > 0, "検索対象の範囲に入力原本がありません");
        check(new Set(query.expectedCodes).size === query.expectedCodes.length && query.expectedCodes.every((code: string) => members.has(code)), "検索期待コードが重複または対象外です");
        try { screenBalanceSheetSnapshots([], query.options); } catch { throw new OfflineVerificationError("検索条件が不正です（値は出力しません）"); }
    }
    const cli = join(root, options.sourceCli ? "src/cli.ts" : "dist/cli.js");
    check(fs.existsSync(cli), "CLIがありません。先にnpm run buildを実行してください");
    const dir = fs.mkdtempSync(join(tmpdir(), "edinet-offline-flow-")), dbFile = join(dir, "financial.sqlite");
    let cliChecks = 0, queryChecks = 0, comparedDiffs = 0, incomparableDiffs = 0;
    const selectionCounts = { selected: 0, missing: 0, unsupported: 0, ambiguous: 0 }, ratioCounts: Record<string, number> = {};
    function command(args: string[], acceptable: number[] = [0]): any {
        const result = spawnSync(process.execPath, [...(options.sourceCli ? ["--import", join(root, "node_modules/tsx/dist/loader.mjs")] : []), cli, ...args],
            { cwd: dir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
        check(result.status !== null && acceptable.includes(result.status) && !result.error, `CLI検証に失敗しました: ${args[0]}（stdout/stderrは出力しません）`);
        let parsed: any; try { parsed = JSON.parse(result.stdout); } catch { throw new OfflineVerificationError("CLIのJSON応答を読めません（内容は出力しません）"); }
        cliChecks++; return parsed;
    }
    const importArgs = (version: string) => ["import-bs", "--manifest", manifestFile, "--db", dbFile, "--extractor-version", version];
    function verifySaved(ids: string[], version: string, countStates: boolean) {
        const store = new BalanceSheetSqliteStore(dbFile, { readOnly: true });
        try {
            const saved = store.getMany(ids); check(saved.length === manifest.length, "保存件数が一致しません");
            for (let i = 0; i < saved.length; i++) {
                const row = saved[i], expectedRow = expectedByKey.get(metadataKey(row.snapshot));
                check(metadataKey(row.snapshot) === metadataKey(manifest[i]), `保存IDの入力順が一致しません: 項目${i + 1}`);
                check(expectedRow, "保存metadataが期待値にありません");
                check(jsonEqual(row.snapshot.selections, snapshots[i].selections), `保存とメモリの原値/出典が一致しません: 項目${i + 1}`);
                for (const id of moneyIds) {
                    const got = row.snapshot.selections[id], want = expectedRow.metrics[id];
                    check(got.status === want.status && (want.status !== "selected" || got.raw === want.raw) && (want.reason === undefined || got.reason === want.reason), `原値/状態の期待値不一致: 項目${i + 1}/${id}`);
                    if (countStates) selectionCounts[got.status]++;
                }
                const result = store.search({ instant: row.snapshot.instant, scope: row.snapshot.scope, accountingStandard: "J-GAAP", currency: "JPY", extractorVersion: version, mappingVersion: row.provenance.mappingVersion, snapshotIds: [row.id] }, { sortBy: "currentRatio" });
                const ratio = result.rows[0]?.derivedMetrics?.currentRatio, want = expectedRow.currentRatio;
                if (want.status === "calculated") check(ratio?.status === "calculated" && jsonEqual(ratio.exact, want.exact), `比率期待値不一致: 項目${i + 1}`);
                else {
                    // 検索から除外されても元snapshotの計算理由で区別します。
                    const memory = screenBalanceSheetSnapshots([row.snapshot], { sortBy: "currentRatio" });
                    const actualRatio = calculateCurrentRatio(row.snapshot);
                    check(actualRatio.status === "unavailable" && actualRatio.reason === want.reason && !ratio && memory.excludedRows === 1 && result.excludedRows === 1, `比率除外の期待値不一致: 項目${i + 1}`);
                }
                if (countStates) { const status = want.status === "calculated" ? "calculated" : want.reason; ratioCounts[status] = (ratioCounts[status] ?? 0) + 1; }
            }
            for (let i = 0; i < queries.length; i++) {
                const query = queries[i], indexes = snapshots.map((row, index) => ({ row, index })).filter(({ row }) => cohortKey(row) === cohortKey(query.cohort));
                const mappingVersion = saved[indexes[0].index].provenance.mappingVersion;
                const actual = store.search({ ...query.cohort, currency: query.cohort.currency ?? "JPY", extractorVersion: version, mappingVersion, snapshotIds: indexes.map(({ index }) => ids[index]) }, query.options as BalanceSheetScreeningOptions);
                const memory = screenBalanceSheetSnapshots(indexes.map(({ row }) => row), query.options);
                check(jsonEqual(actual, memory), `保存検索とメモリ検索が一致しません: 条件${i + 1}`);
                check(jsonEqual(actual.rows.map(row => row.secCode), query.expectedCodes), `検索の明示期待値不一致: 条件${i + 1}`); queryChecks++;
            }
        } finally { store.close(); }
    }
    try {
        const preview = command([...importArgs(baselineVersion), "--dry-run"]);
        check(preview.plan.counts.new === manifest.length && !fs.existsSync(dbFile), "dry-runが新規計画/非作成条件を満たしません");
        const first = command([...importArgs(baselineVersion), "--create"]);
        check(first.processed === manifest.length && first.inserted === manifest.length && first.unchanged === 0, "初回取り込み件数が一致しません");
        verifySaved(first.snapshotIds, baselineVersion, true);
        const repeat = command(importArgs(baselineVersion));
        check(repeat.processed === 0 && repeat.inserted === 0 && repeat.unchanged === manifest.length && jsonEqual(repeat.snapshotIds, first.snapshotIds), "再実行が処理不要/同IDになりません");
        verifySaved(repeat.snapshotIds, baselineVersion, false);
        const reparse = command(importArgs(reparseVersion));
        check(reparse.plan.counts.changed === manifest.length && reparse.processed === manifest.length && reparse.inserted === manifest.length, "解析版ラベル変更が再解析になりません");
        verifySaved(reparse.snapshotIds, reparseVersion, false);
        const reparseRepeat = command(importArgs(reparseVersion));
        check(reparseRepeat.processed === 0 && reparseRepeat.inserted === 0 && reparseRepeat.unchanged === manifest.length && jsonEqual(reparseRepeat.snapshotIds, reparse.snapshotIds), "再解析後の再実行が処理不要になりません");
        for (let i = 0; i < manifest.length; i++) {
            const want = expectedByKey.get(metadataKey(manifest[i])).expectedDiff;
            const result = command(["diff-bs", "--db", dbFile, "--before", first.snapshotIds[i], "--after", reparse.snapshotIds[i]], want === "incomparable" ? [1] : [0]);
            check(result.status === want && jsonEqual(result.provenanceChanges, ["extractorVersion"]), `同一コード再解析diffが期待と一致しません: 項目${i + 1}`);
            if (want === "incomparable") { check(result.issues.length && result.issues.every((issue: any) => issue.field === "entity" && issue.reason === "unknown-entity"), "想定外の比較不可理由です"); incomparableDiffs++; }
            else comparedDiffs++;
        }
        for (const [file, fingerprint] of fingerprints) for (const requested of fingerprint.requests) {
            const current = readRegularFile(requested, fingerprint.limit);
            check(current.path === file && current.identity === fingerprint.identity && hash(current.bytes) === fingerprint.hash, "入力ファイルが検証中に変わりました（内容は出力しません）");
        }
        const reader = new BalanceSheetSqliteStore(dbFile, { readOnly: true });
        try { check(reader.inventory().entries.length === manifest.length * 2, "旧新版の保存件数が一致しません"); } finally { reader.close(); }
        const columns = { current: 0, prior: 0, synthetic: 0, unknown: 0 };
        for (const entry of expected) columns[entry.origin.column as keyof typeof columns]++;
        return { passed: true, snapshots: manifest.length, companies: new Set(snapshots.map(row => row.secCode)).size,
            instants: new Set(snapshots.map(row => row.instant)).size, queriesPerOpen: queries.length, queryChecks, cliChecks,
            selectionCounts, ratioCounts, comparedDiffs, incomparableDiffs, originalInputsUnchanged: fingerprints.size,
            declaredCoverage: { columns, filingYears: [...new Set(expected.flatMap((entry: any) => entry.origin.filingYear === undefined ? [] : [entry.origin.filingYear]))].sort(), externalReferencesVerified: false },
            sameParserReparse: true, performanceMeasured: false, cliMode: options.sourceCli ? "source" : "built", nodeVersion: process.version };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
    new Command().name("verify-offline-financial-flow").requiredOption("--config <path>", "manifest/期待値/検索期待値の3JSONパスを持つローカルconfig")
        .option("--source-cli", "回帰テスト用にsrc/cli.tsを使う（既定はbuild済みdist/cli.js）")
        .action(options => {
            try { console.log(JSON.stringify(verifyOfflineFinancialFlow(options.config, { sourceCli: options.sourceCli }))); }
            catch (error) { console.error((error instanceof OfflineVerificationError ? error.message : "オフライン検証に失敗しました。入力の組と期待値、build状態をローカルで確認してください") + "（原本・金額は出力しません）。"); process.exitCode = 1; }
        }).parse();
}
