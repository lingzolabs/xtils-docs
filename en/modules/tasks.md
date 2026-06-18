# Tasks & Scheduling

The Tasks module provides the concurrency foundation for xtils: event loops, thread pools, task groups, timers (monotonic and wall-clock), a cron scheduler, and typed event dispatch.

## Overview

All async work in xtils flows through the `TaskRunner` abstraction. Whether it's a socket becoming readable, a timer firing, or a task being posted from another thread — everything is processed by a `TaskRunner` on its owning thread.

```
┌─────────────────────────────────────────────┐
│  Your Application                           │
│                                             │
│  ┌────────────┐  ┌────────────────────────┐ │
│  │ TaskGroup  │  │  ThreadTaskRunner       │ │
│  │ (workers)  │  │  (dedicated I/O thread) │ │
│  └────────────┘  └────────────────────────┘ │
│        │                    │               │
│        └────── TaskRunner ──┘               │
└─────────────────────────────────────────────┘
```

## TaskRunner — Abstract Interface

```cpp
#include "xtils/tasks/task_runner.h"

using Task = std::function<void()>;

class TaskRunner {
 public:
  using DelayedTaskHandle = uint64_t;
  static constexpr DelayedTaskHandle kInvalidDelayedTaskHandle = 0;

  // Core posting
  virtual void PostTask(Task task) = 0;
  virtual void PostDelayedTask(Task task, uint32_t delay_ms) = 0;

  // Cancellable delayed task. Default impl just delegates to
  // PostDelayedTask and returns kInvalidDelayedTaskHandle (cancellation
  // unsupported on that runner).
  virtual DelayedTaskHandle PostDelayedTaskWithHandle(Task task,
                                                       uint32_t delay_ms);
  virtual bool CancelDelayedTask(DelayedTaskHandle handle);

  // Steady-clock "now" for this runner. Default uses std::steady_clock;
  // tests can override with a fake clock.
  virtual std::chrono::steady_clock::time_point Now() const;

  // Schedule task at an absolute steady-clock time. Implemented in terms
  // of Now() + PostDelayedTask.
  void PostTaskAt(std::chrono::steady_clock::time_point at, Task task);

  // I/O and threading
  virtual void AddFileDescriptorWatch(PlatformHandle fd, Task callback) = 0;
  virtual void RemoveFileDescriptorWatch(PlatformHandle fd) = 0;
  virtual bool RunsTasksOnCurrentThread() const = 0;
};
```

This is the core abstraction — all networking, timers, and I/O watches ultimately use a TaskRunner.

### Cancelling a delayed task

```cpp
auto h = runner.PostDelayedTaskWithHandle([]() {
  LogI("may not run");
}, 5000);

if (runner.CancelDelayedTask(h)) {
  LogI("task cancelled before it ran");
}
```

`CancelDelayedTask` returns `true` only if the task was removed before starting; `false` if it already ran, already started running, or the handle is unknown.

### Absolute scheduling

```cpp
auto deadline = runner.Now() + std::chrono::milliseconds(1500);
runner.PostTaskAt(deadline, []() {
  LogI("fires exactly 1500ms from now");
});
```

## UnixTaskRunner — epoll/poll Event Loop

The primary event loop implementation, built on `epoll` (Linux) with `poll` fallback:

```cpp
#include "xtils/tasks/unix_task_runner.h"

UnixTaskRunner runner;

// Add I/O watch
runner.AddFileDescriptorWatch(socket_fd, [&]() {
  // Socket is readable
  char buf[1024];
  ssize_t n = read(socket_fd, buf, sizeof(buf));
});

// Post a delayed task
runner.PostDelayedTask([]() {
  LogI("Fired after 1 second");
}, 1000);

// Block and process events (call this from your main thread)
runner.Run();

// Stop from another thread or callback
runner.Quit();
```

## ThreadTaskRunner — Dedicated Thread

