# 今後の課題

54機能を短期間に並行実装したあと、セキュリティ・機能間の競合・重複の3方向から調査を行いました。
見つかった不具合はすべて修正済みですが、**あえて手を付けなかったもの**と、**調査で確認しきれなかったもの**が残っています。
この文書はそれを記録し、次に着手するときの判断材料にするためのものです。

記録日: 2026-08-04 / 対象コミット: `main` の PR #21 マージ時点

---

## 課題1. コンポーネントのテストが無い（最優先）

### 現状

ロジックとテストの分布に大きな偏りがあります。

| 層 | 規模 | テスト | 判定 |
|---|---|---|---|
| `src/lib` の純関数 | — | **685件・42ファイル** | 厚い。日付計算・集計・絞り込み・ジェスチャ判定・残高計算はほぼ完全に守られている |
| `src/lib` のストア（購読・localStorage） | 14モジュール | 直列化の純関数のみ | `subscribe` / `notify` / `useSyncExternalStore` は未検証 |
| `src/components` | 23ファイル・約5,500行 | **177件・14ファイル** | 段階1〜3まで対応済み（下記）。まだ入っていないのは資産の入力シート・レシートの連続撮影・繰り返し入力の設定 |
| CSS | 約5,000行 | **ゼロ** | 目視のみ |
| Supabase 連携（init / CRUD） | — | 一部（モッククライアント） | `storeCategories` `recurringRules` `partnerComments` `shareLinks` `transactionTemplates` にあり |

### なぜこれが最優先か

**調査で見つかった不具合のほとんどが、画面と画面の境目で起きていました。**

- 気分スタンプの payload を手書きしていて `partner_paid` が抜け、嘘の Discord 通知が飛んでいた（`MainScreen.tsx`）
- 共有ページで彼女が払った回の符号が逆になっていた（`SharePage.tsx`）
- 預かり行を複製すると二重計上されていた（`RowActionMenu.tsx`）
- 分割中に選んだ「支払った人」が黙って捨てられていた（`TransactionForm.tsx`）

いずれも**純関数側は正しく、呼び出し方だけが間違っていた**ものです。685件のテストは1件も落ちませんでした。
この層に検出手段が無い限り、同種の不具合はまた入ります。

### どこまで入れたか（2026-08-05 追記）

**この課題は3段階とも着手済みです。** 一度に網羅せず、壊れると痛い順に入れました。

1. **`renderToStaticMarkup` による描画テスト**（依存追加なし）
   `SharePage`（共有ページの符号と残高の整合）・`HistoryTxRow`・`QuarantineSheet`・`PartnerTab`・`InputTab`・`ReportTab`（月合計が実質支出であること）・`AssetsTab`（純資産の符号と、負債では増減の良し悪しが逆になること）・`SatisfactionSortSheet`・`report/` のタグ系カード。
2. **payload を組み立てている箇所**
   `src/components/writeBackPayload.test.ts`。`MainScreen` / `InputTab` は Supabase と起動処理を抱えていて画面から動かせないので、ソースを読んで「組み立て関数（`withSatisfaction` / `withCategory` / `duplicateInput` / `restoreInput`）を通しているか」「`partner_paid:` などを手書きしていないか」を見張っています。土台の `transactionToInput` が写す列の一覧も、そこで固定しています。
3. **React Testing Library**（`@testing-library/react` / `user-event` / `jsdom` を devDependency に追加）
   `TransactionForm` / `HistoryTab` / `PartnerTab` の `*.interaction.test.tsx`。**環境はファイル先頭の `// @vitest-environment jsdom` でファイル単位に切り替えています**（グローバルに変えると既存の描画テストとストアの挙動に影響が出るため）。

上の4件の不具合は、すべて**わざと入れ直して落ちることを確かめてあります**（「店のチップを押すとテンキーが閉じる」も同様）。

### まだ手が届いていないところ

- **ストア（`useSyncExternalStore` 系）** — 購読・通知・localStorage の往復は未検証のまま
- **CSS** — 見た目の回帰を検出する手段は無いまま（`.selected` / `.is-on` / `.on` の命名統一を保留している理由もこれ）
- **資産の入力シート・レシートの連続撮影・繰り返し入力の設定** — 画面のテストが無い

### 判断の目安

`src/lib` の純関数は**大胆に触ってよい**状態です。上に挙げたテストのある画面も、**落ちたテストを読めば何を壊したか分かる**状態になりました。ストア・CSS と、テストの無い画面は、**1つずつ、目視確認とセットで**進めてください。

---

## 課題2. 重複の統合（約550行）

調査で約650行ぶんの重複が見つかり、うち約100行（未使用コード・NUL バイト・ダークモードの色）は対応済みです。
残りは**不具合修正と混ぜるべきではない**と判断して見送りました。コンポーネントのテストができてからの方が安全です。

### やる価値がある順

