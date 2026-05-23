# Rank Math RESTメタ登録プラグイン

GitHub ActionsからWordPress下書き投稿時に、Rank MathのSEOタイトル、メタディスクリプション、フォーカスキーワードを保存するためのWordPress側プラグインです。

## 対応フィールド

- `rank_math_title`
- `rank_math_description`
- `rank_math_focus_keyword`

## 導入手順

1. `wordpress/plugins/alpha-no-shiten-rest-meta/alpha-no-shiten-rest-meta.php` を、WordPressの `wp-content/plugins/alpha-no-shiten-rest-meta/` 配下へ設置します。
2. WordPress管理画面の「プラグイン」から `Alpha no Shiten REST SEO Meta` を有効化します。
3. GitHub Actionsの `WordPress draft from Markdown` を手動実行し、対象Markdownとして `articles/final/moving-subject-af-settings.md` を指定します。
4. WordPress下書きのRank Math欄に、SEOタイトル、メタディスクリプション、フォーカスキーワードが反映されていることを確認します。

## セキュリティ

このプラグインは、投稿編集権限のある認証済みユーザーにのみREST API経由のメタ更新を許可します。GitHub SecretsやApplication Passwordを表示・保存する処理は含みません。

## エラー確認

投稿スクリプトは、送信後のWordPressレスポンスからRank Mathメタ値を検証します。プラグインが未導入、無効、またはWordPress側で保存を拒否している場合は、`Rank Math meta ... verification` を含むエラーで処理を停止します。
