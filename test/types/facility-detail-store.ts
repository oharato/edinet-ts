import {
  FacilityDetailStore,
  FACILITY_DETAIL_STORE_VERSION,
  type FacilityDetailStoreAppendResult,
  type FacilityDetailStoreSearchOptions,
  type FacilityDetailStoreSearchResult,
} from "../../dist/index.js";
const store = new FacilityDetailStore("facilities.sqlite", { readOnly: true });
const query: FacilityDetailStoreSearchOptions = {
  asOfDate: "2026-03-31",
  sort: { field: "landAreaM2", order: "asc" },
};
const result: FacilityDetailStoreSearchResult = store.search(query);
const appended: FacilityDetailStoreAppendResult = store.append([]);
const noXML: false = result.storage.originalXmlStored;
const version: string = FACILITY_DETAIL_STORE_VERSION;
void [appended, noXML, version, store.audit()];
store.close();

import { parseFacilitySiteAndLocation, type FacilityLocationParts } from "../../src/index";
const location: FacilityLocationParts = parseFacilitySiteAndLocation("本社（東京都中央区）");
if (location.status === "selected") {
  const reported: string = location.location;
  const scope: "reported-cell-only" = location.semantics;
  // @ts-expect-error no geocoding or property identity is established
  const latitude: number = location.latitude;
  void [reported, scope, latitude];
}
