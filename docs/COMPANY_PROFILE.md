# 原本に書かれた会社情報を確認する

状態: main `d9c657f`（#39統合後）を基準に追加するAPI/CLI。2026-10-24更新。未リリース。

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
