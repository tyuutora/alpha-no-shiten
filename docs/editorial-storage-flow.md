# 記事生成・保存フロー

「αの視点」の自動フローは、編集済みの記事Markdownと使用画像をGitHubへ保存し、貼り付け用HTMLを生成するところまでを基本範囲とします。加えて、`articles/**/*.md` の更新時には専用workflowからWordPress REST APIへ下書き投稿できます。公開操作はWordPress側で行います。

## 成果物

| 成果物 | 保存先 | 必須条件 |
| --- | --- | --- |
| 記事本文 | `articles/<slug>.md` | 最初のH1に記事タイトルを記載 |
| アイキャッチ画像 | `articles/images/<slug>-hero.<ext>` | 記事内から相対パスで参照 |
| HTML出力 | `dist/<slug>.html` | Markdownから自動生成し、直接編集しない |
| WordPress下書き | WordPress管理画面 | Markdownファイル名をslugとして作成または更新 |

画像を後で用意する場合は、Markdownを先に保存して構いません。画像追加時は同じ参照パスを満たすファイルを保存します。WordPress下書き投稿workflowでは、画像アップロードはまだ扱いません。

## 編集工程

1. キーワード担当が検索意図、主題、想定読者を定める。
2. ライター担当がWordPressへ移し替えやすいMarkdown本文を作成する。
3. SEO担当がタイトル候補、メタディスクリプション、内部リンク候補を確認する。
4. 校正担当が事実関係、所有機材に基づく表現、誤記を確認する。
5. 画像担当がアイキャッチの参照先と注記を整える。
6. 責任者がMarkdownと画像をGitHubへ保存する。
7. GitHub Actionsが `dist/<slug>.html` を自動生成し、保存完了とする。
8. `wordpress-draft-from-markdown.yml` が対象MarkdownをWordPress下書きへ作成または更新する。

## 保存ルール

- 記事タイトルはMarkdown本文の最初の `# ` 見出しに置きます。
- 記事から使用する画像は相対パスで参照します。
- `dist/` のHTMLは生成物です。修正は必ず `articles/` のMarkdownへ行います。
- `dist/` のHTMLはWordPressブロックエディタ向けのブロックコメント付きHTMLとして生成します。
- 所有していない機材を扱う記事では、実写・使用体験を装わず、検討記事または仕様に基づく解説として記述します。
- 投稿先サービス固有の認証情報はGitHub Secretsで管理し、記事成果物には含めません。

## HTML生成

- `main` へ `articles/*.md` または `articles/images/` の変更を保存すると、GitHub ActionsがHTMLを生成します。
- 例: `articles/fe85gm2-review.md` から `dist/fe85gm2-review.html` を生成します。
- 記事Markdownを削除した場合は、対応する `dist/` のHTMLも自動的に削除します。
- `dist/` の保存には、GitHub Actionsがリポジトリ内容へ書き込める設定が必要です。
- HTMLの先頭にSEOタイトルとメタディスクリプションをHTMLコメントで含め、本文表示には影響させません。
- HTMLはWordPressへ貼り付けやすい本文断片として生成し、`h2`、`h3`、リスト、表、引用、画像をコアブロック互換寄りの形式で保持します。不要な `style` タグは生成しません。
- 画像参照は `dist/` から元画像へ辿れるよう `../articles/images/...` に変換します。将来のWordPress取込側でメディア登録またはURL置換を扱います。

## GitHub Pages

- `dist/` と存在する `articles/images/` は `Build article HTML` workflowからGitHub Pagesの公開成果物としてデプロイします。これによりHTMLの画像相対参照を保ちます。
- リポジトリのPages設定では、公開ソースとして `GitHub Actions` を有効にします。
- Pages公開はHTML確認や別方式の取込元として利用できます。

## WordPress下書き投稿

- workflow名は `WordPress draft from Markdown`、ファイル名は `.github/workflows/wordpress-draft-from-markdown.yml` です。
- `main` へ `articles/**/*.md` をpushすると、追加または更新されたMarkdownだけを対象にします。
- `workflow_dispatch` では `markdown_path` を指定すると1ファイル、空欄なら `articles/` 配下のMarkdown全件を対象にします。
- 投稿タイトルはMarkdown本文の最初のH1から取得します。
- slugはMarkdownファイル名から取得します。
- WordPress投稿ステータスは常に `draft` です。
- 投稿前に `GET /wp-json/wp/v2/users/me` で認証確認します。
- 既存投稿は `slug` で検索し、見つかれば更新、見つからなければ新規作成します。
- 使用するGitHub Secretsは `WP_BASE_URL`、`WP_USERNAME`、`WP_APP_PASSWORD` です。
- 認証情報やAuthorizationヘッダーはログに出しません。エラー時はHTTP status、endpoint、response bodyだけを表示します。
- 画像投稿は対象外です。Markdown内の画像記法は投稿HTMLから除外します。

## 将来の投稿連携

画像アップロード、カテゴリ、アイキャッチ、ブロックHTMLの完全一致などが必要になった時点で、WordPress下書き投稿workflowを拡張します。公開判断と公開操作はWordPress側の責任範囲とします。