| # | 内容 | 場所 | 削減 | リスク | 判断 |
|---|---|---|---|---|---|
| 1 | 日付・期間の計算が7種類に分裂 | `format.ts` `calendar.ts` `report.ts` `reportBuckets.ts` `monthJump.ts` `recurrence.ts` `netWorth.ts` `reportPace.ts` `historyFilter.ts` | −70行 | **低** | **やる価値あり。** 月末日を求める実装が7箇所、月キーをNヶ月ずらす実装が3箇所（3つとも1文字違わず同一）、曜日算出が5箇所。既存131件のテストがそのまま回帰検出器になる |
| 2 | `throwOn` が3ファイルで完全に同一 | `categories.ts:264` `recurringRules.ts:220` `transactionTemplates.ts:164` | −90行 | **低** | **やる価値あり。** `errorGuidance.ts` に移す。`assets.ts` 版はスキーマエラーを先に見る拡張版なので、任意引数で吸収 |
| 3 | アイコンの `Base` ラッパーが4ファイルにコピー | `icons.tsx` `maskIcons.tsx` `historyIcons.tsx` `assetIcons.tsx` | −40行 | **極低** | やってよい。`maskIcons.tsx` の `Base` は `icons.tsx` と1文字も違わない。3ファイルとも「他の作業と衝突するので分けた」とコメントに書いてあり、その制約はもう無い |
| 4 | localStorage 設定ストアが14モジュールに5通り | `keypadSettings` `amountMask` `privacyBlur` `lowBalanceSettings` `monthlyBudget` `txExtensions` ほか | −140行 | **低〜中** | `createLocalSetting<T>` を作る。**ストア本体にテストが1件も無い**ので、5つを一度に載せ替えず1つずつ。ストレージキーと直列化形式は変えないこと（既存端末のデータが読めなくなる） |
| 5 | 押した手応え `transform: scale(0.97)` が5箇所 | `styles.css:259, 577, 1336, 1532, 1588` | −20行 | **低** | セレクタリストに合流するだけ |
| 6 | 「マイグレーション未実行」の検知が4方式9モジュール | `storeCategories` `recurringRules` `transactionTemplates` `partnerComments` `shareLinks` `monthlySummary` `changeLog` `satisfaction` `assets` `txExtensions` | −80行 | **中** | `txExtensions.ts` の方式（localStorage に答えを残すのでオフライン起動でも効く）が最良。他8つにはその利点が無い。ただし**一度に全部ではなく `tableMissing` 派の7つだけ**を先に統一すること |
| 7 | 日時表示の関数が4つ、書式が3通り | `ChangeLogSheet` `CommentThread` `ShareLinkCard` `pullRefresh` | −20行 | 低 | 優先度低。書式が3通りあるのは**用途が違うから正しい**とも言える（共有ページは初見の人が読むので記号を減らしている） |
| 8 | `useSwipeNav` を「満足/後悔」に流用していて名前と意味がずれる | `SatisfactionSortSheet.tsx:51-55` | ±0 | 極低 | `onSwipeRight` / `onSwipeLeft` に改名。ついでにやってよい |

### 統合してはいけないもの（重要）

調査で明確に「分けたままにすべき」と判定されたものです。**重複しているから、という理由だけで触らないでください。**

- **`privacyBlur.ts` と `amountMask.ts`** — どちらも「金額を隠す」に見えるが、208（アプリ切替時・自動・全画面・既定オン）と169（手動・金額のみ・既定オフ）で**既定値も意味も逆**。統合すると判断が1つに潰れる
- **`initXxx` の共通化** — 差分こそが「マイグレーション未実行時にどう振る舞うか」という設計判断。`recurringRules` と `transactionTemplates` はテーブルが無いとき空にするが、`storeCategories` はキャッシュを残す（学習は端末内で続ける）。揃えてはいけない
- **`swipe.ts` / `rowGesture.ts` / `pullRefresh.ts`** — しきい値（56px / 12px / 8px）も軸比（2.0 / 1.4）も、それぞれの操作に合わせて調整された値。共通化すると「なぜこの数字か」が失われる
- **`desktop.css` が `styles.css` の22セレクタを再定義している件** — すべて `@media` の中。正しい上書き
- **`.selected` / `.is-on` / `.on` の命名統一** — 同じ状態に3つの名前が付いているのは事実だが、**見た目の回帰を検出する手段が無い**。課題1が片付いてから
- **`as unknown as XxxRow[]` が9箇所** — supabase-js の戻り型が緩いため。共通化しても**型安全性は1ミリも上がらない**
- **`.then()` と `async/await` の混在** — すべて `useEffect` の中。React では async な effect を直接書けないので正しい使い分け
- **「念のため」の防御コード**（`reportBuckets.ts:77` の上限3700回、`recurrence.ts:25` の `MAX_OCCURRENCES`、`assets.ts:82` の `Math.round` など） — すべて理由がコメントに書かれており、外したときに壊れるものが「家計の数字」

### 統合するときの絶対条件

**消してよいのはコードだけで、コメントに書かれた知識は必ず移してください。**

このコードベースの最大の資産は「なぜそうしたか」がコメントに残っていることです。

