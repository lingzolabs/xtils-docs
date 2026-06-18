# 更新日志

xtils 的版本记录与重要变更。

---

## v2.0.0 <Badge type="info" text="2026-06" />

正式发布。完成 v1.x 的废弃过渡期，所有 snake_case 包装与兼容头文件已彻底移除。

### 💥 破坏性变更 — 已删除的废弃 API

| 头文件 | 已删除 | 替代 |
|--------|--------|------|
| `xtils/app/app.h` | `App::registor`/`ins`/`run`/`run_daemon`/`init`/`is_running`/`spawn`/`spawn_async`/`every`/`delay`/`emit`/`connect`/`conf` | `App::Register/Ins/Run/RunDaemon/Init/IsRunning/Spawn/SpawnAsync/Every/Delay/Emit/Connect/Conf` |
| `xtils/app/service.h` | `Service::emit`、`xtils::isOk/init/shutdown/run_forever/run_daemon` | `Service::Emit`、`xtils::IsOk/Init/Shutdown/RunForever/RunDaemon` |
| `xtils/tasks/task_group.h` | `is_busy/size/stop/stop_wait_all/main_runner` | `IsBusy/Size/Stop/StopWaitAll/MainRunner` |
| `xtils/utils/thread_safe.h` | `pop_wait/try_pop/push/clear/size/quit` | `PopWait/TryPop/Push/Clear/Size/Quit` |
| `xtils/config/config_compat.h` | **整个文件删除** | 全部使用 PascalCase API（`Define`/`ParseArgs`/`LoadFile`/`ParseJson`/`Get`/`GetOr` 等） |
| `xtils/fsm/fsm_compat.h` | **整个文件删除** | 全部使用 PascalCase API |
| `XTILS_ENABLE_DEPRECATED` 宏 | 不再被识别 | 从构建系统中移除 |

### 🌟 v2.0 主要新增（自 v1.2.1 累计）

#### 新增模块

- **`xtils/metrics/`** — 轻量指标库：`Counter`/`Gauge`/`Histogram`，标签 family，`PrometheusExporter` 文本导出
- **`xtils/scripting/`** — 内嵌 QuickJS-NG JavaScript 引擎，`ScriptEngine`/`ScriptContext`/`ScriptValue`，与 `Json` 双向互转，可选启用（`SCRIPTING_ENABLE=ON`）
- **`xtils/net/ipc_channel.h`** — JSON-RPC 2.0 over Unix/abstract Unix/TCP，`IpcServer`/`IpcClient`，支持同步调用、异步调用、通知与订阅
- **`xtils/net/http_client_pool.h`** — HTTP 客户端连接池，固定大小，RAII 借用句柄，超时 acquire

#### Logging 结构化日志

- **`xtils/logging/mdc.h`** — Mapped Diagnostic Context，线程局部键值，自动附加到结构化日志输出
- **`xtils/logging/log_builder.h`** — 链式字段 API：`LOGI().Field("req_id", id).Field("status", code).Msg("done");`
- 日志系统重写：原子级别检查（移除 mutex 开销）、`LogEntry` 使用 `const char*` 字面量（零拷贝）、原始 `timespec` 延迟格式化、新增 `Formatter` 接口（`PlainFormatter`/`ColorFormatter`），每个 Sink 可独立格式化
- 断言宏重命名为 `XTILS_CHECK`/`XTILS_DCHECK`/`XTILS_FATAL`（可 opt-in 短名 `XTILS_LOG_SHORT_MACROS`）

#### Net

- **HTTP 类型整理**：`HttpClient::Request`/`Response`/`Listener`/`MultipartField`/`MultipartFile` 全部内嵌；同步入口统一为 `HttpClient::Send()`；服务/路由暴露 `HttpServer::Request`/`Connection`、`HttpRouter::Context`/`Response`，移除旧的 `HttpRequest`/`HttpResponse` 头文件碰撞
- **Router**：路径参数同时支持 Express 风格 `:param` 与原 `{param}` 两种语法
- **HttpServer**：新增 `HttpServerConfig`，`max_payload_size` 可配置（默认 4 MB），适配内存受限设备
- **Multipart 解析**：新增 `MultipartParser`，`HttpRequestContext` 支持延迟解析 `GetMultipartFields()`/`GetMultipartFiles()`
- **文件流式响应**：`HttpServerConnection::SendFileStreaming()` 64KB 分块传输大文件
- **WebSocket**：客户端不再依赖 `HttpClientEventListener`/`http_client.h`，自行处理升级握手；支持 WSS（TLS）
- **TLS 后端**：`TLS_BACKEND=openssl|mbedtls` CMake 选项；与后端无关的 `tls_factory.h`
- **HttpClient**：单飞（single-flight）启动/取消语义显式且原子；超时回调不再访问已销毁的客户端

#### Tasks

