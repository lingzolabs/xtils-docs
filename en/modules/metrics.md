# Metrics

`xtils::metrics` provides lightweight metric primitives and a Prometheus text exporter for service monitoring. Zero dependencies, single header at `include/xtils/metrics/metrics.h`.

## Overview

Three primitive types:

| Type | Semantics | Typical use |
|------|-----------|-------------|
| **Counter** | Monotonically increasing (`Inc`) | Total requests, total errors |
| **Gauge** | Up / down (`Set` / `Inc` / `Dec`) | Active connections, queue length |
| **Histogram** | Bucketed cumulative + sum/count | Request latency distribution |

Each metric type supports a **labelled family**: one metric name records multiple cells keyed by label values.

```cpp
#include "xtils/metrics/metrics.h"
using namespace xtils::metrics;

MetricRegistry registry;

auto& reqs = registry.Counter(
    "http_requests_total", "Total HTTP requests",
    {"method", "status"});

reqs.Labels({"GET", "200"}).Inc();
reqs.Labels({"POST", "500"}).Inc();

// Render as Prometheus text format.
std::string body = PrometheusExporter::Render(registry);
// body can be returned as the response of GET /metrics
```

## Header

```cpp
#include "xtils/metrics/metrics.h"
```

Namespace: `xtils::metrics`.

## Counter

Monotonic counter, atomic (`relaxed`).

```cpp
class Counter {
 public:
  void Inc(uint64_t v = 1);
  uint64_t Value() const;
};
```

## Gauge

Up/down value.

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

Pre-defined upper bounds plus an implicit `+Inf` bucket. After `Observe(v)`, `Snap()` returns cumulative counts.

```cpp
class Histogram {
 public:
  // upper_bounds must be strictly ascending; +Inf bucket is implicit.
  explicit Histogram(std::vector<double> upper_bounds);

  void Observe(double value);

  struct Snapshot {
    std::vector<std::pair<double, uint64_t>> buckets;  // cumulative
    uint64_t count = 0;
    double sum = 0.0;
  };
  Snapshot Snap() const;
};
```

```cpp
Histogram h({0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0});
h.Observe(0.013);
h.Observe(0.7);

auto snap = h.Snap();
LogI("count=%llu sum=%.3f", snap.count, snap.sum);
```

## Labelled families

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
class HistogramFamily { /* same shape, ctor also takes upper_bounds */ };
```

For unlabelled families pass `Labels({})` to get the singleton cell.

## MetricRegistry

Centralised get-or-create registry:

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
Subsequent `Counter("name", ...)` calls return the same family. The first call's `help` / `label_names` are kept.
:::

## PrometheusExporter

```cpp
class PrometheusExporter {
 public:
  static std::string Render(const MetricRegistry& registry);
};
```

Suitable for `Content-Type: text/plain; version=0.0.4`.

## End-to-end example: expose `/metrics` over HTTP

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
        [&](const HttpRouter::Context&, HttpRouter::Response& res) {
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
    server_  = std::make_unique<HttpServer>(runner_.get(), handler_.get());
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

::: tip Performance
- `Counter` / `Gauge` use relaxed atomic ops — almost zero cost on the hot path.
- `Histogram` uses an internal `std::mutex`; under heavy contention consider sharding by worker.
- `Family::Labels()` takes a lock on first insert into the `std::map`; subsequent lookups are cheap.
:::
