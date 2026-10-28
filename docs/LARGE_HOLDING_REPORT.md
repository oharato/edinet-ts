# 一次大量保有の直接明細と観測cutoff

`extractLargeHoldingReport`は一次大量保有XBRLから、表紙・発行者・提出者別/明示集計の保有数と比率、分母の構成値を出典付きで返します。`searchLargeHoldingReports`と`screen-large-holdings` CLIは、観測cutoff・報告義務発生日・報告全体/保有者別を指定して検索します。`LARGE_HOLDING_REPORT_VERSION`は1です。[有報本文の引用](MAJOR_SHAREHOLDER_DETAILS.md)とは別のAPIです。

## 入力と一覧メタデータ

```ts
import { extractLargeHoldingReport, searchLargeHoldingReports, LargeHoldingMetric } from "edinet-ts";
const document = {
  xml: savedXml,
  metadata: {
    docID: selected.docID, docTypeCode: selected.docTypeCode, formCode: selected.formCode,
    edinetCode: selected.edinetCode, issuerEdinetCode: selected.issuerEdinetCode,
    parentDocID: selected.parentDocID ?? undefined,
    submitDateTime: selected.submitDateTime, knownAt: snapshotKnownAt,
    coverContextRef: "FilingDateInstant",
    withdrawalStatus: selected.withdrawalStatus, disclosureStatus: selected.disclosureStatus,
    docInfoEditStatus: selected.docInfoEditStatus
  }
};
const report = extractLargeHoldingReport(document);
const result = searchLargeHoldingReports([document], {
  cutoff: observedCutoff, dutyDate: "2025-06-16", scope: "report",
  metric: LargeHoldingMetric.HoldingPercent,
  condition: { operator: "gte", value: 5 }, sort: "value-desc"
});
```

docTypeCodeは350/360に限定します。対応する原本の一覧メタデータを渡し、knownAtは原本と対応メタデータの両方が利用可能になった観測日時（各入力の観測時刻の最大）をtimezone付きで指定します。APIのtimezoneなしsubmitDateTimeは日本時間です。knownAtが提出時刻より前なら拒否します。文字列の「提出日」を、システムが実際に観測した日時へ読み替えません。今回取得した2025年提出原本のknownAtは2026年の取得時刻であり、2025年のバックテストで既知だったと偽りません。

表紙contextは次元のないinstantで、提出者entityを一覧EDINETコードと照合します。350の提出日、フォーム/表紙題名、訂正フラグを照合し、一覧状態が0/0/0以外の原本は未採用にします。metadataは呼出元の宣言であり、API応答や原本の真正性を暗号的に認証する機能ではありません。発行者名/証券コードは原タグ、発行者EDINETコードは一覧の宣言を別々に保持し、法人同一性を自動認定しません。

確認済みの標準namespaceはjplvh/2014-07-31とjpdei/2013-08-31です。表紙の第一号/第一号及び第二号様式と、確認対象フォームに限定し、未知の基準/形式からタグ名だけで推測しません。実原本では010000、010002、020002、090001を確認しました。020000は同じ表紙/タグの検査経路を持ちますが、実原本の照合は未実施です。

## 日付と訂正

| 項目 | 意味 |
|---|---|
| metadata.submitDateTime | 一覧が示す、その書類IDの提出日時 |
| metadata.knownAt | 原本を利用可能とした観測日時 |
| cover.dutyDate | XBRL表紙の報告義務発生日 |
| cover.filingDate | XBRL表紙factの提出日 |
| rows[].outstandingAsOf | BaseDate＝発行済株式等総数の基準日 |

BaseDateはPDFのV欄に対応します。報告義務発生日や保有日の別名ではなく、他の比率/保有値の時点へ流用しません。義務発生日が2025年6月17日、Vの基準日が6月20日の実例も、そのまま分けて返します。現在の保有ポジションや、全ての構成値が同じ時点であることは認定しません。

