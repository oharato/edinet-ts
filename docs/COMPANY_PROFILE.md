# 原本に書かれた会社情報を確認する

状態: #40でmainへ統合済みのAPI/CLI。2026-10-24更新。未リリース。

保存済みXBRLを1つ指定すると、会社名・企業コード・会計基準名・当期の開始日と終了日を、元の記載と出典付きで読み取れます。会社の名前やコードを数値へ変えず、欠けた項目を空文字や0で埋めません。既存の`getCommonMetadata()`や財務のAPIは変更しません。

これは企業マスター全体の完成ではありません。業種・市場区分・上場状態・名称変更履歴、複数書類から最新の会社情報を選ぶ機能は含みません。会社を自動的に結び付けたり、会計基準名を財務抽出の設定へ変換したりしません。

## 読み取る6項目

DEIは、提出会社や書類の基本情報に付けられたXBRLの項目群です。`jpdei_cor`の正式URI形式を確認し、次のタグだけを使います。

| `CompanyProfileFieldId`定数 | ID | 元のタグ | 意味 |
|---|---|---|---|
| `FilerName` | `filerName` | `FilerNameInJapaneseDEI` | 原本の日本語提出者名 |
| `EdinetCode` | `edinetCode` | `EDINETCodeDEI` | EDINETで提出者を識別するコード |
| `SecurityCode` | `securityCode` | `SecurityCodeDEI` | 原本の証券コード。英字・先頭0も文字列のまま |
| `AccountingStandard` | `accountingStandard` | `AccountingStandardsDEI` | 原本の会計基準名。例:`Japan GAAP` |
| `FiscalYearStartDate` | `fiscalYearStartDate` | `CurrentFiscalYearStartDateDEI` | 当期の開始日 |
| `FiscalYearEndDate` | `fiscalYearEndDate` | `CurrentFiscalYearEndDateDEI` | 当期の終了日 |

会計基準の文字列が読めても、ライブラリの財務抽出がその基準へ対応している証明にはなりません。名称・コードの文字列は採用元の記載であり、コード制度の有効性や他資料との同一性まで認証するものではありません。非上場を示す表記など、`-`が書かれていても原文として保持し、上場企業の有効コードへ変換しません。日付は実在する`YYYY-MM-DD`を検査します。

## API

```ts
import { createCompanyProfile, CompanyProfileFieldId } from "edinet-ts";

const profile = createCompanyProfile(xml, "SYNTHETIC1");
const name = profile.fields[CompanyProfileFieldId.FilerName];
if (name.status === "selected") {
    console.log(name.raw, name.source);
}
console.log(profile.consistency);
```

書類IDは合成例です。`docID`は利用者が原本との対応を確認して渡す値で、原本の中から正しさを証明した値ではありません。空・空白・制御文字を含むIDは拒否します。XMLの構文を検査し、DOCTYPEは対象外にします。XMLスキーマや正式taxonomy定義全体の検証ではありません。

既に解析したObjectでは`object.getCompanyProfile()`を使えます。この場合、パーサーへ渡した書類IDを返します。Objectは元のXMLを保存しないため`sourceXmlHash`はありません。原本文字列の指紋も必要な場合は`createCompanyProfile()`を使ってください。

返値には次の情報があります。

- `fields`: 各項目の採用結果。`selected`ならパース済みの原文字列`raw`と採用元`source`、それ以外なら`missing`（欠損）/`unsupported`（扱えない）/`ambiguous`（候補が曖昧）と理由を返します。探索した候補は`evidence`へ残します。
- `source` / `evidence`: 書類ID、元タグ、名前空間URI、context、entity（XBRLの対象会社識別）、対象日、原文字列など。`context`は値がどの対象に属するか示す指定です。
- `consistency`: 6項目が揃い、採用項目のentityと対象日が一致し、当期の開始/終了が逆転していなければ`consistent`。矛盾があれば`inconsistent`と診断、矛盾はなくても項目が不足すれば`incomplete`です。
- `selectionVersion`: 選択ルールの版。現在は`"1"`です。
- `sourceXmlHash`: `createCompanyProfile()`へ渡した**XML文字列**のUTF-8 SHA-256。ファイルの元バイト列や原本の真正性を保証する値ではありません。CLIでは正しいUTF-8を読み、BOM（ファイル先頭の文字コードの印）も保持して計算します。原本の配布元や真正性を検証した意味ではありません。

