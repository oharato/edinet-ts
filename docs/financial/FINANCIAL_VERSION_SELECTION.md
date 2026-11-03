# 原本根拠で添付金融版を選ぶ

公式metadataだけでは直接兄弟の訂正2件を一意に選べない場合に、親・全兄弟の原XML、添付全文ZIP、完全な公式観測を再認証して、一つの添付金融原本を選ぶ明示opt-in APIです。通常の`selectDocumentVersions`、`createObservedFinancialSnapshots`、archiveの通常経路は変更しません。原本の財務値を親や兄弟から合成しません。

現段階は私有世代の検証用です。金融版の採用、全原値の独立検証、公開承認は別の判断であり、**indexVersion2のpublicationは禁止**しています。

## 対象とする形

固定policyは`FINANCIAL_VERSION_POLICY`（`whole-attached-asr-q2r-v1`）です。現在のprofileは次の形だけに対応します。

- 同じ公式parentを持つ原提出1件＋直接兄弟2件。原提出の回数1、訂正の回数2→3が一意・連続し、公式提出順も一致する。
- J-GAAP・Consolidated・同一issuer/security/基準/範囲/期間/様式。rootの公式formが030000・docType120ならFY/第三号様式、043A00・docType160ならHY/Q2/第四号の三様式。
- 親の完全なraw XBRLと、全兄弟のraw XBRLが取得済み。各訂正leafはraw ZIP、公式PublicDoc manifestの全inline member、添付表紙・honbun・訂正本文を確認できる。
- 公式namespace/context/entityに束縛されたDEI、回数、単一の訂正target=root、訂正種別、ZIP filename/role、rootの縦覧状態1と系列の公開・取下げ・編集状態が整合し、必要な全観測・原本・ZIPがcutoffまでに利用可能。

第五号様式、第三兄弟、連結/単体や基準の混在、未知状態、競合、欠落、期間や回数の不一致などは`held`です。未知policy・不正manifest pin・未認証tokenは例外で拒否し、通常選択へ黙って戻しません。現profile外をsubmission番号や金額の一致だけで認証しません。

添付全文の認証は、公式manifestが宣言するmember集合と当該formに対する運用的な完全性確認です。PDF/rendered semanticsや、提出者の全記載が正しいことを保証しません。`XBRLAmendmentFlagDEI=false`も、金額不変・親の値を継承してよいという指示には使いません。

## 入力の保存と再認証

`FinancialVersionEvidenceInput`は`cutoff`、完全な公式`observations`、原XMLの`sources`、raw ZIPの`evidence`です。各sourceは`docID/sourceSha256/availableAt/xml`、ZIPは`docID/sha256/receivedAt`と`path`またはruntimeの`Uint8Array bytes`を渡します。

archiveの通常観測保存はsemantic projectionであり、公式行のformCode/legalStatusなどを落とします。完全な公式行のsidecarとraw原XML・ZIPの永続locatorは呼出元が保存してください。このAPIはHTTP取得やevidence保管サービスを開始しません。保存したreceipt/JSON proofだけから認証tokenを復元することもできません。ZIPのpathとruntime bytesは同時には指定しません。

入力上限は観測10,000件、原XML/ZIP宣言各100件です。原XMLは64MiB/件・合計256MiB、ZIPの圧縮bytesも64MiB/件・合計256MiBまでです。公式metadataはflatなscalar行・合計16MiBまでで、ZIP展開は既存`ZIP_LIMITS`に従います。全市場を一つのbundleへ無制限に読み込む入口ではありません。

`financialVersionEvidenceManifestSha256`は宣言集合の指紋を計算します。初回準備で固定したmanifest SHAをbuild inputへpinし、再開時に現在の入力から新しい値を計算して無条件に置換しないでください。原XMLと全raw ZIPのbyte hashは認証時・使用時に別途再検査します。未知namespaceの候補を除外して既知候補だけを選ぶことはしません。

```ts
import {
  FINANCIAL_VERSION_POLICY,
  authenticateFinancialVersionEvidence,
  financialVersionEvidenceManifestSha256,
  verifyFinancialVersionContext,
  createSourceBackedObservedFinancialSnapshots,
} from 'edinet-ts';

// inputは呼出元が永続保管した完全公式観測/raw原XML/raw ZIPから読み込む。
if (financialVersionEvidenceManifestSha256(input) !== pinnedManifestSha256) {
  throw new Error('Pinned evidence changed');
}
const bundle = { ...input, evidenceManifestSha256: pinnedManifestSha256 };
const context = await authenticateFinancialVersionEvidence(bundle);
const binding = { context, bundle };
const proof = verifyFinancialVersionContext(context, bundle);
const result = createSourceBackedObservedFinancialSnapshots(binding, {
  policy: FINANCIAL_VERSION_POLICY,
  evidenceManifestSha256: pinnedManifestSha256,
  detailMetricIds: ['costOfSales'],
});
```

contextは同process・同SDK moduleで認証したopaque tokenです。`JSON.parse(JSON.stringify(context))`や型castはWeakMap登録を付与しないため、使用時の検査に失敗します。`readFinancialVersionProof(context)`の返却値は記録用cloneであり、認証能力ではありません。process再起動後はraw根拠を読み直して`authenticateFinancialVersionEvidence`を再実行します。readonly配列入力も受け、内部はindex capture/deep copyで固定します。