- `TaskRunner` 扩展：`PostDelayedTaskWithHandle`/`CancelDelayedTask`、`PostTaskAt(time_point)`、虚函数 `Now()`（便于测试 fake 时钟）
- `CronScheduler::TaskInfo` 新增 `nextRun`，`triggerCheck()` 加锁
- `TaskGroup` PascalCase 化；性能：移动入队减少 `std::function` 拷贝

#### Config

- `Config::LoadEnv(prefix)` — 从环境变量导入 `<PREFIX>_<KEY>`，自动转 `xxx.yyy` 路径
- `Config::Short(name, alias)` — 为选项追加单字符短名（如 `-p` 对应 `--port`）
- `ConfigWatcher`（`xtils/config/config_watcher.h`）— inotify 文件监听，热加载配置
- `GetOr<T>` 两种重载（带 fallback / 使用 Define 默认值）

#### App / Service

- `IService::Dependencies()` 虚函数 — 声明依赖服务名
- `App` 按拓扑序初始化、逆拓扑序反初始化；遇到环或未知依赖直接 abort
- `App::TopoSortServices()` 公开（用于单测）

#### Utils

- **`xtils/utils/crypto.h`** — SHA-256、HMAC-SHA1/256、安全随机、UUID v4（复用所选 TLS 后端）
- **`xtils/utils/result.h`** — `Result<T,E>` 增加 `is_err()`、`unwrap_or_else()`、`expect()`；错误模型见 `docs/error-model.md`
- JSON：新增零拷贝 `find(key)`/`find(index)`、`Json::object()`/`Json::array()` 工厂；修复 UTF-16 代理对解码、浮点 round-trip 精度（`%.17g`）、`operator[]`/`push_back` 类型安全（仅 null 可提升）

#### FSM / 行为树

- FSM：`HistoryEntry` 增加可读字段（`from_name`/`to_name`/`event_name`），新增 `DumpHistory`、`RegisterEvent`/`GetEventName`，历史改用 `deque`，`recursive_mutex`，`GetHistory()` 按值返回，新增 `SetRecordFailedEvents(bool)`
- 行为树：`SubTree`/`WaitForEvent`/`EventGuard` 节点；`sendEvent`/`peekEvent`/`consumeEvent`/`hasEvent`/`clearEvents` 事件队列；`pause`/`resume`；`LoadTreesFromDirectory`；结构化 `BtLogger`（`BtFileLogger`/`BtInspectLogger`/`BtCompositeLogger`）

#### IPC（v2.0 收尾）

- `IpcServer`/`IpcClient` 复用 `UnixSocketRaw`，支持 filesystem Unix、abstract Unix、TCP IPv4/IPv6 多种地址族
- 改为以 `TaskGroup` 作为唯一执行器 API，移除直接 `TaskRunner` 构造；服务端方法/通知通过 `TaskGroup` 派发，不再阻塞读循环
- 异步调用不再每次起一个 detached waiter 线程；回调通过显式或共享 `TaskGroup` 派发
- 修复对端在 `Disconnect()` 之前断开时挂起的等待者与读线程

#### Inspect

- 实现重写：~880 → ~330 行
- 内置双栏 Web 控制台（HTTP + WebSocket 面板），HTML 嵌入构建（`cmake/embed_file.cmake`）
- Handler 签名：`void(const Request&, Response&)`
- 新增 `PublishWithResult`、`GetSubscriberCount`、`GetRoutes`、`HasRoute`

#### 修复亮点

- `string_utils`：把误重命名的 `xtils` 参数改回 `base`（`Int*ToString`/`StringToInt*`）
- `App::Run()` 心跳看门狗用单调时钟 deadline；接受 `threads=1`
- `EventManager::Stop` 不再 stop 借用的 executor；默认构造的 manager 自管 executor
- `UnixSocketRaw::Receive`/`Send` 与 `Shutdown` 通过 fd 有效性检查避免竞争
- `HttpRouter` keep-alive 连接的 CORS 状态在请求间重置；避免悬空 `Origin` string_view；不向响应体追加 chunked 末尾 trailer

### 迁移指引

| 项 | 迁移 |
|----|------|
| `*_compat.h` 全部删除 | 改用 PascalCase API（v1.x 已支持） |
| `XTILS_ENABLE_DEPRECATED` | 从 CMake / build 中移除 |
| `HttpRequest`/`HttpResponse` 公共类型 | 改用 `HttpRouter::Context/Response` 或 `HttpClient::Request/Response` |
| `HttpClient::Request*` 同步入口 | 统一改用 `HttpClient::Send()` |
| `WebSocketClient` 旧的 HttpClient 依赖 | 不再需要单独传入 `HttpClient`/`HttpClientEventListener` |
| `IpcServer/IpcClient` 直接传 `TaskRunner*` | 改传 `TaskGroup&` 或不传（默认） |

---

## v1.1.0 <Badge type="info" text="2025-10-16" />

首个正式 tag。包含项目创建以来的全部基础模块。

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