整合性に矛盾があっても個々の原記載は消しません。会社を識別したり日付を利用したりする前に、項目の状態と`consistency`を確認してください。`consistent`は入力内の上記条件が揃った意味で、全情報の正しさの保証ではありません。

## 採用しないケース

同じタグの候補が複数なら、同じ文字列でも先頭を選ばず曖昧とします。未知URI、存在しない/重複したcontext、期間集計のcontext、不正日付、余分な次元、原本全体のcontextに複数・不明entity、文字列項目への単位指定も採用しません。nilや読めた空白だけの文字列は欠損です。空要素・複合内容などで既存パーサーが原文字列を保持しない場合は、推測せず`unsupported/raw-unavailable`とします。別のタグや会社名からコードを補いません。

DEIのcontextが示す提出時点と、当期開始日・終了日として書かれた値は別です。context名が`FilingDateInstant`であることだけに頼らず、日付と構造を検査します。財務の期末を提出日だと解釈したり、日付だけから提出時刻を作ったりしません。複数書類の提出時点選択や履歴管理は後続の計画です。

## CLI

```sh
npm run build
node dist/cli.js company-profile --file /tmp/local-source/source.xbrl --doc-id SYNTHETIC1 --pretty
```

明示した通常ファイル1件だけを読みます。UTF-8、64MiB以下で、リンクは解決先の通常ファイルを読み、ディレクトリや特殊ファイルは拒否します。取得・DB更新・フォルダ探索は行いません。解析できればJSONと終了0を返しますが、項目の採用成功は返値の状態を確認してください。ファイル・XML・IDが不正ならstderrと終了1です。

## 確認範囲と残ること

合成fixtureで6項目・原文字列・コードの英字と先頭0・namespace別名・欠損/nil/同値重複・context/次元/entity・整合性・日付・CLI・原本不変を確認します。保存済み2社の2026有報では、6項目ずつ計12項目が採用され、元XMLのタグ/context/rawと一致しました。2社とも項目間の整合性を確認し、原本も不変でした。これは原本内の突合で、公式企業マスターとの独立照合、名称変更や過去提出時点の確認ではありません。

業種・市場検索へ進むには、分類の出所、コードとの対応、いつから有効か、履歴、利用・保存条件、更新手順が必要です。EDINET内の業種別規則コードを取引所の業種分類や市場区分の代わりにしません。全市場の収集・本番DB移行・性能保証は対象外です。[全体計画](plans/EDINET_TS_ROADMAP.md)の段階4を小さく進める変更です。

Node26.12.1で全933テスト（既存898＋追加35）、本体/公開API例の型検査・build・保存保護Python5件が成功しました。全体テストはCIと同じ`--maxWorkers=1`を使用し、既存の統合テストの制限時間や期待値は変更していません。lint設定はありません。

独立レビューではsource41確認・build済みESM/root/CLI42確認・CJS export1確認が成功し、未解決の必須修正はありませんでした。BOMと内部空白を含む書類IDの境界も再確認しています。

## 明示した複数社の情報を探す

この版は、会社名・コード・決算月を使う`screenCompanyDocuments()`とCLI `screen-companies`を追加します。入力は`[{xml, docID}, ...]`です。各原本から6項目すべてを採用でき、項目間の整合性も確認できた会社情報だけを検索します。名前だけ読めても、他の必要情報が欠けた行は対象外となり、理由を返します。

```ts
import { screenCompanyDocuments, CompanyProfileFieldId, CompanyProfileOperator, SortOrder } from "edinet-ts";
const result = screenCompanyDocuments(documents, {
    conditions: [{ field: CompanyProfileFieldId.FilerName,
        operator: CompanyProfileOperator.Contains, value: "合成" }],
    fiscalYearEndMonth: 3,
    sortBy: CompanyProfileFieldId.EdinetCode, order: SortOrder.Ascending,
    offset: 0, limit: 20
});
```

