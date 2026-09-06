# リアルタイム4択クイズ大会アプリ

会場型のリアルタイム4択クイズアプリ。参加者はスマートフォンでQRコードから参加し、A〜Dの4択で回答する。管理者はPCから進行を操作し、会場モニターに問題・メディア・ランキングを表示する。

## 1. 技術スタックと採用理由

| 分類 | 採用technology | 理由 |
|---|---|---|
| フロントエンド | React + TypeScript + Vite | 要件で指定。Viteは開発サーバー起動が高速で、3画面(管理者/参加者/モニター)をルーティングで切り替えやすい |
| バックエンド | Python + FastAPI | 要件で指定。非同期WebSocketとRESTを同一プロセスで扱いやすい |
| DB | PostgreSQL + SQLAlchemy 2.0 | 要件で指定。ORMはSQLAlchemyを採用し、モデル定義とクエリを型安全に記述 |
| リアルタイム通信 | 標準WebSocket (FastAPI組み込み) | 要件で指定。追加のブローカー(Redis等)なしでも200人程度の規模なら単一プロセスで対応可能なため、まずシンプルな実装を採用 |
| 認証 | 自前JWT (python-jose) | 小規模運用向けに、管理者パスワード1つ+JWLトークンというシンプルな方式を採用。参加者にも「なりすまし防止」のためのJWTを発行 |
| メディア保存 | ローカルディスク (将来S3へ移行可能な抽象化) | 開発初期はローカル保存、`MediaStorage`インターフェースを介しているため`S3MediaStorage`実装を追加するだけで移行可能 |
| QRコード生成 | `qrcode.react` (フロントエンド) | サーバー側で画像生成する必要がなく、参加URLの文字列だけあればクライアントで表示できるため |
| コンテナ | Docker / Docker Compose | 要件で指定 |

## 2. プロジェクト構成

```
quizapp/
├── docker-compose.yml
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPIアプリ起動・ルーター登録
│   │   ├── config.py          # 環境変数設定
│   │   ├── database.py        # SQLAlchemy接続
│   │   ├── models.py          # DBモデル(Event/Question/Choice/Participant/Answer)
│   │   ├── schemas.py         # Pydanticスキーマ
│   │   ├── security.py        # JWT発行・検証(管理者/参加者)
│   │   ├── storage.py         # メディアストレージ抽象化(local/S3)
│   │   ├── ws_manager.py      # WebSocket接続管理・ブロードキャスト
│   │   ├── quiz_state.py      # ロール別状態組み立て・ランキング集計
│   │   └── routers/
│   │       ├── admin_auth.py  # 管理者ログイン
│   │       ├── events.py      # 大会CRUD
│   │       ├── questions.py   # 問題CRUD・並び替え
│   │       ├── media.py       # メディアアップロード
│   │       ├── participants.py# 参加者登録(join)
│   │       ├── quiz.py        # 進行操作・回答送信・状態取得
│   │       └── ws.py          # WebSocketエンドポイント
│   ├── scripts/load_test.py   # 200人同時接続を想定した負荷テストスクリプト
│   ├── requirements.txt
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── AdminLogin.tsx / AdminDashboard.tsx / AdminEvent.tsx / QuestionForm.tsx
    │   │   ├── Join.tsx        # 参加者名入力
    │   │   ├── Play.tsx        # 参加者回答画面
    │   │   └── Monitor.tsx     # 会場モニター画面
    │   ├── api.ts              # REST APIクライアント
    │   ├── useEventSocket.ts   # WebSocket接続・自動再接続フック
    │   ├── useCountdown.ts     # サーバー時刻基準のカウントダウン
    │   └── participantSession.ts
    ├── package.json
    └── Dockerfile
```

## 3. DB設計

```
events(id, name, status, current_question_id, phase, answer_started_at, answer_deadline, created_at)
questions(id, event_id, question_number, question_text, question_media_type, question_media_url,
          time_limit_seconds, correct_choice, is_practice, created_at, updated_at)
choices(id, question_id, choice_key[A-D], content_type[TEXT/IMAGE/VIDEO], text, media_url)
participants(id, event_id, name, joined_at)
answers(id, participant_id, question_id, choice, answered_at, response_time_ms, is_correct)
  UNIQUE(participant_id, question_id)  -- 二重回答防止
```

- `status`: CREATED → RUNNING → FINISHED (WAITINGは将来の待機ロビー用に予約、現行UIでは未使用)
- `phase`: NOT_STARTED → QUESTION_SHOWN → ANSWER_OPEN → ANSWER_CLOSED → ANSWER_COUNT_SHOWN → CORRECT_ANSWER_SHOWN → RANKING
  - `ANSWER_COUNT_SHOWN`: 回答受付終了後、各選択肢の回答人数を会場モニターに表示(正解はまだ非公開)
  - `CORRECT_ANSWER_SHOWN`: 正解を会場モニターに発表
