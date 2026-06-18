# 日志系统

Logging 模块提供异步日志器，支持 printf 风格格式化、多级别日志、控制台和滚动文件输出、每模块日志标签、可插拔格式器，以及系统资源看门狗。

## 概述

xtils 的日志系统专为嵌入式和服务器应用设计。默认使用异步环形缓冲区（热路径零内存分配），支持多输出目标，每个 Sink 可独立配置格式化方式。

```cpp
#define LOG_TAG_STRING "my_module"
#include <xtils/logging/logger.h>

LogI("服务器在端口 %d 上启动", 8080);
LogW("连接池紧张: %d/%d", available, total);
LogE("连接失败: %s", error.c_str());
```

## 头文件

```cpp
#include "xtils/logging/logger.h"
```

## 日志宏

### 默认日志器（推荐日常使用）

```cpp
LogT(fmt, ...)   // Trace（仅在定义 ENABLE_TRACE_LOGGING 时编译）
LogD(fmt, ...)   // Debug
LogI(fmt, ...)   // Info
LogW(fmt, ...)   // Warning
LogE(fmt, ...)   // Error
```

### 实例级宏（XTILS_ 前缀）

用于操作自定义 Logger 实例：

```cpp
auto* logger = xtils::logger::DefaultLogger();

XTILS_LOG_T(logger, "trace: %s", msg);  // 需要 ENABLE_TRACE_LOGGING
XTILS_LOG_D(logger, "debug: %d", value);
XTILS_LOG_I(logger, "info");
XTILS_LOG_W(logger, "warning");
XTILS_LOG_E(logger, "error: %s", err);
```

### Opt-in 短名宏

如果希望使用 `TRACE`/`DEBUG`/`INFO`/`WARN`/`ERROR` 等短名，在 include 之前定义：

```cpp
#define XTILS_LOG_SHORT_MACROS
#include <xtils/logging/logger.h>

TRACE(logger, "trace message");
DEBUG(logger, "debug message");
INFO(logger, "info message");
WARN(logger, "warning message");
ERROR(logger, "error message");
```

::: warning
短名宏可能与其他库冲突（如 Windows `ERROR`），因此默认不启用。
:::

### 断言与 Fatal

```cpp
XTILS_CHECK(expr)       // 断言失败则 LogE + abort
XTILS_DCHECK(expr)      // Debug 断言（Release 中仍生效）
XTILS_FATAL(fmt, ...)   // LogE + abort
```

使用 `XTILS_LOG_SHORT_MACROS` 时可用短名 `CHECK`/`DCHECK`/`FATAL`。

## 日志级别

```
trace (0) → debug (1) → info (2) → warn (3) → error (4)
```

低于配置级别的消息会被丢弃。生产环境建议设置为 `info` 或 `warn`。

## 日志标签

设置每文件的日志标签来标识消息来源模块：

```cpp
// 在 .cc 文件顶部，在 include logger.h 之前
#define LOG_TAG_STRING "network"
#include "xtils/logging/logger.h"

// 输出: [I][network] 连接已建立
LogI("连接已建立");
```

## 结构化日志（LogBuilder）

除了传统 printf 风格宏，v2.0 起提供链式字段 API，适合加载上下文、交给后端解析。

```cpp
#include "xtils/logging/log_builder.h"

LOGI().Field("req_id", id)
      .Field("status", code)
      .Msg("done");

LOGW().Field("path", path)
      .Field("latency_ms", latency)
      .Msg("slow request");

// 也可以是 printf 格式字符串
LOGE().Field("errno", errno).Msg("open(%s) failed", path.c_str());
```

输出示例（`PlainFormatter`）：

```
2026-06-17 10:30:00 I default: done req_id=abc123 status=200
```

### 可用宏

| 宏 | 等价 |
|----|------|
| `LOGI()` | info |
| `LOGW()` | warn |
| `LOGE()` | error |
| `LOGD()` | debug |
| `LOGT()` | trace（`ENABLE_TRACE_LOGGING` 未定义时可能被编译器优化为 no-op） |

### 终结方法

- `Msg(const std::string& body)` / `Msg()`　 — 发送一条日志
- `Msg(const char* fmt, ...)`  — printf 风格主体
- `RenderForTesting()`  — 仅返回拼接后的字段字符串，不发送

若 `LogBuilder` 未调用 `Msg`，析构时会以空主体自动 flush。

## MDC（诊断上下文）

Mapped Diagnostic Context 提供线程局部的键/值上下文，在同一线程上调用任何 `LogBuilder` 时自动拼接。

```cpp
#include "xtils/logging/mdc.h"
using xtils::logger::Mdc;

void HandleRequest(const Request& r) {
  Mdc::Put("req_id", r.id);
  Mdc::Put("user",   r.user);

  LOGI().Msg("request received");   // 会附带 req_id=... user=...
  DoWork();
  LOGI().Msg("request done");

  Mdc::Clear();
}
```

### RAII Scope

最常用的是 `Mdc::Scope`，限定上下文生命周期，退出作用域时恢复原值：

```cpp
void HandleRequest(const Request& r) {
  Mdc::Scope s1("req_id", r.id);
  Mdc::Scope s2("user",   r.user);

  LOGI().Msg("request received");
  DoWork();
  LOGI().Msg("request done");
  // 退出作用域时 req_id / user 被恢复为之前的值（或被移除）
}
```

### API

```cpp
class Mdc {
 public:
  static void Put  (std::string key, std::string value);
  static void Erase(const std::string& key);
  static const std::string& Get(const std::string& key);  // 缺省返回空串
  static void Clear();
  static std::vector<std::pair<std::string,std::string>> Snapshot();

  class Scope { Scope(std::string key, std::string value); };
};
```

