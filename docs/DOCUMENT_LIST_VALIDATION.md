# 書類一覧 API の応答境界

## 目的と背景

EDINET API v2 は `docInfoEditStatus` を `"0"` / `"1"` / `"2"` の文字列で返します。従来の公開型と `findLatest()` / `downloadByTicker()` の選択条件は数値だったため、通常の `"0"` の書類が見つからないことがありました。型アサーションは実行時の型を変換しません。

## 設計と互換性

- `search()` で JSON を `unknown` として受け取り、検証してから結果を公開します。
- `docInfoEditStatus` だけを数値 `0` / `1` / `2` に正規化します。数値入力も許容し、既存の公開 `number` 型と呼び出し側の `=== 0` を維持します。以前の未検証の実行時文字列に依存していた利用者は数値比較に変更してください。
- `null`、空文字、真偽値、未知の区分を `0` に変換しません。不正な区分はエラーにします。
- `secCode`、`docTypeCode`、`docDescription` は `string | null`、任意の提出者・提出日時等も nullable とします。非上場提出者や取下げ済み書類の正当な `null` を欠損エラーにしません。TypeScript でこれらの文字列操作をする利用者には null チェックが必要です。
- `EdinetListResponse.metadata` の公開型も仕様に合わせ、存在しない必須 `date` の代わりに `processDateTime` / `status` / `message` を宣言します。この型を手作りしていた利用者は応答形状の更新が必要です。`EdinetListResponse.results` は区分正規化後の `EdinetDocument[]` として扱います。
- 未知の追加項目は保持し、入力オブジェクト自体を書き換えません。
- HTTP 成功でもトップレベルの `statusCode` または `metadata.status` が失敗ならエラーにします。
- `metadata.status`、結果配列、非負の整数件数と配列長の一致、書類識別子と公開する主要フィールドを検証します。不正レコードを捨てて部分的成功にしたり、不正応答を空配列にしたりしません。正しい 0 件応答は `results: []`、件数 `0` です。
- タイトルやパラメータなど、検索処理が使用しない metadata の全項目までは検証しません。未知の追加項目の意味も保証しません。

## 選択条件と今回の範囲

`findLatest()` と `downloadByTicker()` は正規化後の区分 `0` を従来どおり選びます。この区分は財務局職員による「書類情報の修正」であり、訂正報告書の分類ではありません。区分 `2` の修正済み書類の採用方針、取下げ・不開示・XBRL有無の包括的な選択、検索期間・タイムゾーン・DB保存形式の変更は本修正に含めません。

`searchPeriod()` / `findLatest()` は従来どおり日別検索エラーを警告して次の日へ進むため、これらの集約結果から全日の成功を保証することはできません。厳密に成功と失敗を区別したい場合は `search()` の例外を扱ってください。

## 検証と限界

回帰テストは合成した API 応答を fetch のモックに渡し、両検索ヘルパーを `search()` 経由で検証します。文字列・数値区分、nullable レコード、絞り込み、HTTP 200 のエラー JSON、不正構造・不一致件数・不正区分を対象にします。実 API、API キー、利用者のデータベースは使用していません。稼働中サービスの実応答との独立照合は未実施です。

## 参照

