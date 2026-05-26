# 应用框架

App 框架提供应用骨架：生命周期管理、服务注册、事件分发和定时器调度。

## 概述

xtils 应用遵循简单的模式：

1. 定义实现 `Init()` / `Deinit()` 的服务
2. 将它们注册到 `App` 单例
3. 框架管理事件循环、线程池和关闭流程

```cpp
#include <xtils/app/service.h>
#include <xtils/logging/logger.h>

class NetworkService : public xtils::Service<NetworkService> {
 public:
  NetworkService() : Service("network") {}

  void Init() override {
    // 基础设施已就绪 — 事件循环、线程池、配置均可用
    auto port = config.GetInt("port").value_or(8080);
    LogI("在端口 %d 上启动", (int)port);
    
    // 使用定时器
    ctx->Every(5000, [this]() { SendHeartbeat(); });
  }

  void Deinit() override {
    // 基础设施仍然存活 — 可安全进行网络清理
    CloseConnections();
  }
};
```

## App 单例

```cpp
#include "xtils/app/app.h"

App* App::Ins();  // 获取单例实例
```

### 服务注册

```cpp
// 注册单个服务
app.Register(std::make_shared<MyService>());

// 注册多个服务（按顺序初始化）
app.Register({
  std::make_shared<DatabaseService>(),
  std::make_shared<NetworkService>(),
  std::make_shared<UIService>()
});
```

### 生命周期控制

```cpp
void Init(const std::vector<std::string>& args);  // 使用 CLI 参数初始化
void Run();                                        // 阻塞直到关闭
void RunDaemon();                                  // 在后台线程运行事件循环
bool IsRunning();                                  // 检查是否正在运行
```

### 任务调度

```cpp
// 将任务发送到主线程（事件循环）
ctx->Spawn([]() {
  // 在主线程运行
});

// 将 CPU 密集型工作发送到线程池，可选的主线程回调
ctx->SpawnAsync(
  []() { /* 在工作线程执行重型任务 */ },
  []() { /* 完成后在主线程回调 */ }
);
```

### 定时器

```cpp
// 重复定时器（每 1000ms 触发）
ctx->Every(1000, []() { LogD("tick"); });

// 一次性定时器（5000ms 后触发一次）
ctx->Delay(5000, []() { LogI("延迟触发！"); });
```

### 事件（发布/订阅）

```cpp
// 定义事件结构
struct UserLoggedIn { std::string username; int user_id; };

// 订阅（在任何服务中）
ctx->Connect<UserLoggedIn>([](const UserLoggedIn& e) {
  LogI("用户登录: %s", e.username.c_str());
});

// 发布（从任何服务中）
ctx->Emit(UserLoggedIn{"alice", 42});
```

也支持基于枚举的简单信号：

```cpp
enum class AppEvent { DataReady, Shutdown, Refresh };

ctx->Connect<AppEvent>(AppEvent::DataReady, [](const AppEvent& e) {
  // 处理数据就绪
});

ctx->Emit(AppEvent::DataReady);
```

## Service 接口

### `IService` — 基类

```cpp
class IService {
 public:
  explicit IService(const char* name);
  virtual void Init() = 0;    // 基础设施就绪后调用
  virtual void Deinit() = 0;  // 基础设施关闭前调用

 protected:
  App* ctx;       // App 上下文（由框架注入）
  Config config;  // 服务专属配置段
  std::string name;
};
```

### `Service<T>` — CRTP 辅助类

```cpp
template <typename T>
class Service : public IService {
 public:
  explicit Service(const char* name);

  auto GetWeakPtr();           // 获取弱引用
  
  template <typename E>
  void Emit(const E& event);  // 便捷方法：通过 ctx 发送事件
};
```

### 服务生命周期保证

| 阶段 | 可用资源 | 典型用途 |
|------|---------|---------|
| 构造函数 | 无（没有 `ctx`） | 仅存储构造参数 |
| `Init()` | 事件循环、线程池、配置、其他服务 | 启动连接、注册路由、启动定时器 |
| 运行中 | 全部 | 正常操作 |
| `Deinit()` | 事件循环、线程池（仍在运行！） | 关闭连接、刷新缓冲区、取消定时器 |
| 析构函数 | 无 | 释放内存 |

::: warning
不要在构造函数或析构函数中执行 I/O 或使用定时器。请使用 `Init()` 和 `Deinit()`。
:::

## 全局函数

对于不需要完整服务模式的简单应用：

```cpp
#include "xtils/app/service.h"

xtils::Init(argc, argv);       // 使用参数初始化
xtils::Init({"--config-file", "app.json"});

if (xtils::IsOk()) {
  // App 初始化成功
}

xtils::RunForever();  // 阻塞在事件循环上
xtils::RunDaemon();   // 在后台运行
xtils::Shutdown();    // 触发优雅关闭
```

## 配置集成

每个服务自动接收与其名称匹配的配置段：

```json
{
  "network": {
    "port": 8080,
    "host": "0.0.0.0"
  },
  "database": {
    "url": "localhost:5432"
  }
}
```

```cpp
class NetworkService : public Service<NetworkService> {
  NetworkService() : Service("network") {}  // ← 名称匹配 JSON key

  void Init() override {
    // config 已预填充 "network" 段的内容
    auto port = config.GetInt("port").value_or(8080);
    auto host = config.GetString("host").value_or("0.0.0.0");
  }
};
```

## 完整示例

```cpp
#include <xtils/app/service.h>
#include <xtils/logging/logger.h>
#include <xtils/net/http_router.h>
#include <xtils/net/http_server.h>
#include <xtils/tasks/thread_task_runner.h>

using namespace xtils;

class ApiService : public Service<ApiService> {
 public:
  ApiService() : Service("api") {}

  void Init() override {
    auto port = config.GetInt("port").value_or(8080);

    runner_ = ThreadTaskRunner::CreateAndStart("api_io");
    router_ = std::make_unique<HttpRouter>();

    router_->Get("/api/health", [](const HttpRequestContext& ctx, HttpResponse& res) {
      res.Status(200).Json("{\"status\":\"ok\"}");
    });

    router_->Post("/api/data", [this](const HttpRequestContext& ctx, HttpResponse& res) {
      auto body = ctx.GetBody();
      LogI("收到: %s", body.c_str());
      res.Status(201).Json("{\"created\":true}");
    });

    handler_ = std::make_unique<RouterHttpRequestHandler>(std::move(router_));
    server_ = std::make_unique<HttpServer>(runner_.get(), handler_.get());
    server_->Start("0.0.0.0", port);

    LogI("[API] 服务器已在端口 %d 启动", port);
  }

  void Deinit() override {
    server_->Stop();
    LogI("[API] 服务器已停止");
  }

 private:
  ThreadTaskRunner runner_;
  std::unique_ptr<HttpRouter> router_;
  std::unique_ptr<RouterHttpRequestHandler> handler_;
  std::unique_ptr<HttpServer> server_;
};

void app_main(App& app, const std::vector<std::string>& args) {
  app.Register(std::make_shared<ApiService>());
}
```