Wraps a `UnixTaskRunner` running on its own thread. Thread-safe: you can `PostTask` from any thread.

```cpp
#include "xtils/tasks/thread_task_runner.h"

// Create and start (value type, moveable)
auto runner = ThreadTaskRunner::CreateAndStart("io_thread");

// Or as shared_ptr
auto runner = ThreadTaskRunner::CreateAndStartShared("io_thread");

// Post work from any thread
runner.PostTask([]() {
  // Runs on the dedicated io_thread
});

runner.PostDelayedTask([]() {
  LogI("Delayed task on io_thread");
}, 2000);

// Access the underlying UnixTaskRunner
UnixTaskRunner* raw = runner.get();
```

## TaskGroup — Parallel/Sequential Execution

Task groups manage pools of workers:

```cpp
#include "xtils/tasks/task_group.h"

// Create a parallel pool (default: hardware_concurrency threads)
auto pool = TaskGroup::Parallel(4);

// Create a sequential executor (single worker thread)
auto seq = TaskGroup::Sequential();
```

### Posting Tasks

```cpp
// Post and forget
pool->PostTask([]() {
  // Runs on any available worker
  HeavyComputation();
});

// Post with delay
pool->PostAsyncTask([]() {
  LogI("Delayed worker task");
}, 1000);
```

### RunUntilCompleted — Blocking Future

```cpp
// Block calling thread until task completes, return result
auto result = pool->RunUntilCompleted([]() {
  return ComputeExpensiveResult();
});
LogI("Result: %d", result);
```

### Lifecycle

```cpp
bool pool->IsBusy();           // Any tasks pending/running?
int pool->Size();              // Number of worker threads
void pool->Stop();             // Signal stop
bool pool->StopWaitAll(5s);   // Stop and wait (with timeout)
auto runner = pool->MainRunner();  // Get main thread task runner
```

## Timers

### SteadyTimer (Monotonic Clock)

Best for relative timing — not affected by system clock changes:

```cpp
#include "xtils/tasks/timer.h"

SteadyTimer timer(task_group.get());

// One-shot timer
auto id = timer.SetRelativeTimer(5000, []() {
  LogI("Fires once after 5 seconds");
}, TimerType::OneShot);

// Repeating timer
auto id2 = timer.SetRepeatingTimer(1000, []() {
  LogI("Fires every second");
});

// Absolute timer (fire at a specific steady_clock point)
auto deadline = SteadyTimer::GetCurrentTimestampMs() + 10000;
timer.SetAbsoluteTimer(deadline, []() { /* ... */ });

// Cancel
timer.CancelTimer(id);
timer.CancelAllTimers();

// Get current monotonic time
uint64_t now = SteadyTimer::GetCurrentTimestampMs();
```

### SystemTimer (Wall Clock / UTC)

For absolute time scheduling (e.g., "fire at 2025-01-01 00:00:00 UTC"):

```cpp
SystemTimer timer(task_group.get());

// Fire at a specific UTC timestamp
uint64_t target_utc_ms = 1735689600000;  // Some future time
timer.SetAbsoluteUtcTimer(target_utc_ms, []() {
  LogI("Happy New Year!");
});

uint64_t now_utc = SystemTimer::GetCurrentUtcTimestampMs();
```

::: tip
Use `SteadyTimer` (aliased as `MonotonicTimer`) for intervals and timeouts. Use `SystemTimer` (aliased as `UtcTimer`) for calendar-based scheduling.
:::

## CronScheduler

Schedule recurring tasks with cron-style expressions or simple intervals:

