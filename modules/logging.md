# 日志系统

Logging 模块提供异步/同步日志器，支持 printf 风格格式化、多级别日志、控制台和滚动文件输出、每模块日志标签，以及系统资源看门狗。

## 概述

xtils 的日志系统专为嵌入式和服务器应用设计，性能至关重要。默认使用异步环形缓冲区（热路径零内存分配），并支持同时使用多个输出目标。

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

## 日志宏（主要接口）

### 默认日志器

```cpp
LogT(fmt, ...)   // Trace（仅在定义 ENABLE_TRACE_LOGGING 时编译）
LogD(fmt, ...)   // Debug
LogI(fmt, ...)   // Info
LogW(fmt, ...)   // Warning
LogE(fmt, ...)   // Error
```

### 自定义日志器实例

```cpp
TRACE(logger, fmt, ...)
DEBUG(logger, fmt, ...)
INFO(logger, fmt, ...)
WARN(logger, fmt, ...)
ERROR(logger, fmt, ...)
```

### 断言

```cpp
CHECK(expr)       // 断言 + 中止并输出消息
DCHECK(expr)      // 仅 Debug 模式断言（Release 中编译移除）
FATAL(fmt, ...)   // 记录错误 + 中止
```

## 日志级别

```
trace (0) → debug (1) → info (2) → warn (3) → error (4)
```

低于配置级别的消息会被丢弃。生产环境建议设置为 `info` 或 `warn` 以获得最小开销。

## 日志标签

设置每文件的日志标签来标识消息来源模块：

```cpp
// 在 .cc 文件顶部，在 include logger.h 之前
#define LOG_TAG_STRING "network"
#include "xtils/logging/logger.h"

// 输出: [I][network] 连接已建立
LogI("连接已建立");
```

## Logger API

```cpp
namespace xtils::logger {

Logger* DefaultLogger();

class Logger {
 public:
  void SetLevel(log_level level);
  log_level Level() const;
  void AddSink(std::unique_ptr<Sink> sink);
  void Flush();
  void Shutdown();
  size_t GetDroppedCount() const;  // 因缓冲区满而丢弃的消息数
};

}
```

## 输出目标（Sink）

Sink 控制日志输出的去向，可同时激活多个 Sink。

```cpp
#include "xtils/logging/sink.h"

struct Sink {
  virtual void write(const char* buf, size_t start, size_t len) = 0;
  virtual void flush() = 0;
};
```

### ConsoleSink

向 stdout 写入彩色输出（默认已添加）。

### FileSink（滚动文件）

```cpp
// 参数: 路径, 每个文件最大字节数, 最大文件数
auto sink = std::make_unique<FileSink>("logs/app.log", 10 * 1024 * 1024, 5);
// 创建: app.log, app.1.log, app.2.log, ... app.4.log

logger->AddSink(std::move(sink));
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
- 宏在日志级别会过滤消息时会短路，避免无用的字符串格式化
- 文件 Sink 使用异步写入 — 不会阻塞你的线程
:::

::: warning 线程安全
默认日志器是线程安全的。Sink 实现也应该是线程安全的，因为它们可能从多个线程接收写入。
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

  for (int i = 0; i < 100; ++i) {
    LogT("正在处理项目 %d", i);
    ProcessItem(i);
  }

  LogI("应用正在关闭");
  logger->Flush();
  return 0;
}
```
