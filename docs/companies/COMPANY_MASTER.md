# 企業マスターの観測保存と差分

企業コードリストを取得時点ごとに保存し、以前の一覧から何が変わったかを調べます。会社名の変更が観測できても、その変更が法的に発生した日までは分かりません。

## 保存と比較の流れ

```mermaid
flowchart LR
    CSV[完全なコードリスト] --> Store[観測として追記保存]
    Store --> Query[基準日と観測時点で選択]
    Store --> Pair[2つの観測を指定]
    Pair --> Diff[追加・不在・属性変更を比較]
```

- [企業マスター観測の永続保存](#store)
- [企業マスター間の観測差分](#changes)
- [業種・企業属性による財務検索](#financial-screening)
- [業種ごとの財務比較](#industry-comparison)

各節のAPI・入力条件は区別します。検証件数と配布物の記録は実施当時のもので、現在の全体検証や稼働状態を示しません。

<a id="store"></a>

## 企業マスター観測の永続保存

`CompanyMasterStore` は、完全なコードリストの観測を専用SQLiteへ追記保存します。既存の財務DBやメタデータDBとは別形式です。会社ごとの法的イベント履歴や発生日の再構成とは区別します。

```ts
import {CompanyMasterStore} from 'edinet-ts';
const store = new CompanyMasterStore('company-master.sqlite');
try {
  const saved = store.put(snapshot); // fetchEdinetCompanyMaster()等の完全な観測
  const result = store.query({
    sourceUrl: snapshot.sourceUrl,
    asOf: '2026-10-29',
    knownAt: '2026-10-30T00:00:00Z',
    listingStatus: 'listed',
    industry: '建設業',
  });
  const observations = store.history(snapshot.sourceUrl);
  const original = store.snapshot(saved.observation.id);
} finally { store.close(); }
```

- `put()` は会社の安定EDINET IDと全属性、CSV/ZIPのhash・出典URL・基準日・観測時刻を保持します。原CSV/ZIPのbyte列は別途保存してください。時刻は同じ瞬間をUTC ISO表記に正規化し、会社行はEDINETコード順に保存します。
- 同じ出典・基準日・観測瞬間を観測IDとします。同内容の再投入は `unchanged`、異なる内容は競合で停止します。同じCSV hashを異なる基準日/会社集合へ付け替えることも拒否します。訂正は別の観測として保存し、過去の内容を上書きしません。
- `query()` は出典を明示し、as-ofと観測cutoffの両方を満たす最新の完全リストを選びます。既存の `queryCompanyMaster()` と同じ検索規則・返値で、将来観測の属性を過去へ遡及しません。
- `history(sourceUrl)` は検査した全観測の来歴・行数・snapshot hashを返し、`snapshot(id)` は完全な観測を返します。`compare(previousId,currentId)` は既存の[観測差分](COMPANY_MASTER.md#changes)を再現します。フィルタや同一証券コードだけで別EDINET IDを統合しません。
- 本文とSHA-256、本文/索引の一致、検索前の全観測の時点索引を検査します。SHAは内部整合の検査で、外部署名や原CSVとの再照合ではありません。検索対象として選ばれない観測の本文検査は `history()` 等で明示できます。
- `{readOnly:true}` は専用DBの固定した私有コピーを読みます。通常ファイル・固定schemaだけを受け入れ、リンク・副ファイル・未知のDB形式を拒否します。読み取りで元DBを書き換えません。

1観測は最大100,000行・正規化JSONで64MiBです。`put()` の既存内容検査と `history()` は観測本文を一観測ずつ走査し、全本文を同時にメモリへ保持しません。日次巡回・CLI・世代削除・圧縮・法的履歴/法人記録との一体保存は残工程です。

<a id="store-検証"></a>

<a id="検証"></a>

### 実施した検証と確認範囲

> 以下は各検証を実施した時点の記録です。件数・配布先・未確認範囲を含めて読み、現在の稼働状態とは分けてください。

公式マスターの2026-10-27/29の2観測・合計22,865行を別々の専用DBへ保存・再読込し、8検索と全9差分がsource/built/CommonJS・独立Python/SQLite処理で一致。全本文・hash・観測ID・索引列と元ファイル不変を確認しました。原CSVの再取得や法的イベントの検証ではありません。

全139ファイル/3,757テスト、型・build・公開NodeNext型が成功。履歴の本文保持量を一観測に制限する8件目の試験を加えるため初回の全回帰を停止し、修正後に全件を再実行した結果です。固定配布物3cc4618と利用先のvendorへ反映済みです。利用先での履歴保存・表示運用は残工程です。

後続の評価指標実装時に、初回配布型の推論で`import("..")`が残る不具合を検出しました。共通ビルド後処理を修正し、ビルド後の全141ファイル/3,786テストと、`--types node`を明示して型定義の検査を省略しないNodeNext検査で解消を確認しました。以前の公開型検査は型定義検査の省略を含んでいたため、この問題を見逃していました。

<a id="changes"></a>

## 企業マスター間の観測差分

`compareCompanyMasterSnapshots(previous, current)` は、完全なEDINETコードリスト二つを検査し、EDINETコード順の差分を返します。既存の `queryCompanyMaster` の入力検査を共有し、入力を固定してから比較します。

- `record-added`: 前のリストにない行。
- `record-absent`: 次のリストにない行。上場廃止や法人消滅とは断定しません。
- `attributes-changed`: 証券コード、法人番号、名称、提出者種別、上場区分、業種、決算日原文/月の変化。

各行はEDINET安定ID、変更属性、変更前後の行を持ち、結果は両snapshotの基準日・実観測時刻・出典URL/hashを保持します。`dateMeaning: "snapshot-boundaries"` は観測の両端です。

改称・上廃・合併等の正確な発生日や法人同一性を認定する情報ではありません。証券コードの再利用によって別EDINETコードを結合しません。

同じ出典URL、基準日と実観測時刻の昇順が必要です。同一時点で異なるhash、同一hashで異なる行/基準日は拒否します。同じ基準日に後から観測した訂正リストは比較でき、同じ観測の再投入は空の差分です。行順や属性のキー順だけの差は変更にしません。出典hashは呼出元の宣言であり、このAPIは元CSVの真正性を認証しません。

市場区分、法的イベントの一次出典、別EDINETコード間の法人結合は後続工程です。観測のDB保存は[Store](#store)を使います。

実観測の確認: 2026-10-27基準の11,433行と、公式URLから再取得した2026-10-29基準の11,432行を比較し、追加3・消失4・属性変更2の計9件を確認。全行を別のPython処理で比較した差分と両端の出典が一致し、source/buildの出力も完全一致しました。

上場区分の行数は3,813→3,812ですが、この差を特定日の上廃数と読み替えません。進行中の財務取得jobは元の3,813社を固定した計画として維持しています。

検証: 全134ファイル/3,651テスト・本体型検査・build・配布用NodeNext型使用例・CommonJSの実9差分が成功。既存のCSV/保存snapshot/knownAt検査が存在しない暦日（例: 2026-02-30）をDate.parseで補正していた不具合も修正し、分単位の有効な時刻の受入れは維持しました。

この追加は53eb2adより後に実装し、現在の固定配布物3cc4618へ反映済みです。

完全な観測の永続保存・再読込検索・観測ID指定の差分は[企業マスター観測Store](COMPANY_MASTER.md#store)を利用できます。法的イベントの日付確定は引き続き対象外です。

<a id="financial-screening"></a>

## 業種・企業属性による財務検索

`screenCompanyFinancials()` は、保存済み財務索引を業種や上場区分で絞り込みます。企業マスターと財務行をEDINETコードで結合し、企業条件に合う行を選んでからページを切ります。

```mermaid
flowchart LR
    G[固定した財務世代] --> C[財務世代のcutoff]
    C --> M[基準日・cutoffを満たす完全マスター]
    G --> F[同一基準・期間の財務検索]
    M --> J[EDINETコードで結合]
    F --> J
    J --> A[企業条件で絞る]
    A --> P[件数集計・ページ指定]
```

```ts
import {screenCompanyFinancials} from 'edinet-ts';

const result = screenCompanyFinancials('financial-index.sqlite', snapshots, {
  cohort, // generation/group/standard/scope/currency/period/periodType
  company: {
    asOf: '2026-10-29',
    listingStatus: 'listed',
    industry: '建設業',
  },
  search: {
    metricIds: ['costOfSales'],
    conditions: [{metric: 'costOfSales', operator: 'gte', value: 0}],
    sortBy: 'costOfSales', order: 'desc', offset: 0, limit: 20,
  },
});
```

`snapshots` は `CompanyMasterSnapshot` の配列です。`cohort` と保存済み指標の指定方法は[財務検索索引](../pipeline/FINANCIAL_INDEX_BUILD.md)を参照してください。

### 時点と件数の読み方

- `company.knownAt` は指定できません。財務世代の `selection.cutoff` を使い、それより後に取得した企業情報を過去へ遡及しません。`asOf` はマスターの基準日の上限です。
- 業種は公式CSVの原表記で完全一致します。証券コードが同じでもEDINETコードが異なる会社とは結合しません。
- `rows` は企業条件・財務条件を満たすページです。各行の `company` と `financial` に、企業属性と保存財務行を分けて返します。`total` はページ指定前の一致行数です。
- `master.total` は企業条件に合うマスター行数です。対象期間の財務提出義務や収録状況を表す分母ではありません。
- `diagnostics` は対象企業の財務診断、`excludedRows` は必須項目の診断がある書類の重複なし件数です。欠損を0へ置き換えません。
- 適格なマスター観測がなければ `master.status: "unavailable"` と空の結果を返します。適格なマスターがあるものの条件一致が0社の場合とは区別できます。
- `indexSha256`・`generationSha256` とマスターの出典・hash・観測時刻を返します。readOnly私有コピーを検査して読み、元索引を書き換えません。

同一時点の異なるマスター内容や、同じ出典CSV hashを別の基準日・会社集合へ付け替えた入力は拒否します。行順だけの差や同じCSVの後日の再観測は受け入れます。この検査は宣言間の整合確認であり、原CSVの真正性の認証ではありません。

### CLIで使う

既存の `screen-financial-index` に、次の二つを両方指定します。

```sh
edinet-ts screen-financial-index \
  --db financial-index.sqlite --cohort cohort.json \
  --metrics costOfSales --sort-by costOfSales --order desc \
  --company-master snapshots.json --company-query company-query.json \
  --offset 0 --limit 20 --pretty
```

`snapshots.json` は完全観測の配列JSON（64MiB以下）、`company-query.json` は上の `company` オブジェクトです。片方だけの指定は拒否します。両方を省略すると従来の財務検索です。

### 確認した範囲と残り

Node 26.12.1の隔離コピーで全161ファイル・4,303テスト、build・公開型を検証しました。同一時点の競合、入力の途中変化、将来観測、コード再利用、企業絞込後のページ指定、欠損診断、J-GAAP/IFRSのBSとCLIを含みます。

保存済み実データでは、2026-10-29基準の上場・建設業150社から、J-GAAP連結・2025-04-01〜2026-03-31の売上原価76行を検索しました。全76値を別のPython/SQLite/XML処理で原本のhash・context・単位・原値と照合し、必須項目非採用16書類とページ指定も一致しました。後から取得した2026-10-30基準の公式マスターを追加しても、以前の財務cutoffでの選択と結果は不変でした。

これは一業種・一期間・一指標の検証です。全市場の充足率保証やPDF金額照合ではありません。市場区分・法的イベント履歴・業種統計・通貨換算は残工程で、保存財務値の再抽出や未検証値の公開昇格は行いません。

<a id="industry-comparison"></a>

## 業種ごとの財務比較

`compareCompanyFinancialsByIndustry()` は、指定した指標が**すべて利用可能な共通企業集合**について、業種別の最小・最大・合計・平均・中央値を返します。指標ごとに別の企業集合を使った平均ではありません。

```ts
import {compareCompanyFinancialsByIndustry} from 'edinet-ts';

const comparison = compareCompanyFinancialsByIndustry('financial-index.sqlite', snapshots, {
  cohort, // 同一世代・会計基準・連結範囲・通貨・期間
  company: {asOf: '2026-10-29', listingStatus: 'listed'},
  metricIds: ['costOfSales', 'sellingGeneralAndAdministrativeExpenses'],
});

for (const group of comparison.industries) {
  console.log(group.industry, group.usableCompanies, group.metrics);
}
```

`sample: "complete-case"` は共通採用集合であることを示します。全体の `metricIds` に要求指標を返し、`rows` と `diagnostics` に計算根拠を残します。企業情報の時点選択・EDINETコードによる結合・索引のreadOnly検査は[財務検索](#financial-screening)と共通です。

### 集計対象を確認する

各業種の件数は次の意味です。業種の空欄・未記録は `industry: null` にまとめます。

| フィールド | 意味 |
|---|---|
| `masterCompanies` | 企業条件に合うマスター企業数 |
| `usableCompanies` | 同じ財務cohortで全要求指標を採用できた企業数 |
| `excludedCompanies` | 必須指標の欠損・曖昧・非対応・unsafe-numberで除外した企業数。複数の欠損を一社として数える |
| `unrepresentedCompanies` | 上の採用・除外のいずれにも該当する財務記録がない企業数 |

このAPIでは数値条件やページ指定を受け付けません。先に数値で絞った標本や先頭ページだけで、業種全体の平均を計算することを防ぎます。`company` の業種・決算月・上場区分等による母集団の絞込はできます。

`unrepresentedCompanies` は未開示や解析失敗の確定分類ではありません。会計基準・期間が違う会社、原本未保存、選択未解決なども含み得ます。したがって `usableCompanies / masterCompanies` を対象年度の開示充足率とは扱いません。

### 平均と中央値の表現

各 `metrics` 要素は指標名・採用数と統計値を持ちます。合計・平均・中央値は `{numerator, denominator}` の十進整数文字列による分数です。たとえば0.1と0.2の平均は `{"numerator":"3","denominator":"20"}` となります。合計が安全整数範囲を超えても、途中でnumberへ丸めません。元の報告精度が上がるという意味ではありません。

採用企業が0社の業種では `metrics: []` を返します。平均0とは区別してください。採用企業が1社なら、その会社の値が平均・中央値です。中央値は昇順の中央値、偶数社なら中央2値の算術平均です。負値・0も採用値として計算に含めます。

### CLI

```sh
edinet-ts compare-financial-industries \
  --db financial-index.sqlite --cohort cohort.json \
  --metrics costOfSales,sellingGeneralAndAdministrativeExpenses \
  --company-master snapshots.json --company-query company-query.json --pretty
```

`company-query.json` に `knownAt` は指定せず、財務世代のcutoffを使います。原本の再取得・再抽出や通貨換算は行いません。異なる基準・期間・scope・指標の意味差を埋めた業種比較は別の工程です。

### DuckDB候補で使う

検査済みの検索DuckDBにも同じ企業結合・業種比較を適用できます。`screenDuckCompanyFinancials()` / `compareDuckCompanyFinancialsByIndustry()` は同期版と同じ入力・返却形で、私有snapshotの全体監査後に非同期で読みます。

```sh
edinet-ts screen-duck-financial-index \
  --db financial-index.duckdb --cohort cohort.json --metrics costOfSales \
  --company-master snapshots.json --company-query company-query.json --pretty

edinet-ts compare-duck-financial-industries \
  --db financial-index.duckdb --cohort cohort.json --metrics costOfSales \
  --company-master snapshots.json --company-query company-query.json --pretty
```

DuckDBの世代指紋は構築計画に解析済みStore指紋を含むため、同じ財務値のSQLite世代とは `generationSha256` が一致しない場合があります。企業結合・`total`・`excludedRows`・診断・統計値の一致を比較し、物理ファイルhashの一致は要求しません。

実原本検証では、上場マスター3,812社・34業種について、同一期の売上原価をJ-GAAPとIFRSで分けて比較しました。採用はJ-GAAP 1,556社・IFRS 144社、必須指標非採用はそれぞれ208社・32社です。独立Python/SQLite/Fraction処理で企業の結合・業種別件数・全統計が一致し、採用1,700値を元XMLのhash・context・namespace・原値・報告精度・JPY単位まで照合しました。CLIもAPIと一致し、元索引は不変です。全期間・全指標やPDFの照合ではなく、旧完成候補を使ったこの比較の検証です。公開世代は変更していません。

追加で、固定736ソースのSDKと実2社の同一年度・J-GAAP連結原本を使い、複数指標の共通集合を確認しました。売上原価・販管費・売上総利益では2社を採用し、長期借入金返済CFを加えると1社採用・欠損1社除外になります。建設業マスター200社の未収録198社は欠損除外と区別し、上場限定150社では1社採用・未収録149社を保持しました。3検索・10指標統計・返却13値が独立XML/Fraction計算と一致し、原本・固定runtimeは不変、通信0です。取得時刻が不明な原本を含むため、実行時に原本を検証した時刻を隔離索引の利用可能時刻の上限として使い、当初取得時刻・過去時点の利用可能性を認証していません。小索引98,304 bytesは検証後に削除しました。証跡は `data/roadmap/industry-multimetric-real-20261031/summary.json`。全市場・全指標の検証や公開世代の切替とは区別します。
