# 固定配布物の検証記録（2026-10-10）

状態: 過去の検証記録。現在のライブラリhead・runtime・全データの検証結果ではない。[現行手順](../nuc7-local-artifacts.md) と区別する。

- 固定source: `6301b404a5d09fec0c5ad10b2796e95ac64bd4e9`
- 配布物SHA-256: `1c1e35c0348d24e1dbfc65d7586f6a9e5d1496ca1cfba49c9221e87c4c32f048`
- 当時のtoolchain: Node v24.13.0 / npm 11.6.2、linux-x64。
- 固定sourceのbuild、13ファイル/207テスト、保存保護5テストが成功。
- 配布物40メンバーを照合。private stagingのumaskによりtarの0600/0644差が生じたため、pack対象のmodeのみ正規化し、最終170,084 bytesと期待hashが一致した。
- ローカル世代/currentを作成。公開、定期実行、既存公開物削除は行っていない。

この記録を新しいsource/runtimeの互換性保証として使用しない。利用先更新は固定commit・hash・provenanceを改めて検証する。
