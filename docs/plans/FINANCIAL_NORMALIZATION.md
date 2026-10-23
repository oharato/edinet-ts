# 財務明細正規化の実装候補と受入計画

状態: 調査・設計済み、実装未着手。更新日: 2026-10-22。
調査基準: `origin/main` の `ec49152`（PR #20統合後）。計画の存在はAPI対応・実数値照合・全市場充足率の達成を意味しない。
[改善計画](EDINET_TS_ROADMAP.md)の段階1・2・8を、小さい独立PRへ分けるための資料である。

## 調査の範囲と再利用

既存コード、生成済み型、同梱XBRLのみを照合した。新しい提出書類の取得、認証API照合、第三者コード・mappingのコピーは行っていない。以下の記録はタグ・scope・期間・基準の存在確認で、個別銘柄の金額は掲載しない。

- [EdinetXbrlParser](../../src/edinet-xbrl-parser.ts)はcontextRef付きfactを保持するため、新しいタグを読むための別XMLパーサーは不要。
- [EdinetXbrlObject](../../src/edinet-xbrl-object.ts)の `getDataList()`、`getDataByContextRef()`、`getKeys()`、`findContexts()`を候補調査に再利用できる。`getJppfsCor()`の型付きアクセスも存在するが、正規化の選択理由や基準を返す契約ではない。
- [jppfs型](../../src/types/jppfs_cor_taxonomy.ts)と[jppfs一覧](../TAXONOMY_JPPFS_COR.md)には下表のJ-GAAP候補がある。型は2024版・一般商工業を生成元とし、最新年度・全業種対応の証明には使わない。`jpigp_cor`の専用生成型は現行にない。
- `getKeyMetricsWithSources()`のタグ・context・期間・scope・単純通貨の来歴と、[scope回帰](../../test/key-metrics-scope.test.ts)、[contextテスト](../../test/edinet-context.test.ts)、[screeningテスト](../../test/financial-screening.test.ts)を再利用する。既存18項目の値を変更する作業とは分離する。
- remote branchの監査は親作業で実施済み。既存のscope修正・財務検索の統合済み実装を基準にし、古いbranchを再適用しない。`preserve-submission-datetime`はremote/当該checkoutに存在を確認できず、不要・統合済みとは判定していない。

