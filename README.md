# dsh-history

DSH web 插件：在超长会话里**快速查看、搜索并跳转到所有"你发送"的消息**。

## 功能介绍

- **完整历史**：列出当前会话中**全部**你发送的消息，包括尚未加载进对话窗口的旧页、被 compaction 覆盖的历史。
- **一键定位**：点击消息 → 全自动定位（未加载则自动加载更早历史，页面未渲染则自动等待，就绪后平滑滚动 + 闪烁高亮并关闭面板）。
- **排序切换**：默认最新在前，工具栏一键切换"最新在前 / 最早在前"。
- **搜索过滤**：按消息文本实时过滤。
- **一键复制**：每行复制按钮，一键复制完整消息文本。
- **快速启动**：进入会话即后台预取完整列表，打开面板秒开；Host 侧带缓存。

---

## 🚀 安装

**前置**：已装好 DSH（`dsh web` 能正常运行），Node.js ≥ 20、pnpm ≥ 10。

### 方式一：从 npm 安装（推荐）

```bash
dsh plugin --profile web add dsh-history@latest
```

装完**硬刷新浏览器**（Cmd/Ctrl+Shift+R）即可看到效果（DSH 对 client 改动热加载，无需重启；仅 host 半更新时需要重启）。每个会话输入框上方自动出现 **"我的消息 (N)"**，无需手动操作。

### 方式二：直接从 GitHub 安装（无需等待 npm 发布）

```bash
dsh plugin --profile web add github:chenproton/dsh-history#main
# 或完整 URL 形式
dsh plugin --profile web add https://github.com/chenproton/dsh-history.git#main
```

装完硬刷新浏览器即可。此方式直接使用仓库已提交的构建产物，无需本地构建。

### 更新（npm / GitHub 通道通用）

```bash
dsh plugin --profile web add dsh-history@latest        # 更新到 npm 最新版
# 或
dsh plugin --profile web update dsh-history            # pnpm 语义更新
# GitHub 通道则重跑方式二的命令
```

也可把 `~/.dsh/profiles/web/package.json` 里的版本号改高后 `pnpm install`。改完硬刷新浏览器即可（client 改动无需重启 DSH）。

---

## 常见问题

### 从源码安装 / 开发（可选，替代 npm 方式）

调试本地改动或跟随开发分支时，把依赖指向本地克隆并自行构建：

```bash
# 1. 克隆并构建
git clone https://github.com/chenproton/dsh-history.git ~/Code/dsh-history
cd ~/Code/dsh-history && pnpm install && pnpm build

# 2. 把依赖指向本地克隆
#    编辑 ~/.dsh/profiles/web/package.json 的 dependencies：
#    "dsh-history": "link:<克隆目录绝对路径>"

# 3. 追加挂载行到 ~/.dsh/profiles/web/cordis.patch.yml：
#    - insert:
#        - id: dsh-history
#          name: 'dsh-history'

# 4. 在 profile 目录安装
cd ~/.dsh/profiles/web && pnpm install

# 5. 硬刷新浏览器即可看到效果
```

**更新**：`git pull && pnpm install && pnpm build` → 硬刷新浏览器（client 改动热加载生效，无需重启 DSH；host 半改动才需重启）。

**切回 npm 通道**：把依赖改回 `"dsh-history": "^0.1.8"` 再 `pnpm install`，并移除手动挂载行（避免双挂载）。

### 通过 plugin-registry 安装（可选，与上述二选一）

> 前置：DSH 已集成 plugin-registry（`dsh registry` 命令可用）。同时启用两个通道会双挂载（Node 半挂两次、页面两个面板）。

```bash
git clone https://github.com/chenproton/dsh-history.git && cd dsh-history
pnpm install && pnpm build
node scripts/package-registry.mjs      # 组装 registry/ 暂存（含清单 + 产物 + README，不入库）
dsh registry install ./registry        # 安装（默认禁用）
dsh registry enable dsh-external/dsh-history
```

**更新**：`git pull && pnpm install && pnpm build` → `node scripts/package-registry.mjs` → `dsh registry uninstall/install/enable`。切换通道前先移除另一通道的挂载。

---

## 使用

1. 点击输入框上方的 **"我的消息 (N)"**（N = 当前会话中你发送过的消息总数）。
2. 面板展开：搜索框 + 排序切换 + 消息列表（时间戳 + 文本预览 + 状态标签）。
3. 状态标签：
   - **可定位**（绿）= 消息已在当前对话窗口 → 点击自动滚动定位 + 高亮。
   - **未加载**（灰）= 消息在更早的历史 → 点击自动加载更早历史并定位。
   - **定位中…**（黄）= 正在加载/等待渲染以定位该消息。
4. 每行右侧 `⧉` 复制按钮一键复制完整文本（成功变 `✓`，1.4 秒后自动恢复）。

## 版本更新记录

### v0.1.7

- 体验：点击消息后**全自动定位**——节点未加载则自动加载更早历史；
  节点已加载但页面尚未渲染到该位置时，自动等待渲染（最多 1.5 秒重试），
  就绪后自动滚动 + 高亮并关闭面板，无需用户手动滚动；
- 定位期间对应行显示"定位中…"，仅真正的失败（加载失败/到达最早记录）才提示。

### v0.1.5

- 性能/稳定性：完整历史改为**优先读取会话内存日志**（无持久化读取、无重放校验），
  仅对非活动会话回退到完整日志读取——大幅降低"请求超时"出现的频率；
- 请求超时上限放宽至 15 秒，适配超大会话；
- 体验：提示信息移到面板顶部并加高亮底色，始终可见。

### v0.1.3

- 稳定性：完整历史请求加入 15 秒超时，失败时显示"重试"按钮；
- 稳定性：自动加载更早历史加入页数上限（30 页），防止异常循环；
- 性能：客户端/服务端缓存均有大小上限，长时间使用不泄漏内存；
- 体验：复制成功反馈 1.4 秒后自动恢复；当天消息只显示时间（`HH:mm`）；
- 体验：超长历史只渲染最近 200 条并提示，列表滚动不再卡顿；
- 体验：支持 `Esc` 关闭面板，列表项键盘可达（Enter/空格跳转），补充无障碍标签。

### v0.1.1

- 性能优化：进入会话即**后台预取**完整消息列表，打开面板秒开；
- Host 侧新增 5 秒会话级缓存，重复打开/切换会话不再重读完整日志。

### v0.1.0

- 首个版本：完整历史列表、一键滚动定位 + 高亮、自动加载更早历史、最新/最早排序切换、文本搜索、一键复制。

## License

MIT
