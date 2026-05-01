# リポジトリを初回プッシュする手順

以下はローカルのこのディレクトリを GitHub（または任意のリモート）へ初回プッシュする最小手順です。`USERNAME/REPO` を自分のリポジトリに置き換えてください。

SSH を使う場合:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:USERNAME/REPO.git
git push -u origin main
```

HTTPS を使う場合:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

注意点:
- リモートリポジトリは事前に GitHub 上で作成しておいてください（README だけ作成するか空のリポジトリ）。
- `git push` が拒否される場合は、リモート側の既存ブランチ（例: `main`）との競合が考えられます。その場合はリモートの履歴を確認してください。
- 公開リポジトリにプッシュする前に、`README.md` や `.gitignore` に不要な秘密（APIキー等）が含まれていないか再確認してください。

必要なら、`.github/workflows/` に CI を追加したり、`CODEOWNERS` を設定する手伝いもできます。希望があれば教えてください。
