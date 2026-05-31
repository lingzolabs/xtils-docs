# 更新日志

xtils 的版本记录与重要变更。

---

## 开发中（未发布）

> 自 v1.1.0 以来的所有变更，预计作为 v2.0.0 发布。

### 亮点

这是一次重大更新。日志系统重写提升性能与可扩展性，Config 新增便捷 API，JSON 修复多项解析 bug 并引入零拷贝访问，Inspect 全新 Web 控制台。行为树引擎从零实现，FSM 进行了线程安全重构，网络层新增 TLS 和 multipart 支持，所有公共 API 统一为 PascalCase 命名。

### 行为树引擎 <Badge type="tip" text="新模块" />

JSON 驱动的行为树系统，适用于机器人、游戏 AI 和工作流自动化：

- 核心引擎：Sequence、Selector、Inverter、Delay、Retry 等内置节点
- 黑板数据共享（`AnyMap`）和输入/输出端口
- `BtFactory` 支持从 JSON 文件或目录批量加载树
- 子树组合（`SubTree` 节点 + `tree_name` 端口）
- 事件系统（`sendEvent`/`consumeEvent`/`WaitForEvent`/`EventGuard`）
- 暂停/恢复支持
- 结构化日志（`BtFileLogger`、`BtInspectLogger`、`BtCompositeLogger`）

### 网络层增强

- **TLS 支持**：新增 mbedTLS 后端，通过 `TLS_BACKEND` CMake 选项选择（`openssl` 或 `mbedtls`）
- **WSS 客户端**：WebSocket 客户端支持 TLS 安全连接
- **HTTP Client TLS**：通过 Transport 抽象层支持 HTTPS
- **Multipart 解析**：新增 `MultipartParser`，`HttpRequestContext` 支持延迟解析 `GetMultipartFields()`/`GetMultipartFiles()`
- **文件流式响应**：`HttpServerConnection::SendFileStreaming()` 分块传输大文件
- **请求体大小限制** `c5a61d2`：新增 `HttpServerConfig`，`max_payload_size` 可配置（默认 4MB），适配内存受限环境

### FSM 重构

- 全面优化内部实现，历史记录改用 deque
- `HistoryEntry` 增加人可读字段（`from_name`/`to_name`/`event_name`）
- 新增 `DumpHistory()` 格式化输出、`RegisterEvent()`/`GetEventName()` API
- 线程安全修复：`recursive_mutex`、`GetHistory()` 按值返回
- 新增 `SetRecordFailedEvents(bool)` 控制是否记录未匹配事件
- `ToDotGraph()` 输出改进
- 废弃 API 移至 `fsm_compat.h`

### App 框架

- `PostTask`/`PostAsyncTask` 重命名为 `Spawn`/`SpawnAsync`
- `Service::Deinit()` 现在在基础设施关闭**之前**调用（服务可在清理阶段安全使用网络/定时器）

### 日志系统重写

- 原子级别检查（移除 mutex 开销）
- `LogEntry` 使用 `const char*` 存储字面量（零拷贝），原始 `timespec` 延迟格式化
- 新增 `Formatter` 接口（`PlainFormatter`/`ColorFormatter`），每个 Sink 可独立格式化
- `Sink::write` 简化为 `string_view`
- `ConsoleSink` 缓存 `isatty()` 结果，颜色逻辑不再泄漏到文件 Sink
- 断言宏重命名为 `XTILS_CHECK`/`XTILS_DCHECK`/`XTILS_FATAL`（可 opt-in 短名）

### Config 改进

- 新增 `GetOr<T>` 便捷方法（两种重载：使用 Define 默认值 / 显式 fallback）
- 修复 9 个 bug（空参数崩溃、负数误判为 flag、bool 空值处理等）
- 废弃接口移至 `config_compat.h`

### JSON 修复与增强

- 新增零拷贝 `find(key)`/`find(index)` 方法（比 `get()` 快 ~3.4x）
- 修复 UTF-16 代理对解码（emoji/补充平面字符）
- 修复浮点序列化精度（`%.17g` 保证 round-trip）
- 修复 `operator[]`/`push_back` 类型安全（仅允许 null 提升为 object/array）

