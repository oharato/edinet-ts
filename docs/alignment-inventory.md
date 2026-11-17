# 簡素化要件と現行 main の整合棚卸し

- 調査日: 2026-11-17
- 対象: `origin/main` (`8f985ac`)。行番号はこのコミット基準
- 補足: 調査後に main は `7155904` まで進んだが、差分は oxfmt の適用と依存更新のみで、判定に影響する実質変更はない
- 基準: 2026-11-07 に決定した簡素化要件（本リポジトリ外の合意事項。以下「要件」）
- 方法: 全ソース・設定・ドキュメントを実読し、要件ごとに判定。ビルドとテストも実行して事実確認済み（`pnpm run build` / `pnpm run test` = 3 tests passed）

このドキュメントはコードを変更しない。判断が必要な点を、根拠（ファイル:行）付きで列挙することが目的。

---

## 1. 判定サマリ

| 判定                   | 件数 | 項目                               |
| ---------------------- | ---- | ---------------------------------- |
| 一致                   | 8    | A1, D1, D2, F1, G1, H1, H2, I1     |
| 乖離                   | 9    | B1, C1, C2, E1, E3, G2, H3, H4, I2 |
| 一部一致               | 1    | E2                                 |
| 要件未定義（判断待ち） | 2    | H5, H6                             |

### 主な乖離（影響が大きい順）

1. **H3: systemd timer がリポジトリに存在** — 要件が明示的に禁止した「常駐・タイマー」。`systemd/edinet-daily-sync.{service,timer}`
2. **E1: XBRL 全 Fact を `xbrl_facts` に保存** — サマリー＋三表の範囲を超え、注記テキストやセグメント軸まで保存。しかも読み出し経路がなく write-only
3. **H4: 半期・四半期・訂正まで取得** — 有報(120)中心の要件に対し `120,130,140,150,160,170` を既定で対象化
4. **E2: 訂正有報(130)を別テーブルに隔離** — 訂正が年次テーブルを上書きせず、スクリーニング結果が古いままになる設計上の穴
5. **C2: `--min-*` 系フィルタ CLI が残存** — 要件と自プロジェクトの設計原則3の両方に反する

---

## 2. 項目別の棚卸し

判定は「一致」「乖離」「一部一致」「要件未定義」の4種。推奨は「要件に戻す」「要件を更新する」「現状維持」の3種。

### A. 目的・スコープ

#### A1. DuckDB で前年比の利益率・収益性スクリーニングに特化 — 一致

- 根拠: `src/financial/extractor.ts:104-124` で営業利益率・利益率成長率・ポイント差を計算。`src/db/store.ts:360-487` の `screen()` が DuckDB SQL で絞り込み・ソート。`README.md:3-5` も同じ目的を明記。
- 判定理由: 指標計算の中心が営業利益率の前年比較にあり、要件の目的と一致する。
- 推奨: **現状維持**

### B. src 構成

#### B1. src は 7 ファイル構成 — 乖離

- 実際: 9 ファイル。
  - `src/types.ts`, `src/index.ts`, `src/cli.ts`
  - `src/xbrl/parser.ts`, `src/financial/extractor.ts`
  - `src/db/store.ts`, `src/db/schema-info.ts`, `src/db/facts.ts`
  - `src/edinet/client.ts`
- 根拠: `docs/ARCHITECTURE.md:24` は「わずか **7ファイル**」と主張するが、同 `:26-40` のツリーは 8 項目を列挙し、`src/db/facts.ts` を含まない。`src/index.ts:1-6` も 6 行で、`docs/ARCHITECTURE.md:39` の「わずか5行」と食い違う。
- 判定理由: 再設計時点の「7」は数え違い（実際は 8、うち index.ts を除けば 7）。その後の `04cb31a` で `facts.ts` が加わり 9 になった。
- 推奨: **要件を更新する（9 → E1 の結論次第で 8）**。あわせて `ARCHITECTURE.md` のファイル数・ツリー・行数表記を実態に合わせる。数値そのものを要件に固定すると、今回のように必ずドリフトする。

### C. CLI

#### C1. CLI は parse / load / screen / schema / import-archive / sync の6コマンド — 乖離

- 実際: 7 コマンド。`facts` が追加されている。
- 根拠: `src/cli.ts:30`(parse), `:99`(load), `:156`(import-archive), `:258`(screen), `:371`(schema), `:412`(sync), `:604`(facts)。`docs/ARCHITECTURE.md:38` のコマンド一覧にも `facts` はない。
- 判定理由: `facts` は E1 の全 Fact 保存を単体で実行するための入口で、要件には存在しない。
- 推奨: **要件に戻す（`facts` を削除し6コマンドに戻す）**。E1 を「現状維持」とする場合のみ要件更新。

