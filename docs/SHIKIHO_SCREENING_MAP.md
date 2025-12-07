# 会社四季報オンライン スクリーニング項目と本ライブラリの対応状況

利用者から提示された [会社四季報オンライン スクリーニング項目一覧](https://help.toyokeizai.net/hc/ja/articles/46335568563097-%E3%82%B9%E3%82%AF%E3%83%AA%E3%83%BC%E3%83%8B%E3%83%B3%E3%82%B0%E9%A0%85%E7%9B%AE%E4%B8%80%E8%A6%A7-%E4%BC%9A%E7%A4%BE%E5%9B%9B%E5%AD%A3%E5%A0%B1%E3%82%AA%E3%83%B3%E3%83%A9%E3%82%A4%E3%83%B3) に基づき、`edinet-ts` ライブラリで取得可能な項目（`KeyMetrics`）との対応関係をまとめました。

> [!NOTE]
> 四季報オンラインの項目は、東洋経済独自の予想値（TK）や会社予想値を含む場合がありますが、本ライブラリは**有価証券報告書（実績値）**のXBRLデータに基づく値を抽出します。

## 1. 取得可能な項目 (Supported)

以下の項目は `EdinetXbrlObject.getKeyMetrics()` から直接、または簡単な計算で取得可能です。

| 四季報スクリーニング項目 | ライブラリ対応プロパティ (`KeyMetrics`) | 備考 |
| :--- | :--- | :--- |
| **売上高** | `netSales` | 連結優先、単体フォールバック |
| **営業利益** | `operatingIncome` | |
| **経常利益** | `ordinaryIncome` | |
| **当期純利益** | `netIncome` | 親会社株主に帰属する当期純利益 |
| **純資産** | `netAssets` | |
| **総資産** | `totalAssets` | |
| **営業キャッシュフロー** | `operatingCashFlow` | |
| **投資キャッシュフロー** | `investingCashFlow` | |
| **財務キャッシュフロー** | `financingCashFlow` | |
| **現金同等物** | `cashAndEquivalents` | 期末残高 |
| **EPS (一株当たり利益)** | `earningsPerShare` | 実績値 |
| **BPS (一株当たり純資産)** | `bookValuePerShare` | 実績値 |
| **自己資本比率** | `equityToTotalAssetsRatio` | 純資産 / 総資産 (またはXBRLタグ直接参照) |
| **ROE (自己資本利益率)** | `rateOfReturnOnEquity` | 実績値 |
| **発行済株式数** | `numberOfIssuedShares` | 期末発行済株式総数 |
| **一株当たり配当** | `dividendPaidPerShare` | 実績値 |

## 2. 外部データがあれば計算可能な項目 (Calculable with External Data)

以下の項目は、XBRLデータ（財務数値）に加え、**株価データ**が必要です。本ライブラリ単体では取得できませんが、株価を別途用意すれば計算可能です。

| 四季報スクリーニング項目 | 必要なXBRLデータ | 必要な外部データ | 計算式 |
| :--- | :--- | :--- | :--- |
| **PER (株価収益率)** | `earningsPerShare` (EPS) | 株価 | 株価 / EPS |
| **PBR (株価純資産倍率)** | `bookValuePerShare` (BPS) | 株価 | 株価 / BPS |
| **配当利回り** | `dividendPaidPerShare` | 株価 | 一株配当 / 株価 * 100 |
| **時価総額** | `numberOfIssuedShares` | 株価 | 株価 * 発行済株式数 |

> [!TIP]
> `EdinetXbrlObject` には `priceEarningsRatio` (PER) プロパティも用意されていますが、XBRL自体にPERが記載されているケースは稀です（主にIFRS採用企業の一部など）。基本的には株価データとの組み合わせが必要です。

## 3. 本ライブラリでは取得不可・対象外 (Not Supported)

以下の項目は四季報オンライン独自のデータ、または定性情報であり、EDINET XBRLの実績データからは取得できません。

*   **東洋経済予想 (TK) / 会社予想**: 来期・再来期の業績予想数値。
*   **四季報スコア**: 成長性、収益性などの独自評価スコア。
*   **記事・見出し**: 記者が執筆した記事テキスト。
*   **株価モメンタム**: 株価の移動平均乖離率など。
*   **大株主情報**: XBRLの別セクションにある場合もありますが、現在の `KeyMetrics` では対象外です（拡張すれば取得可能な場合あり）。
*   **セグメント別データ**: XBRLには含まれますが、構造が複雑なため `KeyMetrics` としては一律抽出していません（`EdinetXbrlObject` から個別にタグを指定すれば取得は可能です）。

## まとめ

本ライブラリは、スクリーニングの基礎となる**主要な財務実績データ（PL/BS/CF/主要な一株当たり指標）**を網羅しています。これらをベースに、外部の株価APIなどと組み合わせることで、PER/PBR/時価総額などの投資指標を計算する基盤として利用可能です。