- `is_practice`: 練習問題フラグ。1大会につき1問のみ登録可能(`question_number=0`を予約)。ランキング集計・参加者の正解数集計からは除外される。
- 回答時間は `response_time_ms`(整数ミリ秒)で保存。`answered_at - answer_started_at` をサーバー時刻で計算。

## 4. API一覧

### 公開/参加者向け
| Method | Path | 内容 |
|---|---|---|
| GET | /api/events/{event_id} | 大会の基本情報 |
| POST | /api/events/{event_id}/join | 参加登録(参加者トークン発行) |
| GET | /api/events/{event_id}/state?role=monitor\|participant | 現在状態の取得(再接続時の復元用) |
| POST | /api/events/{event_id}/answer | 回答送信(要参加者トークン) |
| GET | /api/time | サーバー時刻取得(クロックずれ補正用) |

### 管理者向け(要Bearerトークン)
| Method | Path | 内容 |
|---|---|---|
| POST | /api/admin/login | 管理者ログイン |
| POST | /api/admin/events | 大会作成 |
| GET | /api/admin/events | 大会一覧 |
| GET | /api/admin/events/{id} | 大会詳細 |
| GET/POST/PUT/DELETE | /api/admin/events/{id}/questions[/{qid}] | 問題CRUD |
| PUT | /api/admin/events/{id}/questions/reorder/apply | 問題並び替え |
| POST | /api/admin/media/upload | メディアアップロード |
| POST | /api/admin/events/{id}/next | 次の問題へ |
| POST | /api/admin/events/{id}/next-and-start-answer | 次の問題へ＋回答開始をまとめて実行 |
| POST | /api/admin/events/{id}/start-answer | 回答開始 |
| POST | /api/admin/events/{id}/show-answer-count | 各選択肢の回答人数を表示(正解は非公開) |
| POST | /api/admin/events/{id}/show-correct-answer | 正解を発表 |
| POST | /api/admin/events/{id}/show-ranking | ランキング表示 |
| GET | /api/admin/events/{id}/ranking | ランキングプレビュー |
| GET | /api/admin/events/{id}/state | 管理画面用の詳細状態 |

## 5. WebSocketイベント

`ws://<host>/ws/events/{event_id}?role=monitor|participant|admin[&token=...&participant_id=...]`

- 接続直後にサーバーが現在状態(`type: state_sync`)を送信。以降、以下の操作の都度、該当ロールへ最新状態を再送信する。
  - 次の問題へ(question_shown)
  - 回答開始(answer_open、`answer_deadline`を含む)
  - 制限時間経過による自動締切(answer_closed)
  - 回答人数表示(answer_count_shown、選択肢ごとの回答人数`answer_counts`を含む。正解はまだ非公開)
  - 正解発表(correct_answer_shown、正解キー`correct_choice`を含む)
  - ランキング表示(ranking)
- 管理者ロールのみ、回答が届くたびに軽量な`answer_count_update`メッセージも受信する。
- 参加者ロールへの状態には、自分自身の確定正解数(`correct_count`)も個別に計算して含まれる(他人の正解数は一切送らない)。
- カウントダウンはサーバーからの`answer_deadline`/`server_time`を基準にクライアント側で計算表示する(信頼できる基準はサーバー時刻)。

## 6. 画面一覧

1. `/admin/login` 管理者ログイン
2. `/admin` 大会一覧・作成
3. `/admin/events/:id` 大会管理(問題管理タブ / クイズ進行タブ / QRコードタブ)
4. `/join/:eventId` 参加者名入力
5. `/play/:eventId` 参加者回答画面(問題文+A〜Dボタンのみ)
6. `/monitor/:eventId` 会場モニター(問題・メディア・カウントダウン・ランキング)

## 7. セキュリティ

- 管理者APIはすべて `Authorization: Bearer <JWT>` 必須(`require_admin`)。パスワードは環境変数`ADMIN_PASSWORD`。
- 参加者は`join`時に`participant_id`(UUID)とは別に署名付きJWTを受け取り、回答APIはこのJWT内の`participant_id`とリクエストボディの`participant_id`が一致しない場合`403`を返す(他人へのなりすまし防止)。
- 名前はユーザーIDとして使用しない。参加者ごとに`UUID`を発行し、同名でも別participant扱い。
- 回答受付終了・重複回答は必ずサーバー側で判定(`answer_deadline`比較、DBのUNIQUE制約)。
- 管理者用WebSocket接続もトークン必須。

## 8. 起動方法

### Docker Composeで起動(推奨)

```bash
docker compose up -d --build
```

- フロントエンド: http://localhost:5173
- バックエンドAPI: http://localhost:8000/api/health
- 初回起動時にPostgreSQLへテーブルが自動作成されます(`Base.metadata.create_all`)。
- 管理者パスワードの初期値: `admin123` (docker-compose.yml内の`ADMIN_PASSWORD`で変更可能)

停止:

```bash
docker compose down
```

DBデータを含めて完全に削除する場合:

```bash
docker compose down -v
```

### ローカル(Dockerを使わない場合)

```bash
# PostgreSQLを別途起動しておく
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# 別ターミナル
cd frontend
npm install
npm run dev
```

