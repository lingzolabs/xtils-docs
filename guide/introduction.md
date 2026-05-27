# 简介

## 什么是 xtils？

**xtils** 是一个实用至上的 C++17 工具库，旨在把 Go/Python/Rust 标准库的开发体验带给 C++。无需引入大量独立的第三方依赖，xtils 提供了一组协同工作的模块 — 从应用生命周期管理、配置系统到网络通信、状态机和异步任务调度。

## 为什么选择 xtils？

构建一个 C++ 应用通常需要拼接很多库：一个用于 HTTP，一个用于日志，再来一个处理 JSON、定时器、线程池等等。每个库都有不同的约定、构建系统和 API 风格。xtils 通过以下方式解决这些问题：

- **统一的 API 风格** — PascalCase 命名、一致的错误处理、所有模块共享相同约定
- **零摩擦集成** — 单个静态库，一行 `target_link_libraries`，自动传播 C++17
- **极少外部依赖** — 仅需 TLS 后端（OpenSSL 或 mbedTLS），其余全部自包含
- **生产级原语** — 经过实战验证的网络通信、异步 I/O 和状态机实现

### 与其他库对比

| | xtils | Boost | Abseil | POCO |
|---|---|---|---|---|
| **定位** | 实用优先，开箱即用 | 大而全但笨重 | 底层构建模块 | 框架导向 |
| **接入成本** | 单个静态库，CMake 一行搞定 | 模块系统复杂 | 以 Bazel 为中心 | 重量级框架 |
| **HTTP 服务** | ✅ 内置路由 | ❌ Beast 过于底层 | ❌ 不提供 | ✅ 但 API 陈旧 |
| **日志** | ✅ 异步、滚转、分级 | ❌ Boost.Log 啰嗦 | ✅ 但功能简陋 | ✅ |
| **状态机** | ✅ 带历史记录 + 行为树 | ❌ Boost.MSM 模板地狱 | ❌ 不提供 | ❌ |
| **定时任务** | ✅ Cron 表达式、事件循环 | ❌ | ❌ | ❌ |
| **上手难度** | 低 | 高 | 中 | 中 |

## 设计原则

### 内聚而非拼凑

xtils 的模块被设计为协同工作。App 框架拥有驱动网络的事件循环，TaskRunner 接口在定时器、HTTP 服务器和 WebSocket 客户端之间共享，Config 模块与 App 生命周期集成。这意味着更少的胶水代码和更少的意外。

### 显式而非隐式

API 简单直接且可预测：
- 除了 App 单例（可选使用）外没有全局状态
- 没有隐藏线程 — 通过 TaskRunner 控制工作的执行位置
- 没有隐式内存分配 — 通过 `std::unique_ptr` 和 `std::shared_ptr` 明确所有权

### 面向 C++17

xtils 以 C++17 为目标，在最大化兼容性的同时利用现代特性：
- `std::optional` 用于可空返回值
- `std::string_view` 用于零拷贝字符串传递
- 内部使用 `std::variant` 和 `if constexpr`
- 适当使用结构化绑定和折叠表达式

## 模块概览

| 模块 | 头文件前缀 | 功能 |
|------|-----------|------|
| [App](/modules/app) | `xtils/app/` | 应用生命周期、服务注册、事件、定时器 |
| [Config](/modules/config) | `xtils/config/` | JSON 配置、CLI 解析、点分路径访问 |
| [FSM](/modules/fsm) | `xtils/fsm/` | 有限状态机、守卫条件、历史记录、Graphviz 导出 |
| [行为树](/modules/behavior-tree) | `xtils/fsm/` | JSON 驱动的行为树、黑板、端口、子树 |
| [日志](/modules/logging) | `xtils/logging/` | 异步日志器、滚动文件、系统看门狗 |
| [网络](/modules/networking) | `xtils/net/` | TCP/UDP、HTTP、WebSocket、TLS、路由 |
| [任务](/modules/tasks) | `xtils/tasks/` | 事件循环、线程池、任务组、定时器、Cron 调度 |
| [工具](/modules/utils) | `xtils/utils/` | JSON、字符串、文件 I/O、Base64、字节读写、RAII |
| [调试](/modules/debug) | `xtils/debug/` | HTTP/WS 调试服务器、Chrome 追踪格式分析器 |

## 快速示例

以下是一个使用 App 框架配合定时器和日志的最小应用：

```cpp
#include <xtils/app/service.h>
#include <xtils/logging/logger.h>

using namespace xtils;

class MyService : public Service<MyService> {
 public:
  MyService() : Service<MyService>("my_service") {}

  void Init() override {
    LogI("[MyService] 已初始化！");
    
    // 每秒触发的重复定时器
    ctx->Every(1000, [this]() {
      LogD("[MyService] Tick!");
    });

    // 5 秒后触发的一次性定时器
    ctx->Delay(5000, [this]() {
      LogI("[MyService] 5 秒已过，正在关闭...");
      ctx->Shutdown();
    });
  }

  void Deinit() override {
    LogI("[MyService] 正在优雅关闭");
  }
};

void app_main(App& app, const std::vector<std::string>& args) {
  app.Register(std::make_shared<MyService>());
}
```

## 下一步

- **[快速开始](/guide/getting-started)** — 克隆、构建并在项目中链接 xtils
- **[架构设计](/guide/architecture)** — 了解模块依赖关系和构建系统
- **[应用框架](/modules/app)** — 深入了解应用生命周期
