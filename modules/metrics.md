# 指标（Metrics）

`xtils::metrics` 提供轻量级指标原语和 Prometheus 文本导出，用于服务监控。零依赖，全部位于 `include/xtils/metrics/metrics.h`。

## 概述

三种基础指标：

| 类型 | 语义 | 典型用途 |
|------|------|---------|
| **Counter** | 单调递增（`Inc`） | 请求总数、错误总数 |
| **Gauge** | 上下浮动（`Set`/`Inc`/`Dec`） | 在线连接数、队列长度 |
| **Histogram** | 桶累计 + sum/count | 请求延迟分布 |

每种指标支持**带标签的 family**：同一指标名按 label 维度记录多个 cell。

```cpp
#include "xtils/metrics/metrics.h"
using namespace xtils::metrics;

MetricRegistry registry;

auto& reqs = registry.Counter(
    "http_requests_total", "Total HTTP requests",
    {"method", "status"});

reqs.Labels({"GET", "200"}).Inc();
reqs.Labels({"POST", "500"}).Inc();

// 渲染为 Prometheus 文本格式
std::string body = PrometheusExporter::Render(registry);
// body 可作为 GET /metrics 的响应
```

## 头文件

```cpp
#include "xtils/metrics/metrics.h"
```

命名空间：`xtils::metrics`。

## Counter

单调递增的计数器，原子操作（`relaxed`）。

```cpp
class Counter {
 public:
  void Inc(uint64_t v = 1);
  uint64_t Value() const;
};
```

无标签的快速用法（直接构造即可，但通常通过 `Family<Counter>` 暴露给 exporter）。

## Gauge

可上下浮动的度量。

```cpp
class Gauge {
 public:
  void Set(int64_t v);
  void Inc(int64_t v = 1);
  void Dec(int64_t v = 1);
  int64_t Value() const;
};
```

## Histogram

预设上界桶 + `+Inf` 桶。`Observe(v)` 后 `Snap()` 返回累计计数。

```cpp
class Histogram {
 public:
  // upper_bounds 必须严格递增；+Inf 桶隐式
  explicit Histogram(std::vector<double> upper_bounds);

  void Observe(double value);

  struct Snapshot {
    std::vector<std::pair<double, uint64_t>> buckets;  // 累计计数
    uint64_t count = 0;
    double sum = 0.0;
  };
  Snapshot Snap() const;
};
```

示例：

```cpp
Histogram h({0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0});
h.Observe(0.013);
h.Observe(0.7);

auto snap = h.Snap();
LogI("count=%llu sum=%.3f", snap.count, snap.sum);
```

## 带标签的 Family

```cpp
template <typename Cell>
class Family {
 public:
  Family(std::string name, std::string help, std::vector<std::string> label_names);

  Cell& Labels(const std::vector<std::string>& values);

  const std::string& Name() const;
  const std::string& Help() const;
  const std::vector<std::string>& LabelNames() const;
  std::vector<std::pair<std::vector<std::string>, const Cell*>> All() const;
};

using CounterFamily = Family<Counter>;
using GaugeFamily   = Family<Gauge>;
class HistogramFamily { /* 同样的接口，构造时还需要 upper_bounds */ };
```

无标签 family 用 `Labels({})` 取唯一 cell。

## MetricRegistry

集中管理多个 family，按名字 get-or-create：

```cpp
class MetricRegistry {
 public:
  CounterFamily&   Counter  (const std::string& name,
                             const std::string& help = "",
                             std::vector<std::string> label_names = {});
  GaugeFamily&     Gauge    (const std::string& name,
                             const std::string& help = "",
                             std::vector<std::string> label_names = {});
  HistogramFamily& Histogram(const std::string& name,
                             const std::string& help = "",
                             std::vector<std::string> label_names = {},
                             std::vector<double> upper_bounds = {});

  std::vector<const CounterFamily*>   Counters()   const;
  std::vector<const GaugeFamily*>     Gauges()     const;
  std::vector<const HistogramFamily*> Histograms() const;
};
```

::: tip
重复调用 `Counter("name", ...)` 返回同一 family；首次调用提供的 `help`/`label_names` 会被记住。
:::

## PrometheusExporter

```cpp
class PrometheusExporter {
 public:
  static std::string Render(const MetricRegistry& registry);
};
```

输出适配 `Content-Type: text/plain; version=0.0.4`。

## 完整示例：HTTP 暴露 /metrics

```cpp
#include <xtils/app/service.h>
#include <xtils/metrics/metrics.h>
#include <xtils/net/http_router.h>
#include <xtils/net/http_server.h>
#include <xtils/tasks/thread_task_runner.h>

using namespace xtils;
using namespace xtils::metrics;

class ApiService : public Service<ApiService> {
 public:
  ApiService() : Service("api") {}

  void Init() override {
    runner_ = ThreadTaskRunner::CreateAndStart("api_io");

    auto& http_reqs = registry_.Counter(
        "http_requests_total", "Total HTTP requests", {"method", "status"});
    auto& http_lat = registry_.Histogram(
        "http_request_seconds", "Request latency", {"method"},
        {0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0});

    router_ = std::make_unique<HttpRouter>();

    router_->Get("/api/hello",
        [&](const HttpRouter::Context& ctx, HttpRouter::Response& res) {
      auto t0 = std::chrono::steady_clock::now();
      res.Status(200).Json("{\"hello\":\"world\"}");
      auto dt = std::chrono::duration<double>(
                    std::chrono::steady_clock::now() - t0).count();
      http_lat.Labels({"GET"}).Observe(dt);
      http_reqs.Labels({"GET", "200"}).Inc();
    });

    router_->Get("/metrics",
        [&](const HttpRouter::Context&, HttpRouter::Response& res) {
      res.Status(200)
         .Header("Content-Type", "text/plain; version=0.0.4")
         .Body(PrometheusExporter::Render(registry_));
    });

    handler_ = std::make_unique<RouterHttpRequestHandler>(std::move(router_));
    server_ = std::make_unique<HttpServer>(runner_.get(), handler_.get());
    server_->Start("0.0.0.0", config.GetOr<int>("port", 8080));
  }

  void Deinit() override { server_->Stop(); }

 private:
  ThreadTaskRunner runner_;
  std::unique_ptr<HttpRouter> router_;
  std::unique_ptr<RouterHttpRequestHandler> handler_;
  std::unique_ptr<HttpServer> server_;
  MetricRegistry registry_;
};
```

::: tip 性能
- `Counter`/`Gauge` 使用 `std::atomic<...>` 的 relaxed 操作，热路径几乎无开销
- `Histogram` 内部用 `std::mutex`；高并发场景可按 worker 维度拆分 family
- `Family::Labels()` 第一次需要插入 `std::map`（加锁），之后命中缓存
:::