::: tip
MDC 数据是线程局部的，一个线程设置的上下文不会被另一个线程看到。在 `ThreadTaskRunner` 上跳转任务时，如需携带上下文，需要手动传递。
:::

## Logger API

```cpp
namespace xtils::logger {

Logger* DefaultLogger();

class Logger {
 public:
  void SetLevel(log_level level);
  log_level Level() const;

  // 添加输出目标，可选独立的格式器（默认 PlainFormatter）
  void AddSink(std::unique_ptr<Sink> sink,
               std::unique_ptr<Formatter> formatter = nullptr);

  void Flush();
  void Shutdown();
  size_t GetDroppedCount() const;  // 因缓冲区满而丢弃的消息数
};

void SetLevel(Logger* logger, log_level level);  // 便捷函数

}
```

## Formatter（格式器）

每个 Sink 可配置独立的格式器，控制日志条目的输出格式：

```cpp
#include "xtils/logging/sink.h"

// 格式器接口
class Formatter {
 public:
  virtual std::string Format(const LogEntry& entry) const = 0;
};

// 内置实现
class PlainFormatter : public Formatter;  // 纯文本，无 ANSI 颜色
class ColorFormatter : public Formatter;  // 带 ANSI 颜色（用于终端）
```

### 用法

```cpp
auto* logger = xtils::logger::DefaultLogger();

// 文件 Sink 使用纯文本格式
logger->AddSink(
    std::make_unique<FileSink>("logs/app.log", 10*1024*1024, 5),
    std::make_unique<PlainFormatter>());

// 控制台 Sink 使用彩色格式
logger->AddSink(
    std::make_unique<ConsoleSink>(),
    std::make_unique<ColorFormatter>());
```

::: tip
不指定 Formatter 时默认使用 `PlainFormatter`。`ConsoleSink` 构造时会自动检测终端（`isatty()`）。
:::

## 输出目标（Sink）

```cpp
#include "xtils/logging/sink.h"

struct Sink {
  virtual void write(std::string_view msg) = 0;
  virtual void flush() = 0;
};
```

### ConsoleSink

向 stdout 写入，构造时缓存 `isatty()` 结果：

```cpp
auto sink = std::make_unique<ConsoleSink>();
```

### FileSink（滚动文件）

```cpp
// 参数: 路径, 每个文件最大字节数, 最大文件数
auto sink = std::make_unique<FileSink>("logs/app.log", 10 * 1024 * 1024, 5);
// 创建: app.log, app.1.log, app.2.log, ... app.4.log
```

## LogEntry 结构

日志条目内部使用零拷贝优化：

```cpp
struct LogEntry {
  struct timespec timestamp;    // 原始时间戳（工作线程延迟格式化）
  log_level level;
  const char* tag;              // 来自 LOG_TAG_STRING（编译期字面量）
  const char* file_name;        // 来自 __FILE__（字面量，零拷贝）
  const char* function_name;    // 来自 __FUNCTION__（字面量，零拷贝）
  int line;
  std::string message;          // printf 格式化结果（唯一的堆分配）
};
```

## 看门狗

Watchdog 监控系统资源，当超出限制时可触发动作：

```cpp
#include "xtils/logging/watchdog.h"

auto* wd = Watchdog::GetInstance();
wd->Start();

// 内存超过 512MB 持续 5 秒则告警
wd->SetMemoryLimit(512 * 1024 * 1024, 5000);

// CPU 超过 90% 持续 10 秒则告警
wd->SetCpuLimit(90, 10000);
```

### Fatal 定时器

创建一个看门狗定时器，如果未取消则中止进程（死锁检测）：

```cpp
auto timer = wd->CreateFatalTimer(30000, WatchdogCrashReason::Timeout);
DoWork();
// 定时器在作用域退出时自动取消（RAII）
```

## 最佳实践

::: tip 性能
- 使用 `LogT` 记录高频调试消息 — Release 构建中会编译移除
- 宏在日志级别不匹配时短路，避免无用的字符串格式化
- `LogEntry` 中 tag/file/function 使用 `const char*` 指向字面量，零拷贝
- 时间戳存储原始 `timespec`，格式化在工作线程中延迟执行
:::

::: warning 线程安全
默认日志器是线程安全的。从多线程并发调用 `LogI` 等宏完全安全。
:::

## 完整示例

```cpp
#define LOG_TAG_STRING "app"
#include <xtils/logging/logger.h>
#include <xtils/logging/sink.h>
#include <xtils/logging/watchdog.h>

using namespace xtils::logger;

int main() {
  auto* logger = DefaultLogger();

  // 添加滚动文件 Sink（每文件 10MB，保留 3 个文件）
  logger->AddSink(std::make_unique<FileSink>("logs/app.log", 10*1024*1024, 3));

  #ifdef NDEBUG
    logger->SetLevel(log_level::info);
  #else
    logger->SetLevel(log_level::debug);
  #endif

  auto* wd = Watchdog::GetInstance();
  wd->Start();
  wd->SetMemoryLimit(256 * 1024 * 1024, 5000);

  LogI("应用启动 (PID=%d)", getpid());
  LogD("Debug 日志已启用");

  // 使用实例级宏
  XTILS_LOG_I(logger, "实例级日志: %s", "hello");

  for (int i = 0; i < 100; ++i) {
    LogT("正在处理项目 %d", i);
    ProcessItem(i);
  }

  LogI("应用正在关闭");
  logger->Flush();
  return 0;
}
```
