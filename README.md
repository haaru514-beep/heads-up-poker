# Heads-Up Poker MVP

ログイン、部屋コードでのユーザー対戦、CPU練習、対戦履歴保存ができるヘッズアップポーカーの試作版です。

## 起動

```bash
cd /Users/chun/Documents/Codex/2026-06-26/new-chat/outputs
python3 server.py
```

起動したPCでは `http://localhost:8765` を開きます。

別端末から遊ぶ場合は、同じWi-Fiにつないだうえで、起動したPCのIPアドレスを使って開きます。

例:

```text
http://192.168.1.23:8765
```

## 使い方

1. 各ユーザーがユーザー名とパスワードでログインします。
2. 片方が「ユーザー対戦の部屋を作る」を押します。
3. 表示された部屋コードを相手に伝えます。
4. 相手は部屋コードを入力して参加します。
5. `Deal` で開始します。

CPU練習は「CPU練習を始める」から開始します。

## 保存されるもの

- ユーザー
- ログインセッション
- 部屋
- 対戦結果
- 勝者、モード、部屋コード、ハンド番号

データは同じフォルダの `poker.db` に保存されます。

## 公開URLで使う

ウェブ上で誰でもURLから使えるようにするには、このフォルダをクラウドのWebサービスにデプロイします。

この試作版はDocker対応済みです。Render、Railway、Fly.io、VPSなどの「DockerでWebサービスを起動できる場所」に置けます。

必要な起動設定:

```text
Start command: python server.py
Port: 8765
Environment:
  HOST=0.0.0.0
  PORT=8765
  DATA_DIR=/data
  ADMIN_PASSCODE=好きな管理者パスコード
```

Renderに置く場合は、このフォルダの `render.yaml` を使えます。現在の設定はカード登録なしで試しやすいように、データ保存先を `/tmp` にしています。

注意: `/tmp` は再起動や再デプロイで履歴が消える可能性があります。本番運用で履歴を残す場合は、RenderのPersistent Diskを追加して `DATA_DIR=/data` に変更してください。

管理者画面はロビーの「管理者」から入ります。RenderのEnvironment Variablesで `ADMIN_PASSCODE` を設定すると、そのパスコードで大会部屋を作成できます。未設定の場合は `admin1234` です。

公開後は、発行されたURLを知っている人がログイン画面にアクセスできます。ユーザー名とパスワードを入力するとアカウントが作られ、対戦履歴はサーバー側の `poker.db` に残ります。
