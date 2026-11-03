const { createRequire, syncBuiltinESMExports } = require("node:module");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const localRequire = createRequire(join(process.cwd(), "package.json"));
let databaseConstructors = 0;
let networkRequests = 0;
const sqlite = require("node:sqlite");
for (const name of ["Database", "DatabaseSync"])
  if (typeof sqlite[name] === "function") {
    sqlite[name] = new Proxy(sqlite[name], {
      construct() {
        databaseConstructors++;
        throw Error("API import must not open a database");
      },
    });
  }
const network = () => {
  networkRequests++;
  throw Error("API import must not request data");
};
globalThis.fetch = network;
for (const name of ["node:http", "node:https"]) {
  const module = require(name);
  module.request = network;
  module.get = network;
}
syncBuiltinESMExports();
function descriptors(value, constructor) {
  return Object.fromEntries(
    Object.entries(Object.getOwnPropertyDescriptors(value))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, d]) => [
        name,
        {
          configurable: d.configurable,
          enumerable: d.enumerable,
          writable: d.writable,
          valueType: "value" in d ? typeof d.value : undefined,
          functionName: typeof d.value === "function" ? d.value.name : undefined,
          functionLength: typeof d.value === "function" ? d.value.length : undefined,
          selfConstructor: name === "constructor" ? d.value === constructor : undefined,
          getter: typeof d.get,
          setter: typeof d.set,
        },
      ]),
  );
}
function signatures(namespace) {
  return Object.fromEntries(
    Object.keys(namespace)
      .sort()
      .filter((name) => typeof namespace[name] === "function")
      .map((name) => {
        const value = namespace[name],
          prototypes = [];
        let p = value.prototype;
        while (p && p !== Object.prototype) {
          prototypes.push(descriptors(p, value));
          p = Object.getPrototypeOf(p);
          if (prototypes.length > 20) throw Error("Unexpected prototype depth");
        }
        return [name, { own: descriptors(value, value), prototypes }];
      }),
  );
}
(async () => {
  const mode = process.argv[2];
  const root =
    mode === "baseline"
      ? localRequire(process.argv[3])
      : mode === "esm"
        ? await import("edinet-ts")
        : localRequire("edinet-ts");
  const names = Object.keys(root).sort();
  const typeofByName = Object.fromEntries(names.map((name) => [name, typeof root[name]]));
  const facades = {};
  if (mode !== "baseline")
    for (const name of ["core", "financial", "disclosures", "companies", "platform", "registry"]) {
      const value =
        mode === "esm" ? await import("edinet-ts/" + name) : localRequire("edinet-ts/" + name);
      facades[name] = Object.keys(value).sort();
      for (const key of facades[name])
        if (!Object.is(value[key], root[key]))
          throw Error("Subpath identity differs: " + name + "/" + key);
    }
  console.log(
    JSON.stringify({
      names,
      typeofByName,
      signatures: Object.fromEntries(
        Object.entries(signatures(root)).map(([name, signature]) => [
          name,
          createHash("sha256").update(JSON.stringify(signature)).digest("hex"),
        ]),
      ),
      facades,
      databaseConstructors,
      networkRequests,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