#### C2. フィルタは CLI オプションを増やさず `--where` に一本化 — 乖離

- 実際: `screen` にフィルタ用オプションが5個ある（`--min-growth`, `--min-margin`, `--min-sales-growth`, `--min-equity-ratio`, `--min-roe`）。加えて `--table`, `--order-by`, `--order-dir`, `--limit`。
- 根拠: `src/cli.ts:261-282`、条件生成は `src/db/store.ts:371-397`。要件だけでなく、自プロジェクトの設計原則 `docs/ARCHITECTURE.md:112-116`（「`--min-xxx` を増やさない」）にも反する。
- 判定理由: 要件の「`--where` の SQL パススルー」と真っ向から重複する機能。`--where` で同一条件が書ける（`src/cli.ts:302-308` の例、`test/store.test.ts:82-87`）。
- 推奨: **要件に戻す（`--min-*` 5個を削除）**。表示制御の `--limit`/`--order-by`/`--json` は残してよい。`--table` は H4/E2 の結論に従う。

### D. 取得範囲

#### D1. 取得は有報サマリー表＋財務三表の標準科目まで — 一致

- 根拠: `src/financial/extractor.ts:5-83` のタグ一覧が、サマリー表系（`*SummaryOfBusinessResults`）と三表の標準科目（`NetSales`, `OperatingIncome`, `Assets`, `NetCashProvidedByUsedInOperatingActivities` 等）だけで構成されている。`src/financial/extractor.ts:350-399` の抽出もこの一覧のみを参照。
- 判定理由: 企業ごとに構造が変わる注記表を個別に追う処理はない。
- 推奨: **現状維持**

#### D2. 注記スクレイピング禁止 — 一致（抽出ロジックについて）

- 根拠: `src/` 全体に注記・人的資本・役員報酬・設備地番・法人番号を扱うコードは存在しない（`grep` で `docs/ARCHITECTURE.md` の禁止記述以外はヒットなし）。宣言は `docs/ARCHITECTURE.md:14, :93, :105`。
- 注意: 「保存」については E1 のとおり全 Fact を生で持つため、注記テキストが DB に残る。抽出しないことと保存しないことは別問題。
- 推奨: **現状維持**（保存側は E1 で判断）

### E. 保存データ

#### E1. 保存するのは財務サマリー（スクリーニング用の数値） — 乖離

- 実際: 3種類のテーブルを持つ。
  - `financial_summary`（年次サマリー）: `src/db/store.ts:55-90`
  - `financial_summary_periodic`（半期・訂正）: `src/db/store.ts:92-131`
  - `xbrl_facts`（全 Fact）＋ `xbrl_fact_documents`: `src/db/store.ts:133-159`
- 根拠: `xbrl_facts` は `sync` のたびに全 Fact を追記する（`src/cli.ts:538-542`）。行生成は `src/db/facts.ts:23-41` で、値テキスト・セグメント軸（`dimensions`）・Block テキストまで含む。テーブル定義のコメント自身が「数値・テキストBlock・セグメント軸」と書いている（`src/db/store.ts:133`）。
- 重要: `xbrl_facts` を読む経路がコード上に存在しない。`screen()` は `financial_summary*` しか参照しない（`src/db/store.ts:416-451`）。`facts` コマンドは書き込み専用（`src/cli.ts:603-716`）。つまりディスクを消費するだけで、要件の目的（スクリーニング）に寄与していない。
- 判定理由: 要件の「サマリー＋三表標準科目まで」を保存データの粒度で超えている。設計原則1（`docs/ARCHITECTURE.md:102-105`）とも矛盾。
- 推奨: **要件に戻す（`xbrl_facts` への保存と `facts` コマンドを削除）**。将来、注記分析をしたくなった時点で再導入すればよい。追加コミットは `04cb31a`。

#### E2. 年次とそれ以外の定期報告の持ち方 — 一部一致（設計上の穴）