### Inspect 重构

- 实现从 ~880 行精简至 ~330 行
- 新增内置双栏 Web 控制台（HTTP 面板 + WebSocket 面板）
- Handler 签名变更为 `void(const Request&, Response&)`
- 新增 `PublishWithResult`、`GetSubscriberCount`、`GetRoutes`、`HasRoute` API

### 代码质量

- 所有公共 API 统一为 PascalCase，旧 snake_case 通过 `[[deprecated]]` 保持兼容
- 全面扩展测试覆盖
- 新增 `type_name_cstr` 用于 printf 安全场景

### 破坏性变更

| 变更 | 迁移方式 |
|------|--------|
| `CHECK`/`DCHECK`/`FATAL` → `XTILS_CHECK`/`XTILS_DCHECK`/`XTILS_FATAL` | 使用新名称，或 `#define XTILS_LOG_SHORT_MACROS` |
| `Sink::write(buf, start, len)` → `write(string_view)` | 更新自定义 Sink 实现 |
| Inspect Handler 签名变更 | 从 `[](req) { return Response; }` 改为 `[](req, resp) { resp = ...; }` |
| `USE_OPENSSL`/`USE_MBEDTLS` → `TLS_BACKEND` | 使用 `-DTLS_BACKEND=openssl` 或 `mbedtls` |
| `FSM::GetHistory()` 按值返回 | 不再持有 const 引用 |
| 公共 API 重命名为 PascalCase | 旧名称仍可用但有编译警告 |
| `PostTask`/`PostAsyncTask` → `Spawn`/`SpawnAsync` | 使用新名称 |
| BT 节点接口为 `OnTick`/`OnStart`/`OnStop` | 覆写新虚方法 |

---

## v1.1.0 <Badge type="info" text="2025-10-16" />

首个正式 tag。包含从项目创建以来的全部基础模块。

### 模块概览

| 模块 | 状态 |
|------|------|
| App 框架 | ✅ 服务生命周期、事件、定时器 |
| Config | ✅ JSON 配置 + CLI 解析 |
| Logging | ✅ 异步日志、控制台/文件 Sink、看门狗 |
| Net | ✅ TCP/UDP Client/Server、HTTP Client/Server、WebSocket Client |
| FSM | ✅ 状态机 + 历史记录 + Graphviz 导出 |
| Tasks | ✅ 事件循环、线程池、TaskGroup、Timer、CronScheduler |
| Debug | ✅ Inspect HTTP/WS 调试服务器、Chrome Tracer |
| Utils | ✅ JSON、字符串、文件、Base64、SHA1、字节读写 |

### 主要特性

- **App 框架**：单例应用上下文，Service CRTP 基类，自动配置段注入
- **事件循环**：基于 epoll 的 `UnixTaskRunner`，`ThreadTaskRunner` 专用线程封装
- **网络**：完整的 TCP/UDP/HTTP/WebSocket 栈，Express 风格路由器，CORS，中间件
- **日志**：printf 风格宏，异步环形缓冲区，按大小滚转的文件输出，内存/CPU 看门狗
- **FSM**：命名状态、事件转换、守卫条件、历史记录、DOT 图导出
- **CronScheduler**：Cron 表达式 + 间隔任务调度
- **自定义 JSON**：零依赖实现，替代 nlohmann_json
- **Inspect**：运行时 HTTP/WebSocket 调试服务器，可编译时完全剥离
- **Tracer**：Chrome trace 格式性能分析，RAII 宏
- **构建**：CMake 单静态库，自动导出 C++17，GitHub Actions CI

---

## 项目早期（2025-06 ~ 2025-09）

项目初始阶段，逐步搭建核心模块：

- 2025-06：HTTP/WebSocket 服务器原型、JSON 实现、Config 类
- 2025-07：Inspect 调试服务器、Tracer、WeakPtr、平台抽象
- 2025-08：文件工具、字节读写器、Service 框架
- 2025-09：FSM 调试增强、HTTP/TCP/UDP 完整实现