- [金融庁 EDINET API 仕様書 Version 2](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/download/ESE140206.pdf): 3-1-2-2 の出力項目・0件例、3-1-5 の取下げ時 null、3-1-6 の書類情報修正、3-3 のエラー形式（2026-10-07 確認）。
- [過去の PR #14](https://github.com/oharato/edinet-ts/pull/14): 類似の型不一致修正を含みますが closed / unmerged です。本修正は境界での数値正規化を選び、同 PR の他の変更は取り込みません。

## 通知書010と有価証券届出書030の指定

**書類種別コード**は、通知書・有価証券報告書などの種類を表す3桁の番号です。**様式コード**は提出様式を表す別の6桁の番号で、同じものではありません。金融庁の[API仕様書v2・2026年6月版、印刷p88（PDF93枚目）](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/download/ESE140206.pdf#page=93)で、010は通知書、030は有価証券届出書、040は訂正有価証券届出書と確認しました。

| 読みたい種類 | 新しい定数 | CLIの明示指定 |
|---|---|---|
| 通知書010 | `EdinetDocumentType.SecuritiesNotice` | `--type securities-notice` または `--type 010` |
| 有価証券届出書030 | `EdinetDocumentType.RegistrationStatement` | `--type registration-statement` または `--type 030` |
| 訂正有価証券届出書040 | 既存の `AmendedSecuritiesRegistrationStatement` | 既存の `--type amended` または `--type 040` |

旧 `SecuritiesRegistrationStatement` は名前と値が食い違っていました。互換性を保つため値は010のままにし、非推奨（新しいコードでは使わない）としています。CLIの旧 `registration` も010のままです。届出書には新しい定数・明示指定を使ってください。これまで未登録だった `--type 030` は有報120へ戻っていましたが、今回から正しく030で絞り込みます。

```ts
import { EdinetDocumentType } from 'edinet-ts';
const notice = EdinetDocumentType.SecuritiesNotice; // 010
const registration = EdinetDocumentType.RegistrationStatement; // 030
```

`download` と `get` は共通の変換を使います。既定値Annual/120と、それ以外の既存aliasは維持します。**未知の指定が120へ戻る従来の挙動も残るため、入力値の検証機能ではありません。** 誤取得を避けるため、上表の明示名かコードを使ってください。コードの追加は原本の取得可能性、XBRL有無や解析成功を保証しません。

この確認は定数・CLI変換と合成API応答の絞り込みによるものです。実API・DB・キャッシュ・認証設定は使いません。大量保有関係の食い違いは、後記のとおり別途確認して是正しました。

## 大量保有関係の書類種別コード

同じAPI仕様書の書類種別コード表で、330は別途買付け禁止の特例を受けるための申出書、340はその訂正、350は大量保有報告書、360は訂正大量保有報告書、370は基準日の届出書、380は変更の届出書です。大量保有の**変更報告書に独立した種別コードはありません**。公開されている実API応答でも、変更報告書は様式コード010002・種別コード350・書類名「変更報告書」で記録されており（2025-05-19提出分 docID S100VRDA）、2026年10月の実データでも同じ形でした。初回と変更の区別は様式コード（大量保有報告書は末尾000、変更報告書は末尾002）と書類名で行います。380の変更の届出書は基準日の届出書に対する変更であり、大量保有の変更報告書ではありません。

| 読みたい種類 | 定数 | CLIの指定 |
|---|---|---|
| 別途買付け禁止の特例を受けるための申出書330 | `EdinetDocumentType.SeparatePurchaseProhibitionException` | `--type 330` |
| 訂正別途買付け禁止の特例を受けるための申出書340 | `EdinetDocumentType.AmendedSeparatePurchaseProhibitionException` | `--type 340` |
| 大量保有報告書350（変更報告書を含む） | `EdinetDocumentType.LargeShareholdingReport` | `--type largeshareholding` または `--type 350` |
| 訂正大量保有報告書360 | 既存の `EdinetDocumentType.CorrectionReport` | `--type correction` または `--type 360` |
| 基準日の届出書370 | `EdinetDocumentType.RecordDateNotification` | `--type 370` |
| 変更の届出書380 | `EdinetDocumentType.ChangeNotification` | `--type 380` |

旧定義は `LargeShareholdingReport` が340、`ChangeReport` が350でした。340は大量保有ではないため、`LargeShareholdingReport` の値を公式どおり350へ是正し、`isLargeShareholding()` とCLI `largeshareholding` の対象を350と360にしました。`ChangeReport` は値350のまま互換用の非推奨別名として残しますが、350は初回報告書も含むため、CLIの旧 `change` も350全体を返します。`--type 340` は今後、訂正別途買付け申出書を指します。

実APIでの継続確認用に、手動実行専用の GitHub Actions `Live EDINET smoke`（`.github/workflows/live-smoke.yml`）を用意しました。`EDINET_API_KEY` secretがある環境で、書類一覧を対象日1回だけ取得し、350・360・340の書類名と様式コードの対応を検証します。自動テストは合成応答によるもので、実API確認はこの手動ワークフローの実行結果によります。