- 実際: `120` は `financial_summary` へ、`130/140/150/160/170` は `financial_summary_periodic` へ入る（`src/cli.ts:547-568`）。`screen` は `--table` で切り替える（`src/cli.ts:261`, `src/db/store.ts:363-364`）。
- 問題: **訂正有報(130)が年次テーブルを更新しない**。同じ企業・同じ決算期の 120 が既にあっても、130 は別テーブルに入るだけなので、`annual` を既定とするスクリーニング（`src/cli.ts:261` の既定値）は訂正前の数値を返し続ける。逆に `periodic` 側は 130 と 160 が同居し、意味の異なる行が混ざる。
- 根拠: `src/db/store.ts:92-99`（periodic は `doc_id` 主キー）、`src/cli.ts:515-532`（120 は `security_code + period_end` でスキップ、130 は `doc_id` でスキップ）、`src/cli.ts:547-568`（挿入先の分岐）。
- 判定理由: 「有報の数値を正しくスクリーニングする」という目的に対し、訂正の反映方針が決まっていない。半期を別テーブルに置くこと自体は要件外だが害は小さい。害が大きいのは訂正の扱い。
- 推奨: **要件を更新する（訂正有報の反映方針を決める）**。選択肢は (a) 130 も `financial_summary` に上書きし、`doc_type_code` と提出日を保持する、(b) 130 を対象外にして「訂正前の数値である」と明記する、のいずれか。現状の「隔離」は不可。

#### E3. 企業同定は EDINET コード／証券コードで十分（原則2） — 乖離

- 実際: `financial_summary` の主キーは `(company_name, period_end)`（`src/db/store.ts:88`）。重複判定は一方で `security_code:period_end`（`src/db/store.ts:281-292`, `src/cli.ts:522-532`）、他方で `company_name:period_end`（`src/db/store.ts:264-275`, `src/cli.ts:548-555`）と混在。
- 根拠: `docs/ARCHITECTURE.md:109` は「企業同定は EDINET コードおよび4桁の証券コードで十分」と明記。
- 判定理由: 社名変更や表記ゆれで同一企業が二重登録され得る。スクリーニングの母集団が汚れる。
- 推奨: **要件に戻す（キーを `security_code`＋`period_end` に統一。EDINET コードも併用）**。優先度は中。

### F. 外部マスタ

#### F1. 外部マスタを抱え込まない — 一致

- 根拠: 法人番号・企業マスタ等のデータファイルはリポジトリに存在しない（`git ls-files` で確認）。依存は `commander` / `fast-xml-parser` / `jszip` / DuckDB のみ（`package.json:45-48`, `:58-59`）。企業同定は `src/types.ts:4-10` の EDINET コード・証券コードだけ。
- 推奨: **現状維持**

### G. ドキュメント

#### G1. ドキュメントは README ＋ docs/ARCHITECTURE.md の2点のみ — 一致

- 根拠: `docs/` 配下は `ARCHITECTURE.md` のみ。ルートの Markdown は `README.md` と `ANTIGRAVITY.md`（後者は2行の開発向けメモで、仕様書ではない）。
- 推奨: **現状維持**

#### G2. ドキュメントが実装に追従している — 乖離

- 実際: 以下の記述が現行コードと食い違う。
  1. `README.md:126`「取得したXBRLは `data/edinet-cache/` に保存され、不要な再通信を防止します」→ 現行 `sync` は取込後にキャッシュを削除する（`src/cli.ts:426`, `:543-545`）。残すには `--keep-cache` が必要。
  2. `README.md:109`「有価証券報告書（有報: docTypeCode 120）を自動取得」→ 実際の既定は `120,130,140,150,160,170`（`src/cli.ts:420-424`）。
  3. `README.md` に `facts` コマンド、`--doc-types`、`--table`, 半期・訂正の扱いが一切ない（`grep` で 0 件）。
  4. `docs/ARCHITECTURE.md:24, :38, :39` のファイル数・コマンド一覧・行数が古い（B1, C1）。
- 判定理由: ドキュメントの「本数」は要件どおりだが、「内容」が要件変更（半期・全Fact・キャッシュ削除）に追従していない。
- 推奨: **要件に戻す（2点構成は維持し、内容を実装に合わせて更新）**。E1/H4 を削除するなら、むしろ記述は元に戻る。

### H. 同期

#### H1. 同期は差分 CLI `sync` — 一致

- 根拠: `src/cli.ts:412-588`。既存キーをロードしてスキップ（`src/db/store.ts:264-304`, `src/cli.ts:494-532`）、未登録のみ取得・挿入する。`--dry-run` もある（`src/cli.ts:475-488`）。
- 推奨: **現状維持**

#### H2. 常駐プロセスなし・世代管理なし — 一致

- 根拠: デーモン、キュー、二段階コミット、世代カタログの類は存在しない。テーブルは `CREATE TABLE IF NOT EXISTS` のみ（`src/db/store.ts:55-159`）。
- 推奨: **現状維持**

#### H3. systemd timer を作らない — 乖離（重大）

