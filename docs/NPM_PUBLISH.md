# npmパブリッシュ運用の手順

本ライブラリ `edinet-ts` を npm に公開（リリース）するための手順書です。

## 前提条件

*   npm アカウントを持っていること
*   npm にログイン済みであること (`npm login`)
*   メンテナー権限を持っていること
*   GitHubリポジトリの Secrets に `NPM_TOKEN` が設定されていること

## 自動化（実装済み）

`package.json` のバージョン変更を検知して、自動的にタグ作成・リリース・npm公開を行うワークフローを設定しました。

### 運用フロー

1.  ローカルで開発を行う。
2.  リリース準備ができたら、`package.json` のバージョンを更新する（手動またはコマンド）。
    ```bash
    npm version patch # or minor, major
    ```
    ※ `git push` は自動生成されるタグと競合しないように注意してください。`npm version` はデフォルトでタグを作ってしまいますが、`npm version patch --no-git-tag-version` を使うか、あるいはタグを作ってもプッシュせずにバージョン変更コミットだけをプッシュすればOKです。
    
    **推奨手順**:
    ```bash
    # 1. バージョンだけ上げる（タグは作らない、または作ってもプッシュしない）
    npm version patch --no-git-tag-version
    
    # 2. 変更をコミット
    git add package.json
    git commit -m "Bump version"
    
    # 3. masterへプッシュ
    git push origin master
    ```

3.  GitHub Actions が自動的に以下を行います：
    *   バージョン重複チェック（既にタグがあればスキップ）
    *   Gitタグ (`v0.0.x`) の作成
    *   ビルド & テスト
    *   npm 公開
    *   GitHub Release 作成（リリースノート自動生成）

### 手動リリースの手順（フォールバック）

自動化が失敗した場合などは、手動でリリースを行ってください。

1.  テスト & ビルド:
    ```bash
    npm test
    npm run build
    ```
2.  バージョン更新 & タグ付け:
    ```bash
    npm version patch
    ```
3.  npm 公開:
    ```bash
    npm publish
    ```
4.  Gitプッシュ:
    ```bash
    git push origin master --tags
    ```