## metadataと金融判断を分けて読む

`result.metadataSelection`は元のmetadata-only未解決を保持します。`financialVersionSelection`は`selected-source`またはtyped `held`、`selection`は金融原本を採用するためのeffective selectionです。元metadataが解決したと表示し直しません。

採用されたrecordには`financialVersionDecisionSha256`と`financialVersionEvidenceSha256`が付き、`chainDocIDs`は公式parentどおりroot→chosenです。兄弟を偽の線形chainへ付け替えません。`knownAt`とcausal observationIdsには、採らなかった兄弟も含む必要な全根拠を反映します。提出日時やDEIのinstantへ過去に遡らせません。

chosen一原本の直接抽出には通常と同じissuer/security/期間/基準/scope/単位/訂正target等の検査を適用します。欠損は欠損のまま保持し、親・兄弟のfactで埋めません。

## ArchiveとindexVersion2

```ts
const options = {
  cutoff: bundle.cutoff,
  extractorVersion: 'financial-details-1', // 通常の純粋抽出と同じ契約
  detailMetricIds: ['costOfSales'] as const,
  financialVersion: {
    policy: FINANCIAL_VERSION_POLICY,
    evidenceManifestSha256: pinnedManifestSha256,
  },
};
const snapshots = archive.createSourceBackedSnapshots(options, binding);
const generation = index.materializeSourceBacked(
  'private-source-backed', archive, options, binding,
);
```

archiveにある全対象観測のprojectionとfull sidecar、cutoff内の全兄弟source/証拠を照合します。部分的なbundleで第三兄弟や競合を隠しません。通常の`createSnapshots`とは専用入口を分け、既存の一原本解析cacheを同じkeyで再利用します。policy/proof SHAを`extractorVersion`文字列へ埋めません。

新世代は`indexVersion === '2'`で、metadata/financial別decisionと証拠を通常writerのtransactionで保存します。defaultの`FINANCIAL_SEARCH_INDEX_VERSION`は1のままです。同じDBで旧v1世代を読めますが、未変更の旧readerはv2のgeneration/quality/screenを拒否します。旧readerをpatchしてv2を読ませないでください。通常v1 writerへ金融版markerを剥がして保存する経路も拒否します。

## 会社別checkpointと再開の3 pin

`FinancialIndexBuildInput.options.financialVersion`へ次の3値を固定します。

```ts
financialVersion: {
  policy: FINANCIAL_VERSION_POLICY,
  evidenceManifestSha256: pinnedManifestSha256,
  proofSha256: proof.sha256,
}
```

さらに既存のarchive SHA・cutoff・抽出版・source commit・母集団を固定します。`state.begin(input)`で計画を保存し、会社別処理は次のようにruntime bindingを別引数へ渡します。opaque tokenをplan JSONへ入れません。

```ts
const progress = state.runNext(input.id, archive, index, {
  limit: 1,
  financialVersion: binding,
});
// pending/failedが残る間はfinishしない。次processではrawを再認証する。
if (progress.pending === 0 && progress.failed === 0) {
  const aggregate = state.finish(input.id, index);
}
```

再開時は同じraw根拠を再認証し、policy/manifest/proofの3 pinがすべて一致するcontextだけを使います。古い兄弟の後取得、観測/ZIP/source/時刻の変更も指紋・knownAtへ反映し、既存checkpointへ別proofを混在させません。archiveは書込を閉じたreadOnly snapshotを使い、既存の排他・容量guard・abort/transaction境界を維持します。

repo-localの`withFinancialBuildSession`も`financialVersion: binding`を受け、3 pinを確認して既存の会社別batchへ渡します。session helperはrawの自動取得・JSON token復元・publicationを行いません。失敗を無限retryせず、boundedなbatchでcheckpointを確認します。

## 品質と公開の境界

qualityの`selectionDecisions`は元metadataを数え、未解決を残します。v2だけの`financialVersionDecisions`で金融判断のselected/heldを別に数えます。行・usable値・欠損は採用原本の実結果です。金融判断の成功でmetadataの曖昧さや値の欠損を0へ上書きしません。

版選択の独立Pythonは全raw ZIP/member/DEI/観測/時刻/指紋を再検査し、原値の独立verifierは別に全採用値を照合します。片方の成功で他方を代用しません。両検証が成功しても、現在の`FinancialIndexPublication.prepare/prepareAsync/activate/activateAsync`はv2を拒否します。緩い品質policyでも公開できません。

## 実データの確認範囲

既存4系列・3社でchosen4原本、会社別partから8集約行を作成しました。全duration13項目＋BS3項目の64選択は58selected/6missingで、欠損を補完していません。親・全兄弟12原XML、8 raw ZIP・313 member、元metadata未解決4と金融selected4、58採用値/70一致factを独立に確認しています。通常metadata-onlyでは依然4系列が未解決です。

原本・ZIPの閉包は観測済み入力/固定archiveに対するもので、市場全体の最新性や未観測の兄弟が存在しないことを証明しません。親ZIPまで含むすべての提出文書の意味、PDF全表示、対象外form/基準/scopeを一般的に認証する機能でもありません。検証世代・元入力・旧v1世代は区別して保持し、公開は行いません。
