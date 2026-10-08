# npmパブリッシュ運用の手順

本ライブラリ `edinet-ts` の公開は、GitHub Actions の **Manual Release** を明示的に実行したときだけ行います。`master` への push・PR の作成・マージ・バージョン変更だけでは公開されません。

## 前提条件

- このリポジトリで GitHub Actions を手動実行できる権限があること
- npm 側で、このリポジトリの `.github/workflows/auto-release.yml` に対する Trusted Publishing の設定が完了していること
- GitHub Packages への公開に必要な既存のリポジトリ設定が有効であること

ワークフローのファイル名は Trusted Publishing の設定との互換性のため変更しません。npm は既存の OIDC、GitHub Packages は既存の `GITHUB_TOKEN` を使用します。

## 手動リリースの手順

1. リリースする変更をレビューし、バージョン更新を PR に含めます。タグは作らず、ロックファイルも更新します。

   ```bash
   npm version patch --no-git-tag-version # 必要に応じて minor / major
   git add package.json package-lock.json
   ```

2. PR を `master` にマージし、公開対象コミットの **Test and Build** が成功していることを確認します。この段階では公開されません。
3. `master` の `package.json` のバージョンと、対応する `v<version>` タグを確認します。タグが既にあれば、このワークフローは既存の公開処理をすべてスキップします。
4. GitHub の **Actions → Manual Release → Run workflow** を開きます。
   - Branch は **master** を選びます。他のブランチ・タグからの実行はジョブ全体がスキップされます。
   - `version` に、公開する `package.json` のバージョンを **v を付けずに**入力します。完全一致しなければ、タグ作成・公開前に失敗します。
   - 対象とバージョンを確認して **Run workflow** を実行します。この操作が公開の開始です。
5. 実行結果と、GitHub Release・npm・GitHub Packages の各公開先を確認します。

手動実行後は、従来と同じ順序で依存関係のインストール、テスト、ビルド、タグ作成、GitHub Release 作成、npm 公開、GitHub Packages 公開を行います。npm のパッケージ名は `edinet-ts`、GitHub Packages は `@oharato/edinet-ts` です。

## 失敗・再実行時の注意

- 同じバージョンの実行を重複して開始しないでください。
- タグが作られた後に公開が失敗した場合、単純な再実行ではタグ重複チェックにより公開がスキップされます。まず各公開先の状態とログを確認し、未完了の公開だけを個別に判断してください。
- 復旧のために既存タグや公開済みパッケージを削除したり、確認なしに再公開したりしないでください。