360はamendmentFlagと親番号を確認し、reportKindをcorrectionとします。添付された訂正対象XBRLでは、表紙の提出日が原報告のままの場合があります。実例は一覧の訂正提出日が6月23日、添付XBRLの提出日が6月17日で、両方を保持します。coverは添付XBRLのfactであり、訂正PDF自身の表紙と混同しません。

350の変更報告にもparentDocIDがある実例があるため、親番号があるだけで訂正とは扱いません。親番号の参照先を変更イベントとして自動合成することもしません。検索は、cutoff後の原本を除いた後で、360の親子や同じ訂正対象への競合訂正が同時指定されていれば拒否します。訂正系列の自動選択、部分訂正の値の合成、変更履歴から現在ポジションの再構成は未実装です。`reconstruction: not-performed`を保持します。

## 個別提出者・共同保有・報告合計

FilersLargeVolumeHoldersAndJointHoldersAxisのQName証跡と、提出者entityに対応する既知の独自namespace/メンバーを照合します。rowsのroleはfiler、joint-holder、reported-aggregateです。memberのnamespace/localNameと全context/次元証跡を保持し、既存財務selectorの連結/単体や次元可否とは分けて専用検査します。DTSの所属や元QName字面の認証済みとはしません。実原本で確認したのは単独提出と2名/3名の連名提出者です。独立したjoint-holderメンバーの実原本照合は残っています。

表紙の提出者及び共同保有者総数と提出形態をそのまま保持します。個別名義から別人/法人へ名寄せしたり、共同保有者を足して総数/比率を生成したりしません。原本に次元なしの集計値があればreportTotalはexplicit-aggregateを参照します。集計factがなく、総数1・保有者行1が確認できる場合だけsingle-holder-reportとしてその原行を参照します。個別と合計を二重計上しません。

name等の重複は原値・namespace・context・単位/精度が完全一致する場合だけ理由付きで採用します。値、精度、単位等が異なれば曖昧として保持し、先頭を勝手に採用しません。取得結果はコピーで、外部変更を解析済みobjectへ戻しません。

## 5数値と分母

| metric | 原タグ/欄 | valueUnit |
|---|---|---|
| heldEquivalents | TotalNumberOfStocksEtcHeld、T＝保有株券等の総数 | share-or-unit-equivalents |
| potentialEquivalents | NumberOfResidualStocksHeld、U＝保有潜在株券等の数 | share-or-unit-equivalents |
| outstandingEquivalents | TotalNumberOfOutstandingStocksEtc、V＝発行済株式等総数 | share-or-unit-equivalents |
| holdingPercent | HoldingRatioOfShareCertificatesEtc、当期の記載比率 | percent |
| previousHoldingPercent | HoldingRatioOfShareCertificatesEtcPerLastReport、直前報告の記載比率 | percent |

XBRLのshares/pureを解決した単位と照合します。pureの0.0507は5.0700％へ正確に換算し、原値・valueUnit・multiplier=100・十進値・安全な場合のsafeNumberを分離します。保有数は非負の整数値、比率は0〜1のpure原値に限定します。非整数、範囲外、単位違い等は結果と全候補証跡へ同じ除外理由を残します。

分母の定義はPDFのT/(U+V)×100に対応する`reported-T-over-U-plus-V`です。Uがnilなら0とはせず、原比率は直接報告値として保持します。比率をT/Vへ変更したり、丸め差を再計算したりしません。実例では潜在株券数940万と発行済総数約2.35億を分母に含めるため、有報大株主の自己株式除外比率と同一定義ではありません。

nil・タグ不在・不明と明示0を区別します。株券等には潜在株券や口数を含む場合があり、すべてを普通株式の直接保有数や議決権へ置き換えません。0％の実原本も数値として保持し、未開示としません。

## 検索・CLI・上限

