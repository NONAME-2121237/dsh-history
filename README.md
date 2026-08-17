# dsh-history

DSH web 插件：在超长会话里**快速查看、搜索并跳转到所有"你发送"的消息**。

受 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的外部插件模式启发而构建（`dsh.plugin.json` + `dsh.bundle.patch` + client bundle 经 `window.__ModuleLoader__.load` 注册）。

## 功能

- **完整历史**：列出当前会话中**全部**你发送的消息（`user/message` 且 `source.kind === 'user'`），包括尚未加载进对话窗口的旧页、被 compaction 覆盖的历史——数据来自 Host 侧 `sessionQuery.readSession` 的完整日志读取。
- **一键定位**：点击已加载的消息 → 平滑滚动到该位置并闪烁高亮（使用产品自身的 `data-chat-anchor-key` 语义锚点）。
- **自动加载更早历史**：点击"未加载"的消息 → 自动调用产品官方 `session.loadOlder()` 逐页向上加载，直到目标消息进入窗口后自动滚动定位。
- **排序切换**：默认最新在前，工具栏一键切换"最新在前 / 最早在前"。
- **搜索过滤**：按消息文本实时过滤。
- **一键复制**：每行复制按钮，Clipboard API 优先，自动降级。

## 安装

### 从 npm 安装（推荐）

```bash
dsh plugin --profile web add dsh-history@latest
```

安装命令会：
1. 用 pnpm 将包安装到 profile 目录；
2. 识别 `dsh.bundle.patch` 声明，自动把 `dsh-history` 追加到 `dsh.profile.bundles`；
3. 启动时合并 `cordis.patch.yml` 的 `insert` 行完成挂载。

重启（或 HMR）后，在任意会话的输入框上方会看到一行 **"我的消息 (N)"**。

### 手动 mount（可选）

如果不想走 bundle 通道，也可以直接把 `dsh-history` 行插入 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-history
      name: 'dsh-history'
```

> 注意：两种方式二选一，避免双重挂载（两个 Host 半、两个 dock）。

## 使用

1. 点击输入框上方的 **"我的消息 (N)"**（N = 当前会话中你发送过的消息总数）。
2. 面板展开：搜索框 + 排序切换 + 消息列表（时间戳 + 文本预览 + 状态标签）。
3. 状态标签：
   - **可定位**（绿）= 消息已在当前对话窗口 → 点击平滑滚动定位 + 高亮。
   - **未加载**（灰）= 消息在更早的历史 → 点击自动加载更早历史并定位；也可以直接在列表中浏览/复制。
   - **加载中…**（黄）= 正在向上加载历史页。
4. 每行右侧 `⧉` 复制按钮一键复制完整文本（成功变 `✓`）。

## 架构

| 半部 | 文件 | 职责 |
| --- | --- | --- |
| Host | `src/index.ts` | 注册 fenced HTTP 路由 `/history/api/list-user-messages`，通过 `sessionQuery.readSession` 读取完整会话日志，过滤所有 `user/message` 且 `source.kind === 'user'` 的事件，返回 `{seq, time, text}` 列表。信任围栏与 `/api` 网关同构（loopback / trustedHosts / cross-site 拒绝）。 |
| Client | `src/client/index.ts` | 注册 `conversation.input.dock` 槽位 UI；`fetch` 调宿主路由取全量历史；用 `ctx.get('sessions').binding(id).session.loadOlder()` 自动加载更早历史；用产品 `data-chat-anchor-key` 锚点滚动定位。 |

关键点：独立 npm 插件在 DSH monorepo 之外解析，因此：
- 跨半部通信走**插件自己的 fenced HTTP 路由**（无 `host.call`）；
- 样式用 **style 标签注入**（无 `styles` builtin）；
- Client 用 `React.createElement`（无 JSX 转换）；
- 服务访问用结构化类型镜像（`declare module 'cordis'` 本地声明）。

## 开发

```bash
pnpm install
pnpm build       # lib/index.mjs (host ESM) + lib/client.js (client bundle) + lib/types
pnpm pack        # 本地验证发布内容
```

## 发布

打 GitHub Release（tag `vX.Y.Z` 与 `package.json` 的 `version` 一致）即触发
`.github/workflows/release.yml` 构建并发布到 npm（Trusted Publishing）。
也可以在 GitHub Actions 里手动触发 `workflow_dispatch` 发布。

## License

MIT
