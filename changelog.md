# 更新日志

所有 xtils 的重要变更都记录在此（逆序排列）。

格式：`type(scope): description` — 类型：feat, fix, refactor, chore, tidy。

## 未发布

### 2025-05 — FSM 改进、Multipart 与 mbedTLS

- **fix(app)**: `Service::Deinit()` 现在在停止基础设施之前调用 — 服务可以在 `Deinit()` 中安全执行网络清理（如 WebSocket 关闭握手）
- **feat(fsm)**: 丰富 `HistoryEntry`，增加人可读名称（`from_name`, `to_name`, `event_name`）+ `DumpHistory()` 格式化输出
- **fix(fsm)**: 解决线程安全问题 — `recursive_mutex`、`GetHistory()` 按值返回、增加 `SetRecordFailedEvents(bool)`
- **refactor(fsm)**: 优化 FSM — `RegisterEvent`/`GetEventName` API、基于 deque 的历史记录、改进 `ToDotGraph`、废弃包装器移至 `fsm_compat.h`
- **fix(bt)**: Retry 装饰器现在正确传播 Running 状态而不消耗尝试次数
- **feat(net)**: 增加 `MultipartParser` 解析 multipart/form-data 请求体 + `HttpRequestContext` 上的延迟 `GetMultipartFields()`/`GetMultipartFiles()`
- **feat(net)**: 增加 `HttpServerConnection::SendFileStreaming()` 用于分块文件传输
- **feat(net)**: 增加 mbedTLS transport 后端，通过 `TLS_BACKEND` cmake 选项选择

### 2025-05（早期）— 代码质量与类型特征

- **fix(type_traits)**: 增加 `type_name_cstr` 用于 printf 安全使用
- **feat(bt)**: 增加结构化 `BtLogger` 用于离线和在线分析（CompositeLogger, FileLogger, InspectLogger）
- **fix**: 解决代码质量审查中的发现
- **refactor**: 全面代码质量改造 — 所有模块使用 PascalCase API、snake_case 遗留 API 添加 `[[deprecated]]` 包装器、扩展测试覆盖

### 2025-04 — 行为树事件与子树

- **feat(bt)**: 从 JSON 目录加载树（`LoadTreesFromDirectory`）
- **feat(bt)**: 增加事件驱动的子树控制（`SubTree`, `WaitForEvent`, `EventGuard` 节点）
- **feat(bt)**: 增加树事件系统（`sendEvent`, `consumeEvent`, `peekEvent`）
- **feat(bt)**: 增加 BtTree 的暂停/恢复支持

### 2025-03 — API 命名与 HTTP 改进

- **refactor(app)**: 重命名 `PostTask`/`PostAsyncTask` 为 `Spawn`/`SpawnAsync`
- **feat(http)**: 更新 HttpClient API（统一同步/异步接口）
- **fix(http)**: POST form/multipart 文件处理
- **fix(http)**: chunked transfer encoding 错误
- **chore**: 更新内部 TCP API 以适配 Transport 抽象

### 2025-02 — TLS 与 WebSocket

- **feat(net)**: 支持 WSS（WebSocket Secure）客户端
- **feat(net)**: HttpClient 支持 TLS（通过 Transport 层）
- **tidy**: 添加向后兼容的 API 包装器

### 2025-01 — 行为树基础

- **feat(bt)**: 树文件格式中增加树名称
- **feat(json)**: `dump(0)` 保持单行格式
- **feat(bt)**: 增加 `BtLogger` 接口和实现
- **feat(bt)**: 更新树 JSON 格式
- **feat(http)**: 支持 `multipart/form-data` 和大文件上传
- **fix(http)**: HTTP 客户端重定向处理
- **feat(bt)**: 更新节点接口（OnTick/OnStart/OnStop）
- **feat(bt)**: 增加常用节点（Sequence, Selector, Inverter, Delay 等）
- **feat(bt)**: 增加 Blackboard（`AnyMap`）
- **feat(bt)**: 使用 `AnyData` 替代 `std::any`
- **feat(bt)**: 增加 `dump()` / `dumpTree()` 树可视化
- **feat(app)**: 更新 service API
- **feat(bt)**: 增加节点输入/输出端口
- **feat(bt)**: 初始行为树实现，含 `BtFactory` JSON 构建器

### 2024 — 基础建设

- **feat(tasks)**: 增加 `EventManager` 类型化/枚举事件分发
- **feat**: 增加 `BUILD_WITH_SANITIZERS` CMake 选项
- **feat(json)**: 自定义 JSON 实现（替代 nlohmann_json）
- **tidy**: 导出 `cxx_std_17` 编译特性给消费者
- **feat(tasks)**: 更新 `TaskGroup` API
- **feat(logging)**: 退出时刷新日志
- **feat(net)**: 增加 WebSocket 客户端
- **feat(tasks)**: 增加 `CronScheduler`
- **feat(net)**: 增加 HttpClient, TcpServer, TcpClient, UdpServer, UdpClient
- **feat(fsm)**: 增强调试（历史记录、Graphviz 导出）
- **feat(debug)**: Tracer 使用 `forward_list` 减少内存使用

## 破坏性变更摘要

| 时间 | 变更 | 迁移方式 |
|------|------|---------|
| 2025-05 | `USE_OPENSSL`/`USE_MBEDTLS` → `TLS_BACKEND` | 使用 `TLS_BACKEND=openssl` 或 `TLS_BACKEND=mbedtls` |
| 2025-05 | `FSM::GetHistory()` 按值返回 | 更新持有 const 引用的代码 |
| 2025-05 | 所有公共 API 重命名为 PascalCase | 使用新名称；旧 snake_case 仍有效但发出废弃警告 |
| 2025-03 | `PostTask`/`PostAsyncTask` → `Spawn`/`SpawnAsync` | 使用新名称 |
| 2025-01 | BT 节点接口变更为 `OnTick`/`OnStart`/`OnStop` | 覆写新虚方法 |
| 2024 | 自定义 JSON 替代 nlohmann_json | 使用 `xtils::Json` API |
