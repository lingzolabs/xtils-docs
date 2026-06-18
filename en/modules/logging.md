# Logging

The Logging module provides an async/sync logger with printf-style formatting, multiple log levels, console and rotating file sinks, per-module log tags, and a system watchdog for resource monitoring.

## Overview

xtils logging is designed for embedded and server applications where performance matters. It uses an async ring buffer by default (zero allocation on the hot path) and supports multiple sinks simultaneously.

```cpp
#define LOG_TAG_STRING "my_module"
#include <xtils/logging/logger.h>

LogI("Server started on port %d", 8080);
LogW("Connection pool running low: %d/%d", available, total);
LogE("Failed to connect: %s", error.c_str());
```

## Header

```cpp
#include "xtils/logging/logger.h"
```

## Log Macros (Primary Interface)

### Default Logger

```cpp
LogT(fmt, ...)   // Trace (compiled out unless ENABLE_TRACE_LOGGING defined)
LogD(fmt, ...)   // Debug
LogI(fmt, ...)   // Info
LogW(fmt, ...)   // Warning
LogE(fmt, ...)   // Error
```

### Custom Logger Instance

```cpp
auto* logger = xtils::logger::DefaultLogger();

XTILS_LOG_T(logger, fmt, ...)
XTILS_LOG_D(logger, fmt, ...)
XTILS_LOG_I(logger, fmt, ...)
XTILS_LOG_W(logger, fmt, ...)
XTILS_LOG_E(logger, fmt, ...)
```

### Opt-in short macros

If you prefer `TRACE` / `DEBUG` / `INFO` / `WARN` / `ERROR`, define before including:

```cpp
#define XTILS_LOG_SHORT_MACROS
#include <xtils/logging/logger.h>

INFO(logger, "info message");
DEBUG(logger, "debug message");
```

::: warning
Short macros may collide with other libraries (e.g. Windows `ERROR`). Disabled by default.
:::

### Assertions and Fatal

```cpp
XTILS_CHECK(expr)       // assert + abort if false
XTILS_DCHECK(expr)      // debug-only assert (still active in release if compiled)
XTILS_FATAL(fmt, ...)   // log error + abort
```

With `XTILS_LOG_SHORT_MACROS` defined the short forms `CHECK`/`DCHECK`/`FATAL` are also available.

## Log Levels

```
trace (0) → debug (1) → info (2) → warn (3) → error (4)
```

Messages below the configured level are dropped. In production, set level to `info` or `warn` for minimal overhead.

## Log Tag

Set a per-file log tag to identify which module produced a message:

```cpp
// At the top of your .cc file, BEFORE including logger.h
#define LOG_TAG_STRING "network"
#include "xtils/logging/logger.h"

// Output: [I][network] Connection established
LogI("Connection established");
```

If `LOG_TAG_STRING` is not defined, the tag defaults to the filename.

## Structured logging (LogBuilder)

In addition to printf-style macros, v2.0 ships a chained-field API ideal for adding rich context that downstream tooling can parse.

```cpp
#include "xtils/logging/log_builder.h"

LOGI().Field("req_id", id)
      .Field("status", code)
      .Msg("done");

LOGW().Field("path", path)
      .Field("latency_ms", latency)
      .Msg("slow request");

// printf-style body still works
LOGE().Field("errno", errno).Msg("open(%s) failed", path.c_str());
```

Example output (`PlainFormatter`):

```
2026-06-17 10:30:00 I default: done req_id=abc123 status=200
```

### Macros

| Macro | Level |
|-------|-------|
| `LOGI()` | info |
| `LOGW()` | warn |
| `LOGE()` | error |
| `LOGD()` | debug |
| `LOGT()` | trace (a no-op when `ENABLE_TRACE_LOGGING` is not defined) |

### Terminal methods

- `Msg(const std::string& body)` / `Msg()` — dispatch one log entry
- `Msg(const char* fmt, ...)` — printf-style body
- `RenderForTesting()` — returns the rendered fields without dispatching (tests only)

If `Msg(...)` is never called, the destructor flushes with an empty body so a forgotten `.Msg()` does not silently swallow the entry.

## MDC (Mapped Diagnostic Context)

MDC is thread-local key/value context that automatically attaches to any `LogBuilder` call on the same thread.

```cpp
#include "xtils/logging/mdc.h"
using xtils::logger::Mdc;

void HandleRequest(const Request& r) {
  Mdc::Put("req_id", r.id);
  Mdc::Put("user",   r.user);

  LOGI().Msg("request received");   // appends req_id=... user=...
  DoWork();
  LOGI().Msg("request done");

  Mdc::Clear();
}
```

### RAII Scope

The usual pattern is `Mdc::Scope`, which restores the previous value (or removes the key) on destruction:

```cpp
void HandleRequest(const Request& r) {
  Mdc::Scope s1("req_id", r.id);
  Mdc::Scope s2("user",   r.user);

  LOGI().Msg("request received");
  DoWork();
  LOGI().Msg("request done");
  // req_id / user reset here.
}
```

### API