## 9. 動作確認の流れ(完成条件の再現手順)

1. http://localhost:5173/admin/login で `admin123` を入力してログイン
2. 大会を作成 → 「問題管理」タブで最大10問登録(画像・動画・テキストの選択肢を組み合わせ可能)
3. 「QRコード」タブでQRコードと参加URLを確認
4. 複数のブラウザ/シークレットウィンドウから参加URLを開き、名前を入力して参加(同じ名前で複数参加してもOK)
5. `/monitor/{eventId}` を別ウィンドウ(会場モニター役)で開く
6. 「クイズ進行」タブで「次の問題へ」→ 全画面が切り替わることを確認
7. 「回答開始」→ 参加者・モニターでカウントダウンが同期して表示される
8. 参加者がA〜Dのいずれかをタップ→「回答を受け付けました」表示、再タップ不可
9. 制限時間終了で自動的に回答受付終了(管理者が何もしなくても締切られる)
10. 「回答人数を表示」→ モニターに選択肢ごとの回答人数が表示される(正解はまだ非公開)
11. 「正解を発表」→ モニターに正解の選択肢がハイライト表示される
12. 「ランキング表示」→ モニターに上位5人が表示される
13. 参加者画面や管理者画面のWebSocketを開発者ツールで切断→自動的に再接続し、現在の状態に復元されることを確認

## 10. テスト方法

`backend/tests` に想定される主要ケース(pytest未導入のため手動/スクリプトでの検証手順を記載):

- 正解/不正解/未回答: 複数参加者で異なる選択肢を回答し、`/api/admin/events/{id}/ranking` で正答数が正しいことを確認
- 制限時間直前・終了後の回答: `answer_deadline` 直前と直後にリクエストを送り、直後は`accepted:false`になることを確認
- 二重回答: 同じ`participant_id`で同じ問題に2回POSTし、2回目が`accepted:false`("既に回答済みです")になることを確認
- 同名参加者: 同じ名前で2回joinし、`participant_id`が異なることを確認
- 途中参加: 回答受付中に新規joinし、その参加者の回答時間が「参加時刻」ではなく`answer_started_at`基準で計算されることを確認
- WebSocket切断/再接続: 開発者ツールのネットワークタブでWS接続をブロック→解除し、自動再接続後に最新状態が届くことを確認
- ランキング同点: 正答数が同じ参加者同士で回答時間合計を比較し、短い方が上位になることを確認
- 画像/動画選択肢: 問題登録時にIMAGE/VIDEOを選択し、モニターにのみメディアが表示され、参加者画面には表示されないことを確認

負荷テスト(Phase 11、200人同時接続想定):

```bash
cd backend
python scripts/load_test.py --base-url http://localhost:8000 --event-id <大会UUID> --num-participants 200
```

実行後、管理者画面から「次の問題へ」→「回答開始」を押すと、全シミュレート参加者が同時に回答を送信し、末尾に接続成功数・回答成功数・平均レイテンシが出力されます。

## 11. ランキング仕様の明記(要件24)

- 集計は`participant_id`単位で行う(同名でも別集計)。
- 第1優先: 正答数が多い順。
- 第2優先: 正答数が同じ場合、正解した問題の回答時間合計(ミリ秒)が短い順。不正解・未回答の問題の時間は合計に含めない。
- 上記もすべて同じ場合は`participant_id`の文字列順で安定した順序にする(順位が変動しないようにするため)。

## 12. 実装フェーズと進捗

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | プロジェクト作成・Docker Compose起動 | 完了 |
| 2 | 大会作成・問題登録 | 完了 |
| 3 | 参加者登録・QRコード | 完了 |
| 4 | 参加者画面・会場モニター画面 | 完了 |
| 5 | クイズ進行(次の問題/回答開始/制限時間/受付終了) | 完了 |
| 6 | 回答保存・採点 | 完了 |
| 7 | WebSocketによるリアルタイム同期 | 完了 |
| 8 | ランキング | 完了 |
| 9 | 画像・動画対応 | 完了 |
| 10 | 通信切断・再接続対応 | 完了 |
| 11 | 200人同時接続を想定した負荷テスト | スクリプト用意(実環境での大規模実行は未実施) |
| 12 | 練習問題・回答人数表示・正解発表フェーズの追加 | 完了 |

## 13. 既知の制約・残課題

- WebSocket接続は単一プロセスのメモリ上で管理しているため、`uvicorn`を複数ワーカー/複数インスタンスでスケールする場合はRedis Pub/Sub等の共有ブローカーへの置き換えが必要。
- 自動テスト(pytest)は未整備。手動確認手順を本READMEに記載。
- 管理者認証は単一パスワード方式。複数管理者・ロール分離が必要な場合はユーザーテーブルの追加を推奨。
- S3ストレージは抽象化のみ実装済みで、実際のアップロード処理(boto3連携)は未実装。
- 大会の「WAITING」状態(受付待機ロビー画面)は状態遷移としては用意しているが、専用UIは未実装(必要以上に複雑化させないための判断)。