cutoff/dutyDate/scope/metricが必須です。cutoffは提出日時とknownAtの両方へ適用し、まだ観測できない原本は解析結果/evidenceにも含めません。scope=reportはreportTotalの参照行、holderは集計以外の行を検索します。名義の部分一致はholderで利用し、issuerEdinetCodeは一覧が宣言する発行者コードの一致です。保有者の同一性を確認した逆引きではありません。

比較/順序は正確な分数、同額は書類ID/contextRef順です。condition.valueは選んだ指標の株・口換算単位または百分率で、5は5％です。義務日/コード/条件外はfiltered、利用できない原本/値はexcludedへ理由を返します。matchedはページ適用前の行数であり、現在の独立保有者数や銘柄数ではありません。offsetは0以上、limitは既定100/最大1,000です。

```sh
node dist/cli.js screen-large-holdings --manifest manifest.json \
  --cutoff 2026-10-28T12:00:00+09:00 --duty-date 2025-06-16 \
  --scope report --metric holdingPercent \
  --condition '{"operator":"gte","value":5}' --sort value-desc
```

manifestはfile/metadataの配列です。fileはmanifestの所在から解決します。100原本/256MiB、各原本は1,000context/10,000候補、検索は10,000保有者行まで。原本ID重複を拒否します。CLIは共通の有限読取りを使い、失敗入力はログへ表示しません。factory/object selector/search自身は通信も既存DBの変更もしません。既存getLargeShareholdingInfoは先頭候補の原値を返す互換動作を維持し、README/生成型説明で未検証の集計範囲と単位を明示しました。

## 実原本確認と残工程

正規APIで光通信の初回、上村氏の2変更、GFAの変更と訂正添付、シティインデックスイレブンスの変更（短期大量譲渡）の計6原本とPDFを取得しました。既存の一覧から選び、訂正対象の6月17日一覧を追加取得しています。XBRL/PDF各6取得と一覧1取得で、有料サービスは利用していません。APIキーは表示せず、取得物/原本hashと観測時刻を私有の検証記録へ保存しました。

6原本11行の137選択項目を独立XML処理で照合し、採用123項目・nil12・集計名義不在2、159fact証跡（採用項目147・nil12）と数値49件（表紙の人数6件を含む）が一致しました。保有関係の43数値のうち、通常原本5件10行の38数値・12nil、Vの基準日10件、表紙日付10件/人数5件は同じ提出のPDFと一致しました。画像でも個別/集計、分母・単位、訂正PDFの範囲を確認しました。

訂正PDFは訂正箇所の取引表だけです。訂正添付XBRLの保有5数値は訂正対象XBRLとの一致と対象PDFで別に確認し、訂正PDF自身で全文の保有値を照合したとはしません。8検索の結果・順序・nil/観測cutoff除外も独立期待値と一致しました。

索引方針: 書類ID/原本hash/抽出版/観測日時と、一覧種別・フォーム・親番号を分離保存します。保有者行のcontext/memberを保持し、集計は元行への参照で扱い、日付は義務発生/一覧提出/添付表紙/Vの基準日を別列にします。訂正や変更を1社の同一残高へ潰さず、十進値・原単位/倍率・採用状態/理由を保存する方針です。永続索引と移行・負荷検証はまだ実装していません。

全様式/全銘柄、共同保有者メンバーの追加実例、発行者/保有者の法人同定、独立した保有時点の認定、証券別内訳/取引明細、訂正系列の自動選択/再構成、既存DB/固定配布物/利用先の最終反映は残工程です。政策保有/役員・報酬等と他段階の範囲も維持し、全体計画6bの完了とはしません。

追加後の検証: 全99ファイル・3,162テスト（Node26.12.1/1ワーカー）、公開API型検査、build成功。不正数値の結果/候補証跡の理由一致も回帰検証しました。source/buildの実6原本11行の全JSONが同等で、公開CLI/APIは明示0％を含む報告2件で一致し、公開CJSの関数/定数も確認しています。