- `amountMask.ts:10-19` — なぜ CSS で伏せないのか（DOM に文字が残ると OCR で読める）
- `errorGuidance.ts:104-108` — なぜこの制約は案内に載せないのか（嘘の案内になるから）
- `recurringRules.ts:268-272` — なぜ先に日付を書いてから取引を積むのか（重複生成を生成漏れより優先）
- `reportYear.ts:4-5` — なぜ新しい集計を足さず既存の月次を束ね直すのか（同じ数字が別の式から出ると、どちらが正しいか分からなくなる）

---

## 課題3. 未修整の不具合・未検証の領域

### 直していないもの

**繰り返し入力は「生成済みの印」を先に書く**（`recurringRules.ts:276-310`）
取引をキューに積む前に `last_generated_date` をサーバーへ書くため、キューが詰まる・op が捨てられると「生成済みの印だけ残って取引が無い」状態になり、二度と生成されません。
PR #21 でキューが永久に詰まらなくなり、捨てられた op も隔離箱に残るようになったので**発生確率は大きく下がりました**が、構造としては残っています。
直すなら「生成した取引が実際に同期されたことを確認してから印を進める」か「生成したはずの日に取引が無いことを検出して再生成する」。規模は中。

**RLS の親レコード所有者チェックが2箇所で非対称**
- `partner_share_comments` の INSERT（`migration-partner-share.sql:156-159`）— `transaction_id` の持ち主を見ていない。`asset_balances` の INSERT は見ているので非対称
- `asset_balances` の UPDATE（`migration-assets.sql:141-145`）— INSERT では親の持ち主を確かめているのに UPDATE では見ていない。自分の残高行の `asset_id` を他人の資産に付け替えられる

**どちらも成立には「同じ Supabase プロジェクトにログインできる別ユーザー」が必要**で、利用者が1人である以上、実行者が存在しません。読み取りが増えることもありません。直すのは各2行程度。

### 確認できなかったこと

調査の限界として正直に記録します。

- **実機のタッチ挙動** — iOS のゴム跳ね、passive listener、引き下げ更新とスワイプの同時発火。Playwright の合成イベントでは再現しきれていない
- **本物の Supabase / RLS 環境** — ローカルの PostgreSQL 16 に `auth.uid()` と anon/authenticated ロールの shim を当てた代用で検証した。RLS ポリシー自体の効き方（`security definer` 越しの読み取り範囲）は SQL を読んだだけ
- **真の圏外** — スタブが常に応答するため、完全なオフライン状態での `addMany` は未検証
- **Gemini のレシート読み取りとその後段の組み合わせ**（機能060 / 064）
- **分割保存時の Discord 通知の数** — 残高に影響する内訳の数だけ通知が飛ぶはず。3内訳すべてに彼女の負担があると1回の買い物で3通届く可能性がある（未検証）

### 実際に使って確かめてほしいこと

実装したてで、使ってみないと分からない部分です。

- 調整（増やす・減らす）と返金
- 分割の入力と、履歴での見え方
- タグの付け方と、絞り込み・保存条件
- レポートの支出ペース線が実感と合うか
- 共有リンクを彼女の端末で開いたときの読みやすさ

---

## 課題4. 運用面

### Supabase 無料プランの制約

- **7日間アクセスが無いとプロジェクトが一時停止します。** 復帰はダッシュボードから手動。データは消えませんが、アプリはエラーになり、彼女の共有リンクも見られなくなります
- **自動バックアップがありません。** 操作ミスや事故でデータが消えると戻せません

対策として **CSV 書き出し（機能198）** の実装を勧めます。調査では選ばれませんでしたが実装コストは「小」で、バックアップ手段としては現実的です。1年分溜まってから失うと痛みが大きくなります。

### セキュリティの残件

- **`<user>.github.io` のオリジン共有** — 同じ GitHub アカウントで第三者のコードを含む Pages を1つでも公開すると、そこから Gemini キー・Discord Webhook URL・Supabase のセッションが読めます。**独自ドメインに移すのが確実**
- **Supabase の `Authentication → URL Configuration` の Redirect URLs** — ワイルドカードや不要なドメインが入っていないか一度確認すること。コード側は自分のオリジンしか送らないので、リスクは Supabase 側の設定にのみ存在する
- **`npm audit` で6件**（vitest / vite / esbuild ほか）— **すべて開発用の依存**で、公開される `dist/` には1バイトも入りません。実際に意味があるのは「`npm run dev` 中に悪意あるサイトを別タブで開くと開発サーバーからソースを読まれうる」1件だけ。vite 5→7、vitest 2→3.2.6 はいずれも破壊的変更を含むので急ぐ必要はない

---

## 未実装の機能

調査した251機能のうち、実装したのは54件です。残り197件は `docs/feature-research.md` に番号つきで残してあります。
番号を指定すればそこから実装できます。

選択用の Web 版: https://claude.ai/code/artifact/4cfd8355-f8dd-43e8-823d-2c6c2c947efe
（番号は `docs/feature-research.md` と一致します）
