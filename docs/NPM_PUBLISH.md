# npmパブリッシュ運用の手順

本ライブラリ `edinet-ts` を npm に公開（リリース）するための手順書です。

## 前提条件

*   npm アカウントを持っていること
*   npm にログイン済みであること (`npm login`)
*   メンテナー権限を持っていること
*   **npm側で Trusted Publishing (GitHub Actions連携) の設定が完了していること**

## 初期設定: Trusted Publishing (推奨)

npm の「2要素認証(2FA)を回避するリスク」警告を解消し、より安全に自動デプロイを行うための設定です。

1.  [npm website](https://www.npmjs.com/) にログインします。
2.  パッケージのページ (`edinet-ts`) または自分のプロフィールから「Access」または「Publishing Access」設定を開きます。
3.  **"Connect a new account"** (または "GitHub Actions") を選択します。
4.  このGitHubリポジトリ (`oharato/edinet-ts`) を接続します。
5.  設定が完了すると、GitHub Actions からの公開リクエストが信頼され、`NPM_TOKEN` シークレットを使わずに安全に公開できるようになります。

※ 従来通り `NPM_TOKEN` シークレットを使う場合は、Token生成時に "Automation" タイプを選べば2FAをバイパスできますが、npmからは推奨されていません。

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


