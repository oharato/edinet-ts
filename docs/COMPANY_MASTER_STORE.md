# 企業マスター観測の永続保存

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
- `history(sourceUrl)` は検査した全観測の来歴・行数・snapshot hashを返し、`snapshot(id)` は完全な観測を返します。`compare(previousId,currentId)` は既存の[観測差分](COMPANY_MASTER_CHANGES.md)を再現します。フィルタや同一証券コードだけで別EDINET IDを統合しません。
- 本文とSHA-256、本文/索引の一致、検索前の全観測の時点索引を検査します。SHAは内部整合の検査で、外部署名や原CSVとの再照合ではありません。検索対象として選ばれない観測の本文検査は `history()` 等で明示できます。
- `{readOnly:true}` は専用DBの固定した私有コピーを読みます。通常ファイル・固定schemaだけを受け入れ、リンク・副ファイル・未知のDB形式を拒否します。読み取りで元DBを書き換えません。

1観測は最大100,000行・正規化JSONで64MiBです。`put()` の既存内容検査と `history()` は観測本文を一観測ずつ走査し、全本文を同時にメモリへ保持しません。日次巡回・CLI・世代削除・圧縮・法的履歴/法人記録との一体保存は残工程です。

## 検証

公式マスターの2026-10-27/29の2観測・合計22,865行を別々の専用DBへ保存・再openし、8検索と全9差分がsource/built/CommonJS・独立Python/SQLite処理で一致。全本文・hash・観測ID・索引列と元ファイル不変を確認しました。原CSVの再取得や法的イベントの検証ではありません。

全139ファイル/3,757テスト、型・build・公開NodeNext型が成功。履歴の本文保持量を一観測に制限する8件目の試験を加えるため初回の全回帰を停止し、修正後に全件を再実行した結果です。固定配布物53eb2adより後のローカル実装で、配布・利用先反映は残工程です。

後続の評価指標実装時に、初回配布型の推論で`import("..")`が残る不具合を検出しました。共通ビルド後処理を修正し、ビルド後の全141ファイル/3,786テストと、`--types node`を明示して型定義の検査を省略しないNodeNext検査で解消を確認しました。以前の公開型検査は型定義検査の省略を含んでいたため、この問題を見逃していました。
