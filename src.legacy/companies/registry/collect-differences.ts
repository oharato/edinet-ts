/** 保存カレンダーの非公開日を保持しながら、日数予算内で差分取得を順に進める。 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import { createRegistryDifferencePlan } from "./create-difference-plan";
import { fetchRegistryDifference } from "./fetch-difference";
import { createRegistrySession, type RegistryRequest } from "./download-session";
import { atomic, budget, load, presentDate, same, withRegistryOutput } from "./acquisition-files";
export async function collectRegistryDifferences(
  calendar: string,
  query: string,
  key: string,
  fingerprint: string,
  output: string,
  maxDownloads = 1,
  sdkCli = fileURLToPath(new URL("../../cli.js", import.meta.url)),
  node = process.execPath,
  sessionFactory: (date: string) => RegistryRequest = createRegistrySession,
) {
  budget(maxDownloads);
  calendar = resolve(calendar);
  query = resolve(query);
  const differencePlan = await createRegistryDifferencePlan(calendar, query, resolve(sdkCli), node),
    q = differencePlan.query;
  presentDate(q.through);
  const cutoff = Date.parse(q.knownAt);
  assert(
    Number.isFinite(cutoff) && cutoff <= Date.now(),
    "Collection cannot use a future calendar cutoff",
  );
  return withRegistryOutput(output, key, fingerprint, async (root, trust, key) => {
    const plan = { format: "edinet-ts-corporate-registry-collection-v1", differencePlan, ...trust };
    if (existsSync(join(root, "plan.json")))
      same(load(join(root, "plan.json")), plan, "Collection plan changed");
    else atomic(join(root, "plan.json"), plan);
    const completed: any[] = [],
      pending: string[] = [];
    let downloads = 0,
      requests = 0;
    const summary = (status: string) => ({
      format: plan.format,
      status,
      query: q,
      calendar: differencePlan.calendar,
      nonPublicationDays: differencePlan.nonPublicationDays,
      completed,
      pendingDates: pending,
      downloadsThisRun: downloads,
      requestsThisRun: requests,
      latestObservedAt: completed.length
        ? completed
            .map((value) => value.source.observedAt)
            .sort()
            .at(-1)
        : null,
    });
    atomic(join(root, "status.json"), summary("checking"));
    for (const [index, date] of differencePlan.expectedDates.entries()) {
      const day = join(root, "days", date);
      if (!existsSync(join(day, "complete.json")) && downloads >= maxDownloads) {
        pending.push(date);
        continue;
      }
      let dayRequested = false;
      const onRequest = () => {
        requests++;
        if (!dayRequested) {
          downloads++;
          dayRequested = true;
        }
      };
      try {
        const result = await fetchRegistryDifference(
            date,
            key,
            fingerprint,
            day,
            sessionFactory(date),
            onRequest,
          ),
          part = load(result.importManifest);
        completed.push({
          date,
          status: result.status,
          importManifest: result.importManifest,
          source: part.source,
          sha256: part.sha256,
          acquisitionReceipt: join(day, "complete.json"),
        });
        atomic(join(root, "status.json"), summary("checking"));
      } catch (error) {
        pending.push(...differencePlan.expectedDates.slice(index));
        atomic(join(root, "status.json"), summary("failed"));
        throw error;
      }
    }
    const result = summary(pending.length ? "pending" : "complete");
    atomic(join(root, "status.json"), result);
    return result;
  });
}
