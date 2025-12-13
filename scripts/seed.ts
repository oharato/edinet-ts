import "dotenv/config";
import { EdinetInfoSeeder } from "edinet-ts";
import cliProgress from "cli-progress";
import dayjs from "dayjs";

async function main() {
    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

    // 期間設定（過去5年）
    const end = dayjs();
    const start = end.subtract(5, "year");

    console.log(`=== EDINET DB Seeding ===`);
    console.log(`期間: ${start.format("YYYY-MM-DD")} から ${end.format("YYYY-MM-DD")}`);

    const seeder = new EdinetInfoSeeder({
        apiKey: process.env.EDINET_API_KEY,
        start,
        end,
        onProgress: (current: number, total: number) => {
            if (current === 1) bar.start(total, 0);
            bar.update(current);
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
