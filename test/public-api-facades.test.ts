import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";
import { ts } from "ts-morph";
const root = resolve(__dirname, "..");
const baseline = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/public-api-baseline.json"), "utf8"),
) as {
  name: string;
  facade: string;
  type: boolean;
  runtimeType: string | null;
  leaf: string;
  importedName: string;
}[];
const entries = {
  core: "src/core/index.ts",
  financial: "src/domain/financial/index.ts",
  disclosures: "src/domain/disclosures/index.ts",
  companies: "src/domain/companies/index.ts",
  platform: "src/platform/index.ts",
  registry: "src/platform/registry/index.ts",
};
it("旧740名を一意に分割し、元の宣言・型空間を保持して内部名を増やさない", () => {
  const program = ts.createProgram([resolve(root, "src/index.ts")], {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: ["node"],
  });
  const checker = program.getTypeChecker();
  const exportsOf = (file: string) => {
    const source = program.getSourceFile(resolve(root, file));
    expect(source, file).toBeDefined();
    const symbol = checker.getSymbolAtLocation(source!);
    expect(symbol, file).toBeDefined();
    return checker.getExportsOfModule(symbol!);
  };
  const target = (s: ts.Symbol) =>
    s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
  const publicExports = exportsOf("src/index.ts");
  expect(publicExports.map((s) => s.name).sort()).toEqual(baseline.map((e) => e.name).sort());
  expect(baseline).toHaveLength(740);
  for (const item of baseline) {
    const actual = target(publicExports.find((s) => s.name === item.name)!);
    const original = target(exportsOf(item.leaf).find((s) => s.name === item.importedName)!);
    expect(actual, item.name).toBe(original);
    expect(!!(actual.flags & ts.SymbolFlags.Type), item.name).toBe(item.type);
  }
  for (const [facade, file] of Object.entries(entries))
    expect(
      exportsOf(file)
        .map((s) => s.name)
        .sort(),
    ).toEqual(
      baseline
        .filter((e) => e.facade === facade)
        .map((e) => e.name)
        .sort(),
    );
  const source = program.getSourceFile(resolve(root, "src/index.ts"))!;
  expect(source.statements).toHaveLength(6);
  expect(source.statements.every((s) => ts.isExportDeclaration(s) && !s.exportClause)).toBe(true);
}, 30000);
it("既存package入口とCLIを保ち、6つのsubpathだけを追加する", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  expect(pkg.exports["."]).toEqual({
    import: "./dist/index.js",
    require: "./dist/index.js",
    types: "./dist/index.d.ts",
  });
  expect(pkg.main).toBe("dist/index.js");
  expect(pkg.types).toBe("dist/index.d.ts");
  expect(pkg.bin).toEqual({ "edinet-ts": "dist/cli.js" });
  expect(Object.keys(pkg.exports).sort()).toEqual(
    [".", ...Object.keys(entries).map((n) => "./" + n)].sort(),
  );
  for (const [name, file] of Object.entries(entries)) {
    const entry = "./" + file.replace(/^src\//, "dist/").replace(/\.ts$/, "");
    expect(pkg.exports["./" + name]).toEqual({
      types: entry + ".d.ts",
      import: entry + ".js",
      require: entry + ".js",
    });
  }
});
const runtime = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/public-api-runtime-baseline.json"), "utf8"),
);
it.each(["esm", "cjs"])(
  "%sのroot/subpathで旧258値・typeof・prototypeと同一性を保つ",
  (mode) => {
    const actual = JSON.parse(
      execFileSync(
        process.execPath,
        [resolve(__dirname, "fixtures/public-api-runtime.cjs"), mode],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 2 * 1024 * 1024,
        },
      ),
    );
    expect(actual.names).toEqual(runtime.names);
    expect(actual.names).toHaveLength(258);
    expect(actual.typeofByName).toEqual(runtime.typeofByName);
    expect(actual.signatures).toEqual(runtime.signatures);
    expect(actual.databaseConstructors).toBe(0);
    expect(actual.networkRequests).toBe(0);
    for (const name of Object.keys(entries))
      expect(actual.facades[name]).toEqual(
        baseline
          .filter((e) => e.facade === name && e.runtimeType !== null)
          .map((e) => e.name)
          .sort(),
      );
  },
  30000,
);
it("NodeNextで配布宣言のroot/subpathを利用できる", () => {
  const require = createRequire(import.meta.url);
  const compiler = resolve(dirname(require.resolve("typescript/package.json")), "bin/tsc");
  execFileSync(
    process.execPath,
    [compiler, "--project", "test/types/tsconfig.public-facades.json"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}, 30000);
