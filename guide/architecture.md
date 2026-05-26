# 架构设计

## 模块依赖关系

xtils 的模块按层次组织，底层模块没有向上的依赖：

![模块依赖层次图](/images/module-layers.svg)

**关键依赖关系：**
- `net` 依赖 `tasks`（事件循环）和 `system`（套接字）
- `fsm` 仅依赖 `utils`（json, type_traits）
- `app` 编排一切：拥有事件循环、线程池和服务生命周期
- `debug/inspect` 使用 `net` 提供 HTTP/WebSocket 调试接口

## 目录布局

```
xtils/
├── include/xtils/              # 公共头文件（#include 路径）
│   ├── app/                    # app.h, service.h, auto-gen.h
│   ├── config/                 # config.h
│   ├── debug/                  # inspect.h, tracer.h
│   ├── fsm/                    # fsm.h, fsm_compat.h, behavior_tree.h
│   ├── logging/                # logger.h, sink.h, watchdog.h
│   ├── net/                    # 网络模块
│   │   ├── transport/          # transport.h, tls_transport.h, tls_factory.h
│   │   ├── http_client.h / http_server.h
│   │   ├── http_router.h      # Express 风格路由
│   │   ├── http_multipart.h   # multipart/form-data 解析器
│   │   ├── tcp_client.h / tcp_server.h
│   │   ├── udp_client.h / udp_server.h
│   │   └── websocket_client.h
│   ├── system/                 # 操作系统抽象
│   ├── tasks/                  # 异步与调度
│   └── utils/                  # 通用工具
├── src/                        # 实现文件（.cc）
├── tests/                      # 单元测试（doctest）
├── examples/                   # 内置示例
├── cmake/                      # CMake 辅助脚本
└── docs/                       # 文档
```

## 事件循环架构

xtils 的核心是基于 Linux `epoll`（兼容 `poll` 回退）的**事件循环**：

```
┌──────────────────────────────────────────┐
│              UnixTaskRunner               │
│                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────┐  │
│  │  epoll   │  │  定时器  │  │ 任务  │  │
│  │  (I/O)   │  │  (堆)    │  │(队列) │  │
│  └──────────┘  └──────────┘  └───────┘  │
│        │             │            │      │
│        └─────────────┴────────────┘      │
│                     │                    │
│              事件循环 tick                │
└──────────────────────────────────────────┘
```

- **I/O 监视**：文件描述符（套接字、eventfd）可读时触发回调
- **定时器**：按截止时间排序，每次循环迭代时触发
- **任务队列**：按顺序执行提交的工作项

`ThreadTaskRunner` 在专用线程上包装 `UnixTaskRunner`，提供线程安全的 `PostTask`/`PostDelayedTask`。

## 服务生命周期

```
App::Init()
  │
  ├─ 创建线程池（TaskGroup）
  ├─ 创建事件循环（UnixTaskRunner）
  ├─ 加载配置文件
  ├─ 对每个已注册的服务：
  │    ├─ 注入 App* 上下文
  │    ├─ 注入服务专属配置段
  │    └─ 调用 service.Init()
  │
  └─ App::Run() — 阻塞在事件循环上

App::Shutdown()
  │
  ├─ 对每个服务（逆序）：
  │    └─ 调用 service.Deinit()    ← 此时基础设施仍然存活！
  ├─ 停止线程池
  └─ 停止事件循环
```

::: warning 重要
`Deinit()` 在基础设施关闭**之前**被调用。这意味着服务在清理阶段仍然可以使用事件循环、定时器和线程池（例如 WebSocket 关闭握手、刷新待处理的 I/O）。
:::

## 线程模型

xtils 使用**单主线程 + 工作池**模型：

| 线程 | 角色 | 访问模式 |
|------|------|---------|
| 主线程 | 事件循环、I/O 回调、定时器回调 | 所有 `net` 回调在此触发 |
| 工作线程 | `SpawnAsync` 任务、CPU 密集型工作 | 通过 `TaskGroup` |
| 服务线程 | `ThreadTaskRunner` 实例 | 由服务按需创建 |

::: tip
网络回调始终在主事件循环线程上触发。使用 `Spawn()` 将结果发回主线程，或使用 `SpawnAsync()` 卸载重型工作。
:::

## TLS 架构

```
                    应用代码
                      │
                      ▼
           ┌─────────────────────┐
           │    tls_factory.h    │  ← 与后端无关的 API
           └─────────────────────┘
                 │           │
      ┌──────────┘           └──────────┐
      ▼                                 ▼
┌─────────────────┐          ┌─────────────────┐
│  OpenSSL 后端   │          │  mbedTLS 后端   │
│  tls_transport  │          │ mbedtls_transport│
└─────────────────┘          └─────────────────┘
```

两种后端实现相同的 `Transport` 接口。通过 `TLS_BACKEND` CMake 选项在编译时选择。

## 构建系统细节

### 传播给消费者的编译定义

| 定义 | 条件 |
|-----|------|
| `USE_OPENSSL` | `TLS_BACKEND=openssl` |
| `USE_MBEDTLS` | `TLS_BACKEND=mbedtls` |
| `INSPECT_DISABLE` | `INSPECT_DISABLE=ON` |

### 导出的 CMake 目标

- `xtils` — 主静态库（包含所有模块）
- 传递链接：pthread、TLS 后端库

### 源码组织

每个模块在 `src/<module>/` 目录下有对应的实现文件，通常每个类/组件一个 `.cc` 文件。
