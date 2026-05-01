# AI Chat UI

授業での利用を想定した、ログイン不要の軽量チャットUI（フロント：静的HTML/CSS/JS、バックエンド：Node.js/Express）。サーバー側で OpenAI / Gemini 等のAPIキーを管理し、フロントエンドからは直接APIキーにアクセスしません。

**主な内容**
- フロントエンド: `frontend/` (静的ファイル)
- バックエンド: `backend/` (`server.js`, `llmClient.js`)
- コンテナ: `Dockerfile`, `docker-compose.yml`, `Caddyfile`（HTTPS 配信用）

## 要件
- Node.js 18+ 推奨
- npm 利用

## セットアップ（ローカル）

1. 依存関係をインストール

```bash
npm install
```

2. `.env` または環境変数を設定

必須（利用するプロバイダによる）:
- `OPENAI_API_KEY` または `GEMINI_API_KEY`

主なオプション:
- `LLM_PROVIDER` — `openai` または `gemini`（未指定なら自動判定）
- `OPENAI_MODEL` / `GEMINI_MODEL` — 既定: `gpt-4o-mini` / `gemini-2.5-flash`
- `ALLOWED_ORIGIN` — フロントエンドの起点（例: `http://localhost:3000` または本番ドメイン）
- `PORT` — サーバーの待ち受けポート（既定: `3000`）
- `ENABLE_MODEL_SWITCH` — `true` にすると `/api/models` でモデル切替が有効
- `ALLOWED_MODELS` — カンマ区切りで許可するモデル
- `USE_MOCK_LLM` — `true` にすると LLM 呼び出しを行わずモック応答を返す

例（ローカル）:

```bash
PORT=3000
ALLOWED_ORIGIN=http://localhost:3000
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
ENABLE_MODEL_SWITCH=true
ALLOWED_MODELS=gpt-4o-mini,gpt-4.1
```

3. サーバー起動

```bash
npm start
# or 開発中は
npm run dev
```

ブラウザで `http://localhost:3000` を開くとフロントが表示されます。

## Docker Compose + Caddy（本番向け）

`docker-compose.yml` と `Caddyfile` を利用して HTTPS 配信が可能です。`.env` に本番の `CADDY_DOMAIN` / APIキー等を設定し、次で起動します:

```bash
docker compose up -d --build
```

Caddy が TLS を担当し、バックエンドはコンテナ内部で `3000` を利用します。

## API（バックエンド）

- `GET /api/health` — サービス稼働確認
- `GET /api/models` — 利用可能なモデル情報（`ENABLE_MODEL_SWITCH` が有効なら切替情報を含む）
- `POST /api/chat` — チャット用エンドポイント

`POST /api/chat` のリクエスト例:

```json
{
	"message": "こんにちは",
	"history": [],
	"model": "gpt-4o-mini",
	"outputFormat": "plain"
}
```

レスポンス例:

```json
{
	"reply": "こんにちは！どうしましたか？",
	"outputFormat": "plain",
	"model": "gpt-4o-mini",
	"provider": "openai"
}
```

`outputFormat` は `plain`（既定、Markdownを軽く除去）または `rich`（モデルの生出力）を指定できます。

## モック実行

`USE_MOCK_LLM=true` を設定すると、外部LLMにアクセスせずに簡易応答を返します。UIの動作確認に便利です。

## トラブルシュート

- ポート競合: `npm stop`（`package.json` の `stop` スクリプトは `npx kill-port 3000`）または Windows の場合は `netstat -ano | findstr :3000` → `taskkill /PID <PID> /F`。
- APIキー未設定時は `llmClient.js` 側でエラーになります。ローカルで確認する場合は `USE_MOCK_LLM=true` を推奨。

## 開発メモ

- フロント実装: `frontend/index.html`, `frontend/app.js`, `frontend/style.css`
- バックエンド: `backend/server.js`（Express）、`backend/llmClient.js`（OpenAI/Gemini 判定と呼び出し）
- スクリプト: `start`, `dev`, `stop` は `package.json` に定義

---

必要であれば、README に「デプロイ手順」「環境ごとの .env サンプル」「運用上の注意（ログ保存・個人情報）」を追記できます。追加希望があれば教えてください。