`CompanyProfileOperator.Equal`は原文の完全一致、`Contains`は部分一致です。6項目のいずれも文字列として比較します。正規表現、大文字小文字の同一視、全角半角の統一、証券コードの4桁から5桁への変換はしません。コードの先頭0や英字を保ちます。決算月は採用済みの当期終了日から得る月で、1〜12を指定します。過去の決算月変更を追う履歴機能ではありません。

条件はANDです。空の条件値や不明な項目・演算子、不正な月/ページ指定は設定エラーです。条件なしでは、明示集合内で採用可能なすべての行を返します。

並べ替えの既定はEDINETコードの昇順です。指定項目をJavaScriptの原文文字列比較順（UTF-16コード単位順）で比較し、同値ならEDINETコード/書類ID順で安定させます。日本語の読み・辞書順や数値順へ変換しません。日付も採用済みのISO文字列として比較します。

- `rows`は採用可能で条件に合う会社情報。原文字列・出典・XML文字列の指紋も保持します。
- `total`はページ前の条件一致件数、`excludedRows`は6項目不足/不整合の行数、`filteredRows`は採用できたが条件に合わなかった行数です。
- `diagnostics`は除外した書類ID、`incomplete`/`inconsistent`、不足項目の候補と理由、整合性の診断を返します。`reasonCounts`は項目数ではなく除外行数です。

同じdocIDは原本解析前に拒否します。採用可能な行でEDINETコードの原文またはentityが重複する場合も、条件適用前に拒否します。複数年度の同じ会社を黙って最新1件へ絞ったり、自動結合したりしません。除外済みの不完全な行は、この採用可能行の重複判定には使いません。

異なる会社の提出時点や期末が違っても、利用者が明示した企業属性の集合として検索できます。財務の比較可能性や、特定日時の会社マスターを保証するものではありません。原本の提出時刻・有効期間を推測せず、コード制度の有効性も認証しません。業種・市場・上場状態の補完はありません。

### 検索CLI

一覧JSONの例:

```json
[
  { "file": "source.xbrl", "docID": "SYNTHETIC1" }
]
```

```sh
node dist/cli.js screen-companies --manifest /tmp/local-companies/files.json --name-contains 合成 --fiscal-year-end-month 3 --pretty
node dist/cli.js screen-companies --manifest /tmp/local-companies/files.json --security-code 012A0 --sort-by filerName --order asc --limit 20
```

名称・コードは合成例です。`--edinet-code`/`--security-code`は原文完全一致、`--name-contains`は文字列部分一致です。`--conditions`にAPIと同じJSON配列も指定でき、便利なフラグで追加した条件とANDで組み合わせます。

相対fileは一覧JSONのフォルダ基準です。一覧100件/2MiB、原本1件64MiB/合計256MiBの小規模な手元検索で、通常ファイルへ解決される入力だけを読みます。UTF-8のBOMも保持します。取得・DB更新・フォルダ探索はしません。正常はJSONと終了0、設定/入力の不正や重複候補はstderrと終了1です。除外行があること自体は入力失敗とはせず、JSONの理由を確認できるようにします。性能は未測定です。

検索の検証では、保存済み2原本の12項目がPython標準XML処理で読んだ記載と一致しました。会社名/コード/月/順序/ページの12検索も別に作った期待値と一致し、原本不変を確認しました。公式企業マスターとの独立照合、過去時点の履歴、全市場の充足率を検証した意味ではありません。

Node26.12.1で全1,114テスト（既存1,055＋追加59）、本体/使用例の型検査・build・保存保護Python5件が成功しました。検査条件や既存の制限時間は変更していません。

独立レビューではsourceとbuild済み公開API/CLI各74確認、CJSルート公開が成功しました。更新文書の相対リンク98件にも欠損はありませんでした。レビューは合成入力によるものです。