公式の参照元は[2024年版EDINETタクソノミ公表資料](https://www.fsa.go.jp/search/20231211.html)の勘定科目リスト・国際会計基準タクソノミ要素リスト・報告項目及び勘定科目の取扱いに関するガイドライン。公式資料の入口と既存生成元を確認した段階で、全要素の意味や新版差分の網羅照合は未実施。生成先を手で変更せず、更新時は[タクソノミ更新手順](../TAXONOMY_UPDATE.md)に従う。

## 現在可能なことと追加が必要なこと

| 区分 | 単一銘柄・単一書類 | 横断検索 |
|---|---|---|
| 現在可能 | 既存18主要指標、選択factの来歴、任意タグのraw取得 | 明示snapshot集合の21指標filter/sort。永続財務索引・全市場DBではない |
| タグはあるが未正規化 | 下表のBS/PL/CF候補。raw取得成功を統一API対応としない | 新しい科目は現行metric key/filter/sortに未登録 |
| 追加計算 | 流動比率、負債比率、借入合計、設備投資合計等。必要明細・定義の合意後に追加 | 同一scope/時点/通貨/基準の入力を揃えたsnapshotだけを対象にする |
| 未取得・未検証 | US-GAAP・金融業・新リース基準等の対象fixture、複数年度の独立原本照合、最新taxonomy差分 | 母集団別充足率、外部サービスとの値一致、全社永続索引 |

未取得、タグ不在、未対応基準、context不一致、単位不明、曖昧な重複、nilを、実値0から区別する。欠損状態の具体的な型/API名は先行するFact selection設計で確定する。本計画では仮の実装・exportを追加しない。

## 小規模な正規化単位

以下の項目名は設計上の候補名。公開API名の確定ではない。`jppfs_cor:`はJ-GAAP候補、`jpigp_cor:`はIFRS候補であり、namespace URI・taxonomy版も照合する。local nameだけで未知namespaceや会社拡張を同義扱いしない。

| 優先/概算 | 項目・期間 | 元候補 | 誤混入防止・残課題 |
|---|---|---|---|
| P1/S | 流動資産・Instant | `jppfs_cor:CurrentAssets` | 合計factのみ。内訳やセグメントを足さない。IFRS候補 `jpigp_cor:CurrentAssetsIFRS` は別mapping。売却目的資産を除く `CurrentAssetsOtherThanAssetsHeldForSaleCAIFRS` を同義にしない |
| P1/S | 流動負債・Instant | `jppfs_cor:CurrentLiabilities` | IFRS候補は `jpigp_cor:TotalCurrentLiabilitiesIFRS`。`OtherCurrentLiabilitiesCLIFRS` 等の内訳で代用しない |
| P1/S | 負債合計・Instant | `jppfs_cor:Liabilities` | `LiabilitiesAndNetAssets`と区別。IFRS候補 `jpigp_cor:LiabilitiesIFRS`。売却目的関連を除く小計を代用しない。純資産差引計算は別指標 |
| P1/S | 固定資産・固定負債・Instant | `jppfs_cor:NoncurrentAssets` / `NoncurrentLiabilities` | IFRS資産候補 `jpigp_cor:NonCurrentAssetsIFRS`（大文字小文字に注意）。IFRS負債の総額候補は追加確認が必要。差額補完しない |
| P1/S | 現預金・Instant | `jppfs_cor:CashAndDeposits` | 既存 `cashAndEquivalents` と別項目。定期預金の調整等を推測しない。IFRSで自動的に現金同等物へfallbackしない |
| 既存の監査/P0/S | 現金及び現金同等物・Instant | 既存 `jppfs_cor:CashAndCashEquivalents` / `CashAndCashEquivalentsEndOfPeriod` / `jpcrp_cor:CashAndCashEquivalentsIFRSSummaryOfBusinessResults` | `jpigp_cor:CashAndCashEquivalentsIFRS` は追加候補。要約/本表で異なるfactがあれば理由付き選択・曖昧さを記録。現預金で埋めない |
| P2/M | 借入・社債・リース各残高・Instant | `jppfs_cor:ShortTermLoansPayable` / `CurrentPortionOfLongTermLoansPayable` / `LongTermLoansPayable` / `CurrentPortionOfBonds` / `BondsPayable` / `LeaseObligationsCL` / `LeaseObligationsNCL` | まず各直接factを独立保持。短期借入に一年内返済分が含まれるか、関連会社借入の内訳か合計かを確認。リース欠損を0扱いせず、有利子負債総額を直ちに作らない |
| P2/M | IFRS有利子負債・リース各残高・Instant | `jpigp_cor:InterestBearingLiabilitiesCLIFRS` / `InterestBearingLiabilitiesNCLIFRS` / `LeaseLiabilitiesCLIFRS` / `LeaseLiabilitiesNCLIFRS` | 有利子負債がリースを含むか原文注記と定義で確認。上位額と内訳を重複加算しない。J-GAAP借入のみとの比較は別定義 |
| P1/S〜M | 売上原価・販管費・Duration | `jppfs_cor:CostOfSales` / `SellingGeneralAndAdministrativeExpenses` | IFRS候補 `jpigp_cor:CostOfSalesIFRS` / `SellingGeneralAndAdministrativeExpensesIFRS`。業種別費用や部門費用の部分合計で代用しない。符号・費用機能別/性質別を確認 |
| P2/M | CF調整の減価償却・Duration | `jppfs_cor:DepreciationAndAmortizationOpeCF` | `DepreciationSGA`、設備別累計償却、売上原価内の償却と区別。CF調整値からEBITDAを即計算しない |
| P2/M | 設備投資支出・Duration | `jppfs_cor:PurchaseOfPropertyPlantAndEquipmentInvCF` / `PurchaseOfPropertyPlantAndEquipmentAndIntangibleAssetsInvCF` | 有形のみと有形+無形を別項目にする。両方を加算しない。支出符号の仕様を固定し、資産増減やリース取得を代用しない |

P0/P1/P2およびS/Mは[改善計画](EDINET_TS_ROADMAP.md)と同じ相対的な概算で、実測工数・納期ではない。金融業・保険業の表示構造は別mappingとして保留する。

## 保存fixtureの存在確認

`test/test_data`内のXMLをnamespace展開付きで読み、対象要素に `contextRef` があること、対応contextにinstant/durationがあること、`AccountingStandardsDEI`の有無を確認した。以下は実装後に使う入力候補であり、元書類との金額照合済み一覧ではない。

| 入力（test/test_dataからの相対位置） | 基準の記載 | 確認したscope/期間 | 再利用先と限界 |
|---|---|---|---|
| `CJ_2371_kakakucom.xbrl` | Japan GAAPあり | BS3項目・現預金は当期/前期、連結/単体。PL2項目はDuration。CF調整/有形支出あり | J-GAAPの基本ケース。旧版taxonomyを含む |
| `3031_raccoon.xbrl` | Japan GAAPあり | BS3項目・現預金・長期借入/一年内返済あり。負債にはセグメント/調整項目contextもある | セグメント除外と借入内訳の境界に有用 |
| `CI_4689_yahoo.xbrl` | IFRSあり | jppfsのBS3項目・現預金・PL2項目は単体。当期/前期あり | IFRSというDEIだけで単体jppfs値を連結IFRSへ採用してはいけない例 |
| `S100TMMG/XBRL/PublicDoc/*.xbrl` | Japan GAAPあり | BS3項目・現預金は当期/前期、連結/単体。有形+無形支出あり | 有形のみと合計支出の区別。PL/CFはDuration |
| `S100TP3N/XBRL/PublicDoc/*.xbrl` | IFRSあり | jpigpの流動資産/流動負債/負債/現金同等物・有利子負債/リースあり。jppfsのBS3項目は単体 | 連結IFRSと単体J-GAAPの同居。IFRS候補はここで存在確認できるが複数企業の検証は不足 |
| `S100U4EY/XBRL/PublicDoc/*.xbrl` | Japan GAAPあり | `3031_raccoon.xbrl`と同じ書類管理IDの原本配置 | 独立した別企業/別年度のサンプルとして数えない |

当期・前期factが同じ原本にあることは、複数年度の独立した提出原本が照合済みであることとは異なる。`S100TMMG`等のInline HTMLやlinkbaseの同梱を再利用できるが、本調査で全表の意味・金額照合は行っていない。AuditDocの監査書類を財務本表の追加サンプルとして数えない。

## 先行依存と選択契約

先行するMetric registry / Fact selection APIの実装・レビューが必要。そのAPIの確定後に、上の候補を登録し、選択結果から正規化値を構築する。本計画で同じAPIを並行して仮実装しない。

1. 出所をnamespace URI/local name/taxonomy版、contextRef、単位、原値、decimals、scope、期間、会計基準で保持する。decimalsは倍率と解釈しない。安全なnumberに収まらない値の扱いは精度基盤へ従う。
2. scopeと対象時点/期間を先に指定し、その範囲に対象タグがなくても連結から単体、当期から前期へ移らない。BSはInstant、PL/CFはDurationとし、年次/YTD/単四半期を区別する。
3. DEIの連結基準と個別factの基準は分離する。IFRS書類のjppfs単体値に無条件でIFRSを付与しない。不明基準のfactは比較可能と断定しない。
4. セグメント・地域・調整項目・会社別明細などの次元を全社総額に混ぜない。scope次元と追加明細次元を区別する。
5. 同一tag/context/単位の競合fact、同義候補間の不一致は黙って先頭採用しない。選択/不採用理由・重複処理は先行APIに合わせる。

## 具体的な受入テスト

次の期待値は合成fixtureで固定する。金額例は架空であり、個別銘柄の照合値ではない。実装時には[既存scope回帰](../../test/key-metrics-scope.test.ts)を維持し、独立した新しいテストファイルへ追加する。

| ID | 入力/操作 | 期待結果 |
|---|---|---|
| F01 | J-GAAP/JPY/同一Instantに流動資産120、流動負債40、負債80 | 3項目をそのまま返し、原タグ/context/時点/通貨が一致。比率はこのPRでは計算しない |
| F02 | 連結contextあり、流動資産は単体にだけ存在 | 連結指定では理由付き欠損。単体指定でのみ値を返す |
| F03 | 当期に科目なし、前期には存在 | 当期は欠損。明示した前期でのみ返す。180日などの近接判定で補完しない |
| F04 | 同じtagに全社80、部門30、調整項目10 | 全社80のみ。部門/調整だけなら全社を欠損にし、40へ合算しない |
| F05 | BS候補をDuration、PL候補をInstantにだけ配置 | 期間種別不一致で除外。書類年次判定だけで採用しない |
| F06 | 現預金100、現金同等物70を同時配置 | 独立項目として保持。片方を除いても他方で穴埋めしない |
| F07 | IFRS連結jpigp流動資産120、同書類の単体jppfs流動資産50、DEI=IFRS | 連結IFRSでは120。J-GAAP限定の最初の実装では連結IFRSは未対応と明示し、50に切り替えない |
| F08 | `Liabilities`80と`LiabilitiesAndNetAssets`200、売却目的関連除外小計70 | 負債合計は80。総資本/除外小計を代用・加算しない |
| F09 | 0、負数、nil、空、タグ不在を別ケースにする | 有効な0と負数は保持。nil/空/不在を0に変えず理由を区別 |
| F10 | 同一候補でJPY/USD混在、単位未定義、非金額単位、巨大整数 | 指定通貨だけを採用。不明/不適合は理由付き除外。精度を黙って丸めない |
| F11 | 同一tag/context/unitに同値2件と異値2件、未知namespace同名tag | 先行APIの重複契約を検証。同値重複も記録し、異値は曖昧、未知namespaceは自動同義採用しない |
| F12 | 借入総額/内訳/一年内返済、リース有無の組合せ | 初期は各直接factだけ返す。将来の集計では重複しない構成の証明と不足項目の理由が必要 |
| F13 | 有形支出-20、有形+無形支出-30、償却CF調整5、販管費償却2 | 支出種類と符号、償却の用途を保持し、支出-50/償却7へ機械的に足さない |
| F14 | 半期YTDと単四半期、異なる終了日、訂正版候補を混在 | 明示した期間/版のfactだけを選択。不明な分類や保存していない版を推測しない |
| F15 | 保存fixtureのrawタグ/contextと新APIの来歴を照合 | 上表で存在確認した範囲を再現。数値の公開や新しい原本の取得は不要。独立原本・原表照合の不足を別記 |
| F16 | 同じ選択済みsnapshotを個別APIと横断filter/sortへ渡す | registry登録後は値・欠損・通貨/期間条件が一致。未登録の時点では横断対応済みと報告しない |

## 最初の実装PRと後続の区切り

最初は **J-GAAP一般事業の流動資産・流動負債・負債合計の直接fact 3項目** とする（P1/S。ただし先行基盤の対応範囲次第でM）。出所付きの別APIへ追加し、既存KeyMetricsの18項目や自動fallbackの互換契約には触れない。F01〜F05/F08〜F11/F14/F15と、IFRS混入を防ぐF07を通過条件にする。保存fixtureからJ-GAAP連結・単体を最低2企業で検証し、未対応IFRS・不明基準の結果を明示する。元書類との照合未達を残して全市場/複数年度対応完了とはしない。

次に同じ3概念のIFRS mappingを別PRで追加する。F07・売却目的資産/関連負債の合計境界、少なくとももう1企業の保存fixtureと原表照合が必要。既存入力だけではその複数企業条件は満たせないため、新規取得を本計画で開始しない。

その後、現預金の独立項目（F06）、固定資産/固定負債、PL2項目、CF明細、借入/リース各残高を個別に進める。横断検索の新key/filter/sort登録は、単一銘柄の定義・欠損・基準が確定した項目から別の受入単位として追加しF16を実施する。流動比率などの追加計算、永続索引、配布物更新、利用先統合は別PRとする。