- 実際: `systemd/edinet-daily-sync.service`（毎日 `sync --days 2` を oneshot 実行、`StandardOutput=append:...daily-sync.log`）と `systemd/edinet-daily-sync.timer`（`OnCalendar=*-*-* 06:00:00 Asia/Tokyo`）。
- 根拠: `systemd/edinet-daily-sync.service:1-18`, `systemd/edinet-daily-sync.timer:1-10`。要件および `docs/ARCHITECTURE.md:123-126` は「systemd timer を自作しない」「定期実行は cron や外部スケジューラに任せる」と明記。導入コミットは `6c01694`（2026-11-06、要件決定日の前日）。
- 判定理由: 明示的な禁止事項。リポジトリに unit がある以上、利用者に「同梱された運用機構」と読まれる。ログファイルを `data/` に追記する運用も要件の簡素化と逆行。
- 推奨: **要件に戻す（`systemd/` を削除）**。定期実行が要るなら README に cron の1行例を載せるに留める。優先度は最上位。

#### H4. 取得対象は有報（120）— 乖離

- 実際: `sync` と `import-archive` の既定 `--doc-types` が `120,130,140,150,160,170`（`src/cli.ts:164-168`, `:420-424`）。140/150 は四半期報告書、160/170 は半期報告書。
- 根拠: 抽出側も半期・四半期のコンテキストを解決する（`src/financial/extractor.ts:264-308`: `CurrentYTDDuration`, `CurrentQuarterDuration`, `CurrentYTD...`）。保存先も分岐（E2）。
- 判定理由: 要件は「有報XBRLから」。有報でない書類まで既定で取りに行くのは範囲拡張。API 呼び出し回数・DB 容量・スキーマ分岐のすべてを増やす。
- 推奨: **要件に戻す（既定を `120` のみにし、`financial_summary_periodic` と半期コンテキスト解決を削除）**。ただし E2 の結論として 130 を残す場合は `120,130` までを許容し、要件に明記する。

#### H5. 複数年バックフィル（`--since` / `--until`） — 要件未定義

- 実際: 期間を明示すれば任意の過去期間を同期できる（`src/cli.ts:417-443`）。`--days` の既定は 7。
- 根拠: `README.md:118-119` に使用例あり。
- 判定理由: 要件は「差分 CLI の sync」とのみ定めており、バックフィルを禁止していない。常駐・世代管理を伴わないため、H2 とは矛盾しない。初期データ投入手段として実用的（`import-archive` が使えない環境では唯一の手段）。
- 推奨: **現状維持＋要件に追記**（「sync は期間指定バックフィルを許容する」）。削除する根拠はない。

#### H6. `sync` は証券コードを持つ書類のみ対象 — 要件未定義

- 実際: `reports.filter((r) => r.secCode)` で上場企業等に絞る（`src/cli.ts:464-468`）。
- 判定理由: 投資信託等を除外する妥当な判断だが、要件には「上場企業のみ」と書かれていない。除外した書類は `xbrl_facts` にも入らないため、対象範囲の定義として明文化が必要。
- 推奨: **要件を更新する（「証券コードを持つ上場企業の有報を対象」と明記）**。

### I. その他

#### I1. `import-archive` の存在 — 一致（既定パスは要見直し）

- 根拠: `src/cli.ts:156-252`。`archive.sqlite` から `doc_id` 単位で読み、120 は年次、他は periodic へ入れる（`src/cli.ts:224-230`）。
- 注意: 既定パスが `./data/old/production/duck-financial/daily/2026-11-03/candidate/archive.sqlite`（`src/cli.ts:158-162`）と、特定マシンの旧構成に固定されている。README の「約3,700社分」もこの個人アーカイブ前提（`README.md:60-70`）。
- 判定理由: コマンド自体は要件に含まれる。ただし旧アーカイブのスキーマ（`archive_sources` / `archive_observations` / `archive_contents`）に依存しており、その資産が無い環境では動かない。この worktree には `data/` 自体が無いため実在は未確認。
- 推奨: **現状維持**（要件どおり）。既定値を廃止して `--archive` を必須にするか、README で前提を明記するのが望ましい。

#### I2. 要件外・未使用のコードが残っている — 乖離（簡素化の観点）

- 実際:
  - `FinancialStore.getLatestPeriodEnd()`（`src/db/store.ts:252-259`）— 呼び出し元なし。
  - `EdinetClient.getAnnualReportsInRange()`（`src/edinet/client.ts:111-117`）— 呼び出し元なし。
  - `ScreeningCriteria` の `minOperatingIncomeGrowth` / `minRoa` / `minFcf` / `consolidatedOnly`（`src/types.ts:67-75`）— CLI から指定不可で、`store.ts:380-397` に条件分岐だけ残る。
  - `freeCashFlowPrior`（`src/financial/extractor.ts:179-182`）— 計算するが保存しない（`src/db/store.ts:226` は current のみ）。
