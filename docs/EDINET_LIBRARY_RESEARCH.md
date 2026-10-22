# EDINETライブラリの設計調査

調査時点: 2026-10-22。公開一次資料から、edinet-tsの独立実装に役立つ設計を比較する。
各プロジェクトの機能・速度・品質を同じ実データで実測した比較ではない。
公開パッケージ版と開発ブランチは区別する。版・ライセンスは導入時に再確認する。

## 候補と参考にする設計

| プロジェクト/一次資料 | 確認した状態・ライセンス | 参考にする設計 | 適用範囲/注意 |
|---|---|---|---|
| [matthelmer/edinet-tools](https://github.com/matthelmer/edinet-tools)、[MIGRATING](https://github.com/matthelmer/edinet-tools/blob/main/MIGRATING.md) | PyPI 0.9.0（2026-10-06）、mainに0.9.1移行文書。MIT | 会計基準別候補選択、source_elements/source_contexts/units/extraction_flags、欠測≠0、CSV/iXBRL/instanceの区分 | P0の来歴・選択理由・再解析diff。通貨/単体fallback/訂正/巨大整数と、旧誤値を欠損へ変更する移行説明が参考 |
| [ajtgjmdjp/edinet-mcp](https://github.com/ajtgjmdjp/edinet-mcp)、[_cache.py](https://github.com/ajtgjmdjp/edinet-mcp/blob/main/src/edinet_mcp/_cache.py) | 0.9.0（2026-08-23）、Apache-2.0 | taxonomy.yamlの161科目、raw保持と正規化、TTL/破損JSONをcache missにする方針、SHA256、一時ファイル+fsync+atomic replace | P0のmapping、P1のcache。Python/MCP依存をcoreへ追加する必要はない |
| [youseiushida/edinet](https://github.com/youseiushida/edinet) | 0.4.1（2026-03-19）、alpha、AGPL-3.0-or-later | canonical key、DEIによる基準判別、Decimal、taxonomyと三表hierarchy | 設計の参考。コードやmappingの流用はせず、公式仕様から独立実装する |
| [ehnmark/edinet-client](https://github.com/ehnmark/edinet-client) | 小規模、LICENSE未確認。README確認 | HTTP 200内のJSON業務エラー、Retry-After/backoff+jitter、日付一覧1回から複数銘柄処理、download skip | P1の取得設計候補。コード/実動作は未検証、コピーしない |
| [axioradev/edinet-xbrl](https://github.com/axioradev/edinet-xbrl) | Modified MIT。通常のMITとは異なり商用UI attribution条件あり | taxonomy.json、iterparse、Pydantic、parse_warnings | mapping/validation/warningsの参考。READMEの他社比較は本比較の根拠にしない。導入/流用は条件精査が先 |
| [SakanaAI/edinet2dataset](https://github.com/SakanaAI/edinet2dataset) | Apache-2.0、2026-03-06のcitation更新commitを確認 | 原本/加工物の分離、docID単位保存、checksum/parserVersion/取得時刻manifest、fixture corpus | P0の再現性、P1のcache、品質検証。大規模取得は別判断 |
| [BuffettCode/edinet_xbrl](https://github.com/BuffettCode/edinet_xbrl) | Apache-2.0、master確認commitは2019-03-12 | raw element/contextアクセス | 既存利用者向けの低レベルAPIは維持。旧downloaderを再導入しない |
| [jackchuka/edinet-cli](https://github.com/jackchuka/edinet-cli) | MIT、小規模、最新日未確定。README確認 | table/json/csv、stdinのdocID列、部分失敗をstderr/nonzero、成功分保持、join用識別列 | P1の安定CLI出力契約。性能・実動作は未検証 |
| [chakki-works/xbrr](https://github.com/chakki-works/xbrr) | MIT、確認commitは2021-06-16 | Business/Finance aspect API、三表CSV | APIの関心分離・export設計の参考。古いことだけでarchivedや不要とは判断しない |

## 取り込む設計の優先順位

### P0: 値の意味と再現性

- **Metric registry**: 安定ID、型、単位、instant/duration、会計基準、連結fallback、taxonomy版を宣言する。18項目と追加計算を同じ辞書で監査可能にする。
- **Fact selection result**: selected/missing/unsupported/ambiguousの状態、namespace/context/period/dimension/unit/raw/decimals、採用/不採用理由を保存する。
- **精度**: decimal文字列を原値として保持し、安全に表現できる場合だけnumberへ変換する。巨大整数や丸めを黙って通さない。
- **境界fixture**: J-GAAP/IFRS/US、銀行/保険、単体、訂正、外貨、重複context、nil、巨大整数。元書類と照合し、誤抽出と本当の0を区別する。
- **versionと差分**: parserVersion/mappingVersion、原本checksum、取得時刻を記録し、再解析でどの値が変わったか説明する。
- **XML/ZIP境界**: XMLの外部entity/networkを許さない。ZIPのtraversal、展開後サイズ、ファイル数、圧縮率/入れ子等の資源上限を検証する。parser置換の前後でも必須条件とする。

### P1: 取得・保存・CLIの契約

- 日付一覧を一度取得して複数銘柄へ振り分け、bounded concurrency、Retry-After、jitter、timeout、AbortSignalを扱う。
- HTTP成功/業務エラー/本当の空結果を分離し、失敗を「提出なし」としてcacheしない。
- 原本cacheと解析cacheを分離し、一時ファイル+atomic replaceで破損を防ぐ。TTL/再解析version/破損時の再取得方針を定義する。
- JSONの安定schema、stderr、exit code、部分成功、docID/code/period/standard等のjoin列を定義する。
- 訂正/withdrawn履歴とas-of選択規則を保持する。保存していない過去の版は復元したことにしない。

### P2: 表構造・export・adapter

- linkbaseに基づく三表hierarchyと検算、半期/四半期/前年比の差分計算。
- rawquery/CSVと、必要になった場合の薄いMCP adapter。coreの抽出・計算にMCPの実行環境を持ち込まない。

各項目の実装段階・依存・受入条件は [改善計画](plans/EDINET_TS_ROADMAP.md) に統合する。この調査だけで依存追加や外部コードコピーを行わない。

## 採用基準と非採用の境界

意味的正確性、来歴、欠損、単位/期間/scope、再現性、安全な入出力を先に評価し、名称の新しさや対応項目数だけで置換しない。
既存raw APIと後方互換性を保ちながら、選択方針とmappingを公式仕様から独立実装する。

ライセンス条件が異なるコード・mapping・fixtureのコピーと、公開資料から一般的な設計を学ぶことは別である。MIT/Apache-2.0でも流用時は通知等を確認し、AGPL/Modified MITやLICENSE未確認の実装を安易に取り込まない。今回、外部コード・mapping・依存は導入していない。

要件の基準は [金融庁EDINET API資料](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WEEK0060.html) と元XBRL/タクソノミである。各ライブラリの主張を、そのまま全市場の正確性や性能の保証にはしない。