```cpp
#include "xtils/tasks/cron_scheduler.h"

CronScheduler cron(/* tzOffsetMinutes */ 480);  // UTC+8

// Simple interval: every 30 seconds
auto id1 = cron.every(Seconds(30), []() {
  LogI("Every 30 seconds");
});

// Cron-style: at minute 0 of every hour
// cron(seconds, minutes, hours, days, months, weekdays, callback)
// Empty set = wildcard (match all)
auto id2 = cron.cron(
  {0},   // second 0
  {0},   // minute 0
  {},    // every hour
  {},    // every day
  {},    // every month
  {},    // every weekday
  []() { LogI("Hourly task"); }
);

// Every weekday at 9:00 AM
auto id3 = cron.cron(
  {0}, {0}, {9},  // 09:00:00
  {},             // any day of month
  {},             // any month
  {1,2,3,4,5},   // Mon-Fri
  []() { LogI("Good morning!"); }
);

cron.start();

// Later...
cron.cancel(id1);
auto info = cron.getTaskInfo(id2);  // Returns std::optional<TaskInfo>

cron.stop();
```

## EventManager

Typed pub/sub event dispatch across threads:

```cpp
#include "xtils/tasks/event.h"

auto tg = TaskGroup::Parallel(2);
EventManager events(tg);

// Define event types
struct DataReady { std::vector<int> data; };
struct ShutdownRequest {};

// Subscribe (callbacks fire on task group thread)
events.Connect<DataReady>([](const DataReady& e) {
  LogI("Got %zu items", e.data.size());
});

events.Connect<ShutdownRequest>([](const ShutdownRequest&) {
  LogI("Shutdown requested");
});

// Publish (can be called from any thread)
events.Emit(DataReady{{1, 2, 3, 4, 5}});
events.Emit(ShutdownRequest{});
```

### Enum-Based Events

For lightweight signaling without payloads:

```cpp
enum class Signal { Refresh, Pause, Resume };

events.Connect<Signal>(Signal::Refresh, [](const Signal&) {
  LogI("Refreshing...");
});

events.Emit(Signal::Refresh);
```

## Patterns

### Producer-Consumer

```cpp
auto pool = TaskGroup::Parallel(4);
SteadyTimer timer(pool.get());

// Producer: generate work items periodically
timer.SetRepeatingTimer(100, [&]() {
  auto item = FetchNextItem();
  pool->PostTask([item]() {
    ProcessItem(item);
  });
});
```

### Periodic Polling with Backoff

```cpp
auto runner = ThreadTaskRunner::CreateAndStart("poller");

std::function<void()> poll = [&]() {
  auto result = TryFetch();
  uint32_t next_delay = result.has_value() ? 1000 : 5000;  // Backoff on failure
  runner.PostDelayedTask(poll, next_delay);
};

runner.PostTask(poll);
```

## Complete Example

```cpp
#include <xtils/tasks/task_group.h>
#include <xtils/tasks/timer.h>
#include <xtils/tasks/cron_scheduler.h>
#include <xtils/tasks/event.h>
#include <xtils/logging/logger.h>

using namespace xtils;

struct MetricsCollected { double cpu; double memory; };

int main() {
  auto pool = TaskGroup::Parallel(4);
  SteadyTimer timer(pool.get());
  EventManager events(pool);

  // Collect metrics every 5 seconds
  timer.SetRepeatingTimer(5000, [&]() {
    pool->PostTask([&]() {
      double cpu = MeasureCpu();
      double mem = MeasureMemory();
      events.Emit(MetricsCollected{cpu, mem});
    });
  });

  // React to metrics
  events.Connect<MetricsCollected>([](const MetricsCollected& m) {
    LogI("CPU: %.1f%%, Memory: %.1f%%", m.cpu, m.memory);
    if (m.cpu > 90.0) LogW("High CPU usage!");
  });

  // Cron: daily cleanup at 3 AM
  CronScheduler cron(480);  // UTC+8
  cron.cron({0}, {0}, {3}, {}, {}, {}, []() {
    LogI("Running daily cleanup...");
    CleanupOldLogs();
  });
  cron.start();

  // Block main thread
  pool->MainRunner()->Run();
  return 0;
}
```
