# 调试工具

Debug 模块提供两个互补的运行时自省工具：

- **Inspect** — HTTP/WebSocket 调试服务器，用于实时监控和控制
- **Tracer** — Chrome 追踪格式的性能分析器

两者都可在编译时完全剥离：设置 `INSPECT_DISABLE=ON` 和不定义 `ENABLE_TRACE_RECORDING`。

## Inspect — HTTP/WebSocket 调试服务器

Inspect 提供内置 HTTP 服务器，用于在运行时暴露内部状态、指标和控制接口。支持 REST 风格的路由和 WebSocket 发布/订阅，用于实时数据流。

### 头文件

```cpp
#include "xtils/debug/inspect.h"
```

### 初始化

```cpp
auto& inspect = Inspect::Get();  // 单例
inspect.Init("127.0.0.1", 8080);
inspect.Stop();
```

### 注册路由

```cpp
// 带描述的路由（显示在内置 Web 控制台中）
inspect.Route("/debug/stats", "应用统计",
    [](const Inspect::Request& req, Inspect::Response& resp) {
  Json stats;
  stats["uptime_s"] = GetUptime();
  stats["requests"] = request_count;
  resp = Inspect::Json(stats);
});

// 静态内容
inspect.Static("/debug/dashboard", dashboard_html, "text/html");
```

### 响应辅助方法

```cpp
static Inspect::Response Json(const xtils::Json& json);
static Inspect::Response Text(const std::string& text);
static Inspect::Response Html(const std::string& html);
static Inspect::Response Error(const std::string& message);
static Inspect::Response Success(const std::string& message = "OK");
```

### WebSocket 发布/订阅

```cpp
// 注册 WebSocket 端点
inspect.WebSocket("/debug/metrics", "实时指标流",
    [](const Inspect::Request& req, Inspect::Response& resp) {
  resp = Inspect::Success();
});

// 向所有连接的客户端发布
Json metrics;
metrics["cpu"] = cpu_percent;
metrics["memory_mb"] = memory_mb;
inspect.Publish("/debug/metrics", metrics);

// 检查是否有人在监听（避免昂贵的序列化）
if (inspect.HasSubscribers("/debug/metrics")) {
  inspect.Publish("/debug/metrics", CollectMetrics().dump());
}

// 获取详细发布结果
auto result = inspect.PublishWithResult("/debug/metrics", message);
if (result.HasFailures()) {
  LogW("发布失败: %zu", result.failed_count);
}
```

### Web 控制台

Inspect 内置双栏 Web 控制台（访问根路径即可打开）：

- **左栏**：已注册的路由列表，点击即可发起请求
- **右栏上方**：HTTP 面板 — 支持 GET/POST，自动 JSON 格式化响应
- **右栏下方**：WebSocket 面板 — 实时消息流，颜色区分收发/系统/错误

无需额外配置，启动 Inspect 服务器后浏览器访问即可使用。

### 宏（禁用时零开销）

当定义 `INSPECT_DISABLE` 时，这些宏编译为空：

```cpp
INSPECT_ROUTE("/debug/fsm", "FSM 状态",
    [&](const Inspect::Request& req, Inspect::Response& resp) {
  resp = Inspect::Json(fsm.ToJson());
});

INSPECT_WEBSOCKET("/debug/events", "实时事件",
    [](const Inspect::Request& req, Inspect::Response& resp) {
  resp = Inspect::Success();
});

INSPECT_PUBLISH("/debug/events", event_json.dump());
```

### 用例：实时仪表板

```cpp
class MonitorService : public Service<MonitorService> {
 public:
  MonitorService() : Service("monitor") {}

  void Init() override {
    INSPECT_WEBSOCKET("/debug/live", "实时指标",
        [](const Inspect::Request& req, Inspect::Response& resp) {
      resp = Inspect::Success();
    });

    ctx->Every(1000, [this]() {
      if (!Inspect::Get().HasSubscribers("/debug/live")) return;

      Json m;
      m["timestamp"] = SteadyTimer::GetCurrentTimestampMs();
      m["connections"] = GetConnectionCount();
      INSPECT_PUBLISH("/debug/live", m.dump());
    });
  }
};
```

## Tracer — Chrome 追踪格式

Tracer 以 Chrome 追踪格式记录作用域事件，可在 `chrome://tracing` 或 [Perfetto UI](https://ui.perfetto.dev/) 中查看。

### 头文件

```cpp
#include "xtils/debug/tracer.h"
```

### 启用

Tracer 在编译时选择启用：

```cpp
#define ENABLE_TRACE_RECORDING  // 必须在 #include 之前
#include "xtils/debug/tracer.h"
```

不定义 `ENABLE_TRACE_RECORDING` 时，所有追踪宏编译为空。

### 宏

```cpp
TRACE_SCOPE("ProcessFrame")    // 作用域事件（RAII）
TRACE_INSTANT("FrameReady")   // 瞬时事件
TRACE_SAVE("trace.json")      // 保存到文件
```

### 示例：帧循环分析

```cpp
#define ENABLE_TRACE_RECORDING
#include <xtils/debug/tracer.h>

void GameLoop() {
  while (running) {
    TRACE_SCOPE("Frame");

    {
      TRACE_SCOPE("Physics");
      UpdatePhysics();
    }

    {
      TRACE_SCOPE("Render");
      RenderScene();
    }
  }
}

TRACE_SAVE("game_trace.json");
// 在 chrome://tracing 或 https://ui.perfetto.dev/ 中打开
```

### 查看追踪

1. 运行启用追踪记录的应用
2. 调用 `TRACE_SAVE("output.json")`
3. 打开 Chrome，导航到 `chrome://tracing`
4. 点击"Load"并选择追踪文件
5. 或使用 [Perfetto UI](https://ui.perfetto.dev/) 获得更现代的查看器

## 编译时剥离

| 模块 | 禁用标志 | 效果 |
|------|---------|------|
| Inspect | `INSPECT_DISABLE=ON`（CMake） | 所有 `INSPECT_*` 宏变为空操作 |
| Tracer | 不定义 `ENABLE_TRACE_RECORDING` | 所有 `TRACE_*` 宏变为空操作 |

这意味着你可以在代码中随处添加调试工具，在生产构建中完全零运行时开销。

## 完整示例

```cpp
#define ENABLE_TRACE_RECORDING
#include <xtils/app/service.h>
#include <xtils/debug/inspect.h>
#include <xtils/debug/tracer.h>
#include <xtils/logging/logger.h>

using namespace xtils;

class DebugService : public Service<DebugService> {
 public:
  DebugService() : Service("debug") {}

  void Init() override {
    auto port = config.GetOr<int>("inspect_port", 9090);
    Inspect::Get().Init("0.0.0.0", port);

    INSPECT_ROUTE("/system/info", "系统信息",
        [](const Inspect::Request& req, Inspect::Response& resp) {
      Json info;
      info["version"] = "1.0.0";
      info["uptime"] = GetUptime();
      info["pid"] = getpid();
      resp = Inspect::Json(info);
    });

    INSPECT_ROUTE("/trace/save", "保存追踪数据",
        [](const Inspect::Request& req, Inspect::Response& resp) {
      TRACE_SAVE("runtime_trace.json");
      resp = Inspect::Success("追踪已保存");
    });

    LogI("[Debug] Inspect 服务器在端口 %d", port);
  }

  void Deinit() override {
    TRACE_SAVE("shutdown_trace.json");
    Inspect::Get().Stop();
  }
};
```
