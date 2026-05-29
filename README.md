<div align="center">

# Grok Build Desktop

**A Grok-first desktop coding environment — Claude-Desktop-style, built on the official Grok Build CLI.**

Repository context · streamed terminal output · coding workflows · Chrome control · Telegram remote · local tool (MCP) integrations.

Tauri 2 · React 19 · TypeScript · Vite 7 · Rust

**English** · [日本語](#日本語) · [中文](#中文)

</div>

---

## English

### Overview

Grok Build Desktop turns the official **Grok Build CLI** into a native desktop coding app instead of a raw terminal wrapper. Two modes:

- **Grok Chat** — quick questions, product thinking, explanations, non-code tasks.
- **Grok Code** — repository inspection, implementation, debugging, reviews, tests, refactors, and terminal verification.

Grok is the only model path exposed in the UI. The model selector reflects exactly what your installed Grok CLI advertises via `grok models`, so you never silently fall back to a model you didn't pick.

### Features

- **Non-blocking streaming UI** — Grok runs use `--output-format streaming-json`; events flow through a Rust queue → typed Tauri events → a `useSyncExternalStore` store → an off-thread markdown Web Worker. The composer, panels, and theme toggle stay fully interactive while a run streams. Text reveals with natural typewriter pacing.
- **FIFO run queue** — type a new prompt while one is still streaming and it joins the queue (persisted in SQLite, survives restart). Started-in-desktop and started-in-Telegram runs share one queue.
- **Settings & Tools pages** — a Claude-Desktop-style Settings modal (General / Model / Permissions / Integrations / About) and a Tools page that is an **MCP integration hub** with a catalog of community servers you can add/remove.
- **Telegram remote** — drive Grok from your phone via a Telegram bot (allowlist-gated). See [Telegram setup](#telegram-remote-setup).
- **Chrome control** — a Manifest V3 companion extension with a visible "controlled tab" border, a non-intrusive agent cursor, page snapshots, and a native-messaging bridge so the desktop app can dispatch actions to Chrome.
- **Prompt library** — reusable prompt templates in SQLite with search-as-you-type and one-click insert.
- **Agent overlay** — a click-through, full-display edge border + animated cursor sprite that makes it obvious when Grok is acting. Strictly visual — no OS input synthesis.
- **Coding workflows** — Analyze, Implement, Review, Debug, Tests, Refactor — with action policies (Review only / Patch ready / Autopilot) mapped to real Grok permission flags.
- **Capability inspector** — Context / Skills / MCP / Agents / Plugins / Hooks / Permissions, combining `grok inspect` with managed `grok mcp` / `grok plugin` / `grok sessions`.

### Requirements

- **Node.js** 18+ and **npm**
- **Rust** (stable) + the Tauri prerequisites for your OS — see <https://tauri.app/start/prerequisites/>
- **Grok Build CLI** installed and logged in (`grok login`) — the primary runner
- macOS is the primary target; a Windows build target exists (`npm run tauri build` → MSI on `windows-latest`). Optional tools (browser-use, scrcpy) install separately.

### Quick Start

```bash
git clone https://github.com/JaydenCJ/grok-build-desktop.git
cd grok-build-desktop
npm install
npm run tauri:dev
```

macOS release bundle / stable local install:

```bash
npm run mac:build      # .app under src-tauri/target/release/bundle/
npm run mac:install    # build + ad-hoc sign + copy to ~/Applications + open
npm run mac:build:dmg  # optional DMG
```

Configuration: copy the example env file and fill in your own values (the file is git-ignored):

```bash
cp .env.example .env
```

Tauri dev does **not** auto-load `.env` — export the values in your shell before launching, or place them in `~/.grok-desktop/.env` (read on a fixed path by the Telegram daemon). All variables are documented in [`.env.example`](.env.example) and the [Configuration reference](#configuration-reference).

### Telegram remote setup

1. Create a bot with [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Send `/start` to your bot, then `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` and copy the `chat.id` (an i64).
3. Put **your own** values in `.env` (never commit real tokens):

   ```bash
   TELEGRAM_BOT_TOKEN=123456:ABCDEF...        # placeholder — use your own
   TELEGRAM_ALLOWED_CHAT_IDS=12345678         # placeholder — your chat id
   # TELEGRAM_DEFAULT_CWD=/Users/you/code/some-project
   ```

4. Restart the app. The console prints `telegram: daemon online, N chat(s) allowlisted`.

| Command | What it does |
|---|---|
| `/grok <prompt>` or plain text | Enqueue a run; the bot edits its reply in place as text streams, then finalises. |
| `/queue` | Active run ID + waiting list. |
| `/cancel` `[prefix]` | Cancel the active run, or cancel by UUID prefix. |
| `/status` | Uptime, allowlist size, active run, queue depth, default cwd. |
| `/help` | Command list. |

Authorization is enforced per command — chat IDs outside the allowlist get `🚫 Not authorized.` and the daemon refuses to start with an empty allowlist.

> ⚠️ **A bot token is a credential.** If it ever appears anywhere visible (chat, screenshot, commit), revoke it immediately via @BotFather → `/mybots` → your bot → API Token → *Revoke current token*, and issue a fresh one.

### Chrome control setup

```text
chrome://extensions → Developer mode → Load unpacked → select chrome-extension/
```

Optional native bridge (lets the desktop app dispatch actions to Chrome):

```bash
python3 scripts/install_chrome_native_host.py --extension-id <chrome-extension-id>
```

Details in [`docs/chrome-extension.md`](docs/chrome-extension.md); responsible-automation notes in [`docs/responsible-automation.md`](docs/responsible-automation.md).

### Architecture

```
┌───────────────────────────────┐     streaming-json events     ┌──────────────────┐
│  React 19 UI (src/)           │ ◀───────────────────────────── │  Rust backend    │
│  store · worker · components  │ ──── Tauri commands ─────────▶ │  (src-tauri/)    │
└───────────────────────────────┘                                │  RunQueue (SQLite)│
        │                                                        │  Grok subprocess  │
        │ native messaging (files)        Telegram long-poll ◀──▶│  Telegram daemon  │
        ▼                                                        └──────────────────┘
┌───────────────────────────────┐
│  Chrome MV3 extension          │
│  background · content · popup  │
└───────────────────────────────┘
```

More in [`docs/architecture.md`](docs/architecture.md), [`docs/setup.md`](docs/setup.md), and [`docs/mac.md`](docs/mac.md).

### Development & testing

```bash
npm run check        # tsc --noEmit && cargo check
npm run build        # tsc && vite build (production)
npm test             # smoke test (scripts/smoke_test.mjs)
npm run test:unit    # vitest
npm run chrome:check # syntax-check the extension scripts
npm run doctor       # environment doctor
```

### License & contact

This repository is **source-available** under the terms in [`LICENSE`](LICENSE) (all rights reserved — see the file for what is and isn't permitted). Third-party attributions are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Questions or feedback: **gijirokuman@gmail.com**

---

## 日本語

### 概要

Grok Build Desktop は、公式の **Grok Build CLI** を生のターミナルラッパーではなく、ネイティブなデスクトップ・コーディングアプリに変えます。2 つのモード:

- **Grok Chat** — 簡単な質問、プロダクト思考、説明、コード以外のタスク。
- **Grok Code** — リポジトリ調査、実装、デバッグ、レビュー、テスト、リファクタ、ターミナル検証。

UI で公開されるモデル経路は Grok のみです。モデルセレクターはインストール済み Grok CLI が `grok models` で提示する内容をそのまま反映するため、選んでいないモデルに黙って戻ることはありません。

### 主な機能

- **ノンブロッキング・ストリーミング UI** — Grok 実行は `--output-format streaming-json` を使用。イベントは Rust キュー → 型付き Tauri イベント → `useSyncExternalStore` ストア → 別スレッドの Markdown Web Worker を経由します。実行中もコンポーザー・各パネル・テーマ切替は完全に操作可能で、テキストは自然なタイプライター速度で表示されます。
- **FIFO 実行キュー** — ストリーミング中に新しいプロンプトを入力するとキューに加わります(SQLite に永続化、再起動後も保持)。デスクトップ発と Telegram 発の実行は同一キューを共有します。
- **設定 & ツールページ** — Claude Desktop 風の設定モーダル(General / Model / Permissions / Integrations / About)と、コミュニティ製サーバーを追加・削除できる **MCP 統合ハブ** としての Tools ページ。
- **Telegram リモート** — 許可リスト制の Telegram ボットでスマホから Grok を操作。[Telegram 設定](#telegram-リモート設定)を参照。
- **Chrome 制御** — Manifest V3 のコンパニオン拡張。制御中タブの可視ボーダー、邪魔にならないエージェントカーソル、ページスナップショット、デスクトップアプリから Chrome へ操作を送るネイティブメッセージング・ブリッジ。
- **プロンプトライブラリ** — SQLite に保存される再利用可能なテンプレート。逐次検索とワンクリック挿入。
- **エージェント・オーバーレイ** — クリックスルーの全画面エッジボーダー＋アニメーションするカーソル。Grok の動作を明示します。完全に視覚的で、OS への入力合成は行いません。
- **コーディング・ワークフロー** — Analyze / Implement / Review / Debug / Tests / Refactor。アクションポリシー(Review only / Patch ready / Autopilot)は実際の Grok 権限フラグに対応します。
- **機能インスペクター** — Context / Skills / MCP / Agents / Plugins / Hooks / Permissions。`grok inspect` と管理系 `grok mcp` / `grok plugin` / `grok sessions` を統合。

### 必要環境

- **Node.js** 18 以上 と **npm**
- **Rust**(stable)+ OS ごとの Tauri 前提条件 — <https://tauri.app/start/prerequisites/>
- **Grok Build CLI**(インストール済み・`grok login` 済み)— 主要なランナー
- 主対象は macOS。Windows ビルドターゲットも存在します(`npm run tauri build` → `windows-latest` で MSI)。任意ツール(browser-use, scrcpy)は別途インストール。

### クイックスタート

```bash
git clone https://github.com/JaydenCJ/grok-build-desktop.git
cd grok-build-desktop
npm install
npm run tauri:dev
```

macOS リリースバンドル / 安定したローカルインストール:

```bash
npm run mac:build      # src-tauri/target/release/bundle/ 配下に .app
npm run mac:install    # ビルド + アドホック署名 + ~/Applications へコピー + 起動
npm run mac:build:dmg  # 任意の DMG
```

設定: サンプル env をコピーして自分の値を入れます(このファイルは git 管理外):

```bash
cp .env.example .env
```

Tauri dev は `.env` を自動読み込み**しません** — 起動前にシェルで export するか、`~/.grok-desktop/.env`(Telegram デーモンが固定パスで読む)に置いてください。全変数は [`.env.example`](.env.example) と [設定リファレンス](#configuration-reference) に記載。

### Telegram リモート設定

1. [@BotFather](https://t.me/BotFather) で `/newbot` を実行しトークンを取得。
2. ボットに `/start` を送り、`curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` で `chat.id`(i64)を取得。
3. **自分の**値を `.env` に記入(本物のトークンは絶対にコミットしない):

   ```bash
   TELEGRAM_BOT_TOKEN=123456:ABCDEF...        # プレースホルダー — 自分のものを
   TELEGRAM_ALLOWED_CHAT_IDS=12345678         # プレースホルダー — 自分の chat id
   # TELEGRAM_DEFAULT_CWD=/Users/you/code/some-project
   ```

4. アプリを再起動。コンソールに `telegram: daemon online, N chat(s) allowlisted` と表示されます。

| コマンド | 内容 |
|---|---|
| `/grok <prompt>` または通常テキスト | 実行をキューに追加。ストリーミングに合わせて返信を逐次編集し、完了で確定。 |
| `/queue` | 実行中の ID と待機リスト。 |
| `/cancel` `[prefix]` | 実行中をキャンセル、または UUID 接頭辞でキャンセル。 |
| `/status` | 稼働時間、許可リスト数、実行中、キュー深さ、既定 cwd。 |
| `/help` | コマンド一覧。 |

認可はコマンドごとに強制されます。許可リスト外の chat ID は `🚫 Not authorized.` となり、許可リストが空だとデーモンは起動しません。

> ⚠️ **ボットトークンは資格情報です。** チャット・スクショ・コミットなど見える場所に出たら、直ちに @BotFather → `/mybots` → 対象ボット → API Token → *Revoke current token* で失効させ、新規発行してください。

### Chrome 制御の設定

```text
chrome://extensions → デベロッパーモード → パッケージ化されていない拡張機能を読み込む → chrome-extension/ を選択
```

任意のネイティブブリッジ(デスクトップアプリから Chrome へ操作送信):

```bash
python3 scripts/install_chrome_native_host.py --extension-id <chrome-extension-id>
```

詳細は [`docs/chrome-extension.md`](docs/chrome-extension.md)、責任ある自動化の注意は [`docs/responsible-automation.md`](docs/responsible-automation.md)。

### アーキテクチャ

[`docs/architecture.md`](docs/architecture.md)、[`docs/setup.md`](docs/setup.md)、[`docs/mac.md`](docs/mac.md) を参照(上の English 図と同じ構成)。

### 開発とテスト

```bash
npm run check        # tsc --noEmit && cargo check
npm run build        # tsc && vite build(本番)
npm test             # スモークテスト
npm run test:unit    # vitest
npm run chrome:check # 拡張スクリプトの構文チェック
npm run doctor       # 環境ドクター
```

### ライセンスと連絡先

本リポジトリは [`LICENSE`](LICENSE) の条件に基づく **ソース公開(source-available)** です(all rights reserved — 許可される範囲はファイル参照)。サードパーティの帰属は [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

お問い合わせ: **gijirokuman@gmail.com**

---

## 中文

### 简介

Grok Build Desktop 把官方 **Grok Build CLI** 从裸终端封装升级为原生桌面编程应用。两种模式:

- **Grok Chat** — 快速提问、产品思考、解释说明、非代码任务。
- **Grok Code** — 仓库分析、实现、调试、评审、测试、重构与终端验证。

UI 中只暴露 Grok 这一条模型路径。模型选择器严格反映本机 Grok CLI 通过 `grok models` 实际声明的列表,绝不会静默回退到你没选的模型。

### 功能

- **非阻塞流式 UI** — Grok 运行使用 `--output-format streaming-json`;事件经 Rust 队列 → 类型化 Tauri 事件 → `useSyncExternalStore` store → 独立线程的 Markdown Web Worker。运行期间输入框、各面板、主题切换都保持完全可交互,文字以自然的打字机节奏逐字呈现。
- **FIFO 运行队列** — 上一条还在流式输出时再输入新 prompt,会自动加入队列(SQLite 持久化,重启不丢)。桌面发起与 Telegram 发起的运行共用同一个队列。
- **设置页 & 工具页** — Claude Desktop 风格的设置弹窗(General / Model / Permissions / Integrations / About);工具页是一个 **MCP 集成中心**,内置社区服务器目录,可一键增删。
- **Telegram 远程** — 通过白名单制的 Telegram 机器人在手机上驱动 Grok。见 [Telegram 配置](#telegram-远程配置)。
- **Chrome 控制** — Manifest V3 配套扩展:受控标签页可见边框、不打扰的虚拟光标、页面快照,以及让桌面端向 Chrome 派发操作的原生消息桥。
- **Prompt 库** — 存于 SQLite 的可复用模板,边打边搜、一键插入。
- **Agent 浮层** — 穿透点击的全屏边缘高亮 + 动画光标,让 Grok 正在操作时一目了然。纯视觉,不做任何操作系统级输入合成。
- **编程工作流** — Analyze / Implement / Review / Debug / Tests / Refactor;动作策略(Review only / Patch ready / Autopilot)对应真实的 Grok 权限标志。
- **能力检查器** — Context / Skills / MCP / Agents / Plugins / Hooks / Permissions,整合 `grok inspect` 与受管的 `grok mcp` / `grok plugin` / `grok sessions`。

### 环境要求

- **Node.js** 18+ 与 **npm**
- **Rust**(stable)+ 对应系统的 Tauri 前置依赖 — 见 <https://tauri.app/start/prerequisites/>
- 已安装并登录(`grok login`)的 **Grok Build CLI** — 主运行器
- 主目标平台为 macOS;同时存在 Windows 构建目标(`npm run tauri build` → 在 `windows-latest` 产出 MSI)。可选工具(browser-use、scrcpy)需另行安装。

### 快速开始

```bash
git clone https://github.com/JaydenCJ/grok-build-desktop.git
cd grok-build-desktop
npm install
npm run tauri:dev
```

macOS 发布包 / 稳定本地安装:

```bash
npm run mac:build      # 产物在 src-tauri/target/release/bundle/
npm run mac:install    # 构建 + ad-hoc 签名 + 复制到 ~/Applications + 打开
npm run mac:build:dmg  # 可选 DMG
```

配置: 复制示例 env 并填入你自己的值(该文件已被 git 忽略):

```bash
cp .env.example .env
```

Tauri dev **不会**自动加载 `.env` — 启动前请在 shell 里 export,或放到 `~/.grok-desktop/.env`(Telegram 守护进程按固定路径读取)。全部变量见 [`.env.example`](.env.example) 与 [配置参考](#configuration-reference)。

### Telegram 远程配置

1. 用 [@BotFather](https://t.me/BotFather) 执行 `/newbot` 拿到 token。
2. 给机器人发 `/start`,再 `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` 取 `chat.id`(i64)。
3. 把**你自己的**值写进 `.env`(切勿提交真实 token):

   ```bash
   TELEGRAM_BOT_TOKEN=123456:ABCDEF...        # 占位符 — 换成你自己的
   TELEGRAM_ALLOWED_CHAT_IDS=12345678         # 占位符 — 你的 chat id
   # TELEGRAM_DEFAULT_CWD=/Users/you/code/some-project
   ```

4. 重启应用。控制台会打印 `telegram: daemon online, N chat(s) allowlisted`。

| 命令 | 作用 |
|---|---|
| `/grok <prompt>` 或纯文本 | 入队一次运行;机器人随流式输出原地编辑回复,完成后定稿。 |
| `/queue` | 当前运行 ID + 等待列表。 |
| `/cancel` `[prefix]` | 取消当前运行,或按 UUID 前缀取消。 |
| `/status` | 运行时长、白名单数量、当前运行、队列深度、默认 cwd。 |
| `/help` | 命令列表。 |

授权逐命令强制执行 — 不在白名单的 chat ID 会收到 `🚫 Not authorized.`,且白名单为空时守护进程拒绝启动。

> ⚠️ **bot token 属于凭证。** 一旦出现在任何可见位置(聊天、截图、提交),请立即通过 @BotFather → `/mybots` → 对应机器人 → API Token → *Revoke current token* 吊销并重新签发。

### Chrome 控制配置

```text
chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择 chrome-extension/
```

可选原生桥(让桌面端向 Chrome 派发操作):

```bash
python3 scripts/install_chrome_native_host.py --extension-id <chrome-extension-id>
```

细节见 [`docs/chrome-extension.md`](docs/chrome-extension.md);负责任自动化说明见 [`docs/responsible-automation.md`](docs/responsible-automation.md)。

### 架构

见 [`docs/architecture.md`](docs/architecture.md)、[`docs/setup.md`](docs/setup.md)、[`docs/mac.md`](docs/mac.md)(与上方 English 图同构)。

### 开发与测试

```bash
npm run check        # tsc --noEmit && cargo check
npm run build        # tsc && vite build(生产)
npm test             # 冒烟测试
npm run test:unit    # vitest
npm run chrome:check # 扩展脚本语法检查
npm run doctor       # 环境体检
```

### 许可与联系方式

本仓库依据 [`LICENSE`](LICENSE) 条款 **源码可见(source-available)**(all rights reserved — 允许范围见该文件)。第三方归属见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

问题或反馈: **gijirokuman@gmail.com**

---

## Configuration reference

All variables are also in [`.env.example`](.env.example). The Rust backend reads the `GROK_DESKTOP_*` names below (not any other prefix).

| Variable | Default | Purpose |
|---|---|---|
| `GROK_DESKTOP_PYTHON` | `python3` | Python interpreter for the tool bridges. |
| `GROK_DESKTOP_GROK_CMD` | `grok` | Grok CLI executable. |
| `GROK_DESKTOP_GROK_ARGS` | see `.env.example` | Argument template; `{prompt}` and `{mode}` are substituted. |
| `GROK_DESKTOP_GROK_CHECK` | `false` | Enable Grok's headless `--check` self-verification. |
| `GROK_DESKTOP_COMMAND_TIMEOUT_SECS` | `240` | Per-command timeout. |
| `GROK_DESKTOP_GROK_MAX_TURNS` | `12` | Bounded turn limit for headless runs. |
| `GROK_DESKTOP_VERBOSE_GROK_STDERR` | `0` | `1` shows raw Grok stderr (otherwise tracing noise is filtered). |
| `XAI_API_KEY` | — | Optional API-key auth (Grok can also use a cached `grok login`). |
| `BROWSER_USE_API_KEY` | — | Required only for the browser-use bridge. |
| `TELEGRAM_BOT_TOKEN` | — | Enables the Telegram daemon when set. **Secret.** |
| `TELEGRAM_ALLOWED_CHAT_IDS` | — | Comma-separated i64 allowlist (daemon won't start empty). |
| `TELEGRAM_DEFAULT_CWD` | — | Optional working directory for `/grok`. |
