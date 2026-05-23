# WordPress自動下書き投稿の設定

`articles/` 配下の記事Markdownを `main` にpushすると、GitHub ActionsがWordPress REST APIへ下書きとして保存します。画像がリポジトリに存在する場合は、記事の先頭画像をメディアライブラリへアップロードし、アイキャッチ画像に設定します。

## GitHub Secrets

リポジトリの `Settings > Secrets and variables > Actions` に次のSecretsを登録してください。

| Secret | 内容 |
| --- | --- |
| `WP_BASE_URL` | WordPressサイトURL。例: `https://example.com` |
| `WP_USERNAME` | WordPressの投稿ユーザー名 |
| `WP_APP_PASSWORD` | WordPressのアプリケーションパスワード |

アプリケーションパスワードはWordPress管理画面のユーザープロフィールで発行します。通常のログインパスワードは登録しないでください。

## カテゴリ設定

カテゴリ未設定の投稿を防ぐため、次のいずれかを設定する必要があります。

### すべての記事に既定カテゴリを設定

ActionsのRepository variablesへ `WP_DEFAULT_CATEGORY_IDS` を登録します。値はWordPressのカテゴリIDをカンマ区切りで指定します。

```text
12,18
```

カテゴリのスラッグで設定したい場合は、代わりに `WP_DEFAULT_CATEGORY_SLUGS` を登録できます。

```text
lens-review,sony
```

### 記事ごとにカテゴリを設定

Markdown冒頭へfront matterを追加すると、既定カテゴリより優先されます。

```markdown
---
slug: fe135gm-review
category_ids: [12, 18]
featured_image: ./images/fe135gm-hero.png
---

# 記事タイトル
```

`categories: [lens-review, sony]` のように既存カテゴリのスラッグでも指定できます。存在しないスラッグは自動作成せず、workflowをエラー終了させます。

## 投稿ルール

- タイトルはMarkdown本文の最初の `# ` 見出しから自動取得します。
- 投稿slugはファイル名から自動生成します。front matterの `slug` で上書きできます。
- 投稿状態は必ず `draft` です。
- 同一slugの下書きがすでにある場合は更新します。
- 同一slugの公開済み記事がある場合、誤って非公開に戻さないよう処理を停止します。
- 先頭のローカル画像、または `featured_image` で指定した画像をアイキャッチとしてアップロードします。
- アイキャッチ指定画像がまだ無い場合は本文のみ下書き保存し、後で画像をpushした際に再同期します。
- アイキャッチ画像はテーマ側で表示される想定のため、本文HTMLからは除外します。本文中にも表示したい場合はfront matterへ `keep_featured_image: true` を追加します。

## 実行方法

- 自動実行: `main` への `articles/**/*.md` または `articles/images/**` のpush
- 手動実行: Actions画面の `WordPress draft sync` から `article_path` を指定して実行

最初にSecretsとカテゴリを登録した後、既存記事を投稿する場合は手動実行を利用してください。