- 判定理由: 動かないコードではないが、「7ファイル・小さく保つ」という要件の趣旨に対して負債。読む人に「使われている機能」と誤解させる。
- 推奨: **要件に戻す（削除）**。優先度は低いが、C2/E1 の削除と同時に片付けると安い。

---

## 3. 判断が必要な点（決定リスト）

| #   | 決定事項                        | 選択肢                             | 推奨                                        | 根拠                                   |
| --- | ------------------------------- | ---------------------------------- | ------------------------------------------- | -------------------------------------- |
| 1   | systemd timer を残すか          | 削除 / 現状維持                    | **削除**                                    | 要件が明示的に禁止（H3）               |
| 2   | `xbrl_facts` 全Fact保存を残すか | 削除 / 現状維持 / 要件に追記       | **削除**                                    | 読み出し経路なし・注記禁止と矛盾（E1） |
| 3   | 取得書類の範囲                  | 120のみ / 120+130 / 全種別         | **120のみ**（訂正対応を決めるなら 120+130） | 「有報」に限定（H4）                   |
| 4   | 訂正有報の反映方法              | 年次を上書き / 対象外 / 現状の隔離 | **上書き or 対象外**（隔離は不可）          | 古い数値が残る（E2）                   |
| 5   | `--min-*` フィルタ              | 削除 / 残す                        | **削除**（`--where` に一本化）              | C2, 原則3                              |
| 6   | `facts` コマンド                | 削除 / 残す                        | **削除**                                    | C1, E1                                 |
| 7   | 複数年バックフィル              | 残す / 削除                        | **残す（要件に追記）**                      | 初期投入に有用（H5）                   |
| 8   | 上場企業限定                    | 明文化 / 変更                      | **明文化**                                  | H6                                     |
| 9   | src ファイル数の表記            | 7固定 / 実態に合わせる             | **実態に合わせる**                          | 既にドリフト（B1）                     |
| 10  | 企業同定キー                    | company_name / security_code       | **security_code**                           | 原則2（E3）                            |

---

## 4. 未確認事項

推測で断定しないため、以下は「未確認」として残す。

1. **本番 DB の実サイズと `xbrl_facts` の行数** — この worktree に `data/` が存在しない（`.gitignore` 対象）。E1 の削除効果（容量）は実測できていない。
2. **systemd unit が nuc7 で実際に有効化されているか** — リポジトリに unit がある事実のみ確認。`systemctl is-enabled` 等はこの環境からは未確認。
3. **`archive.sqlite` の実在とスキーマ** — `data/old/...` は存在しない。`import-archive` が現行の archive スキーマで動くかは実データ未確認。
4. **EDINET API が 140/150 を有報と同様に返すか、実データで periodic テーブルに何行入るか** — コード上の対象指定のみ確認。
5. **`@scale` 属性の扱い** — `src/xbrl/parser.ts:105-116` は `scale` を保存するが数値化に適用していない。XBRL（非 iXBRL）では通常 `scale` を使わないため実害は無い想定だが、iXBRL を入力した場合の正しさは未確認。
6. **`xbrl_facts` を用いた将来の分析予定の有無** — リポジトリ内に仕様・Issue としては存在しない。もしリポジトリ外で予定があるなら E1 の判断は変わる。

---

## 5. 推奨アクション（優先順）

1. `systemd/` を削除（H3）
2. `xbrl_facts` 保存と `facts` コマンドを削除（E1, C1, B1 の一部, I2 の一部）
3. `sync` の既定書類種別を `120` に戻し、訂正有報の反映方針を決める（H4, E2）
4. `screen` の `--min-*` を削除し `--where` に一本化（C2）
5. README / ARCHITECTURE を実装に合わせて修正（G2, B1）
6. 企業同定キーを証券コード基準に統一（E3）
7. 未使用コードを削除（I2）

1〜4 は「要件に戻す」、5〜7 は「実装またはドキュメントの整合」。H5/H6 は「要件に追記」で閉じる。

---

## 付録: 確認に使ったコマンド

```bash
git log --oneline --name-status
find src -type f
grep -rn "xbrl_facts|appendFacts|financial_summary_periodic" src
grep -n "\.command(\|\.option(" src/cli.ts
pnpm install --frozen-lockfile
pnpm run build
pnpm run test
```

ビルドとテストは成功（2 files / 3 tests passed）。ただし `facts`・periodic・sync の経路にはテストが無い（`test/` は extractor と store の2ファイルのみ）。