```cpp
class Mdc {
 public:
  static void Put  (std::string key, std::string value);
  static void Erase(const std::string& key);
  static const std::string& Get(const std::string& key);  // empty string if absent
  static void Clear();
  static std::vector<std::pair<std::string,std::string>> Snapshot();

  class Scope { Scope(std::string key, std::string value); };
};
```

::: tip
MDC is thread-local. When jumping tasks across `ThreadTaskRunner` boundaries you must propagate context manually if you want it to ride along.
:::

## Logger API

```cpp
namespace xtils::logger {

// Get the global default logger
Logger* DefaultLogger();

// Logger class
class Logger {
 public:
  void SetLevel(log_level level);
  log_level Level() const;
  
  void AddSink(std::unique_ptr<Sink> sink);
  void Flush();
  void Shutdown();
  
  size_t GetDroppedCount() const;  // Messages dropped due to full buffer
};

// Convenience
void SetLevel(Logger* logger, log_level level);

}  // namespace xtils::logger
```

## Log Levels Enum

```cpp
enum class log_level {
  trace = 0,
  debug = 1,
  info = 2,
  warn = 3,
  error = 4,
};
```

## Sinks

Sinks control where log output goes. Multiple sinks can be active simultaneously.

```cpp
#include "xtils/logging/sink.h"

// Base interface
struct Sink {
  virtual void write(const char* buf, size_t start, size_t len) = 0;
  virtual void flush() = 0;
};
```

### ConsoleSink

Writes colored output to stdout:

```cpp
auto* logger = xtils::logger::DefaultLogger();
// ConsoleSink is added by default
```

### FileSink (Rotating)

Writes to rotating log files with configurable size and count:

```cpp
#include "xtils/logging/sink.h"

// Parameters: path, max_bytes_per_file, max_file_count
auto sink = std::make_unique<FileSink>("logs/app.log", 10 * 1024 * 1024, 5);
// Creates: app.log, app.1.log, app.2.log, ... app.4.log

logger->AddSink(std::move(sink));
```

## Watchdog

The Watchdog monitors system resources and can trigger actions when limits are exceeded:

```cpp
#include "xtils/logging/watchdog.h"

auto* wd = Watchdog::GetInstance();
wd->Start();

// Alert if memory exceeds 512MB for 5 seconds
wd->SetMemoryLimit(512 * 1024 * 1024, 5000);

// Alert if CPU exceeds 90% for 10 seconds
wd->SetCpuLimit(90, 10000);
```

### Fatal Timers

Create a watchdog timer that aborts the process if not cancelled (deadlock detection):

```cpp
// Create a 30-second fatal timer
auto timer = wd->CreateFatalTimer(30000, WatchdogCrashReason::Timeout);

// Do work that should complete within 30 seconds...
DoWork();

// Timer is automatically cancelled when it goes out of scope (RAII)
```

### Guard Helper

```cpp
// Run a task with automatic watchdog guard
RunTaskWithWatchdogGuard([]() {
  // If this takes too long, watchdog triggers
  ProcessData();
});
```

## Configuration

### Compile-Time Options

| Define | Effect |
|--------|--------|
| `ENABLE_TRACE_LOGGING` | Enable `LogT()` / trace level (off by default for performance) |
| `LOG_TAG_STRING` | Set per-file module tag |

### Runtime Configuration

```cpp
// Set level at runtime
auto* logger = xtils::logger::DefaultLogger();
logger->SetLevel(log_level::debug);

// Disable file logging (enabled by default in app framework)
// Configure via config.json: {"logging": {"file": false}}
```

## Best Practices

::: tip Performance
- Use `LogT` for high-frequency debug messages — they compile away in release builds
- Avoid string formatting in hot paths when log level would filter it out; the macros short-circuit
- File sinks use async writes — they don't block your thread
:::

::: warning Thread Safety
The default logger is thread-safe. Custom loggers created separately are also thread-safe. Sink implementations should be thread-safe as they may receive writes from multiple threads.
:::

## Complete Example

```cpp
#define LOG_TAG_STRING "app"
#include <xtils/logging/logger.h>
#include <xtils/logging/sink.h>
#include <xtils/logging/watchdog.h>

using namespace xtils::logger;

int main() {
  auto* logger = DefaultLogger();
  
  // Add rotating file sink (10MB per file, keep 3 files)
  logger->AddSink(std::make_unique<FileSink>("logs/app.log", 10*1024*1024, 3));
  
  // Set level based on environment
  #ifdef NDEBUG
    logger->SetLevel(log_level::info);
  #else
    logger->SetLevel(log_level::debug);
  #endif

  // Start watchdog
  auto* wd = Watchdog::GetInstance();
  wd->Start();
  wd->SetMemoryLimit(256 * 1024 * 1024, 5000);

  LogI("Application starting (PID=%d)", getpid());
  LogD("Debug logging enabled");

  // Application logic...
  for (int i = 0; i < 100; ++i) {
    LogT("Processing item %d", i);  // Only if ENABLE_TRACE_LOGGING
    ProcessItem(i);
  }

  LogI("Application shutting down");
  logger->Flush();
  return 0;
}
```
