/** 指定した固定SDKのCLIで、保存カレンダーに基づく差分取得日を計画する。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
export async function createRegistryDifferencePlan(
  calendar: string,
  query: string,
  sdkCli: string,
  node: string,
) {
  const { stdout } = await promisify(execFile)(
    node,
    [sdkCli, "plan-corporate-registry-differences", "--calendar", calendar, "--query", query],
    { timeout: 30000, maxBuffer: 2 * 1024 ** 2 },
  );
  return JSON.parse(stdout);
}
