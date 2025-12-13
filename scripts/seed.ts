import "dotenv/config";
import { EdinetInfoSeeder } from "edinet-ts";
import cliProgress from "cli-progress";
import dayjs from "dayjs";

async function main() {
    const bar = new cliProgress.SingleBar({
        format: ' {bar} {percentage}% | ETA: {eta}s | {value}/{total} | Skipped: {skipped} | Processed: {processed} | Current: {status}'
    }, cliProgress.Presets.shades_classic);

    // 期間設定（過去5年）
    const end = dayjs();
    const start = end.subtract(5, "year");

    console.log(`=== EDINET DB Seeding ===`);
    console.log(`期間: ${start.format("YYYY-MM-DD")} から ${end.format("YYYY-MM-DD")}`);

    let skippedCount = 0;
    let processedCount = 0;

    const seeder = new EdinetInfoSeeder({
        apiKey: process.env.EDINET_API_KEY,
        start,
        end,
        skipExisting: true,
        onProgress: (current: number, total: number, date: string, status: string) => {
            if (status === "skipped") skippedCount++;
            else if (status === "processed") processedCount++;

            if (current === 1) bar.start(total, 0, { status: "Start", date: date });

            bar.update(current, {
                status: `${date} (${status})`,
                skipped: skippedCount,
                processed: processedCount
            });
        },
        onError: (e: unknown, date: string) => {
            // console.error(`Failed ${date}`, e); 
        }
    });

    await seeder.run();

    bar.stop();
    console.log(`\nSeeding完了。`);
}

main();
