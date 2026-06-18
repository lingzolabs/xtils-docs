# 任务调度

Tasks 模块提供 xtils 的并发基础：事件循环、线程池、任务组、定时器（单调时钟和墙上时钟）、Cron 调度器和类型化事件分发。

## 概述

xtils 中的所有异步工作都通过 `TaskRunner` 抽象进行。无论是套接字变为可读、定时器触发，还是从另一个线程提交的任务 — 一切都由 `TaskRunner` 在其所属线程上处理。

## TaskRunner — 抽象接口

```cpp
#include "xtils/tasks/task_runner.h"

using Task = std::function<void()>;

class TaskRunner {
 public:
  using DelayedTaskHandle = uint64_t;
  static constexpr DelayedTaskHandle kInvalidDelayedTaskHandle = 0;

  // 基础任务提交
  virtual void PostTask(Task task) = 0;
  virtual void PostDelayedTask(Task task, uint32_t delay_ms) = 0;

  // 可取消的延迟任务。默认实现调用 PostDelayedTask 并返回
  // kInvalidDelayedTaskHandle（表示不支持取消）。
  virtual DelayedTaskHandle PostDelayedTaskWithHandle(Task task,
                                                       uint32_t delay_ms);
  virtual bool CancelDelayedTask(DelayedTaskHandle handle);

  // 此 runner 的单调时钟；默认 std::steady_clock，测试中
  // 可以 fake。
  virtual std::chrono::steady_clock::time_point Now() const;

  // 依 Now() 与 PostDelayedTask 实现。在给定的绝对时点运行任务。
  void PostTaskAt(std::chrono::steady_clock::time_point at, Task task);

  // I/O 与线程归属
  virtual void AddFileDescriptorWatch(PlatformHandle fd, Task callback) = 0;
  virtual void RemoveFileDescriptorWatch(PlatformHandle fd) = 0;
  virtual bool RunsTasksOnCurrentThread() const = 0;
};
```

### 延迟任务取消

```cpp
auto h = runner.PostDelayedTaskWithHandle([]() {
  LogI("这可能不会调。");
}, 5000);

// 条件变化，取消它
if (runner.CancelDelayedTask(h)) {
  LogI("任务被取消");
}
```

`CancelDelayedTask` 返回 `true` 仅当任务**尚未启动**才删除成功；如果已启动或 handle 未知，返回 `false`。

### 绝对时间调度

```cpp
auto deadline = runner.Now() + std::chrono::milliseconds(1500);
runner.PostTaskAt(deadline, []() {
  LogI("1500ms 后精确触发");
});
```

## UnixTaskRunner — epoll/poll 事件循环

基于 `epoll`（Linux）构建的主事件循环实现：

```cpp
#include "xtils/tasks/unix_task_runner.h"

UnixTaskRunner runner;

runner.AddFileDescriptorWatch(socket_fd, [&]() {
  char buf[1024];
  ssize_t n = read(socket_fd, buf, sizeof(buf));
});

runner.PostDelayedTask([]() {
  LogI("1 秒后触发");
}, 1000);

runner.Run();   // 阻塞，处理事件
runner.Quit();  // 停止循环
```

## ThreadTaskRunner — 专用线程

在自己的线程上包装 `UnixTaskRunner`。线程安全：可从任何线程 `PostTask`。

```cpp
#include "xtils/tasks/thread_task_runner.h"

auto runner = ThreadTaskRunner::CreateAndStart("io_thread");

// 从任何线程提交工作
runner.PostTask([]() {
  // 在专用 io_thread 上运行
});

runner.PostDelayedTask([]() {
  LogI("延迟任务");
}, 2000);
```

## TaskGroup — 并行/串行执行

```cpp
#include "xtils/tasks/task_group.h"

// 创建并行线程池
auto pool = TaskGroup::Parallel(4);

// 创建串行执行器
auto seq = TaskGroup::Sequential();

// 提交任务
pool->PostTask([]() { HeavyComputation(); });
pool->PostAsyncTask([]() { LogI("延迟工作"); }, 1000);

// 阻塞等待结果
auto result = pool->RunUntilCompleted([]() {
  return ComputeExpensiveResult();
});
```

## 定时器

### SteadyTimer（单调时钟）

最适合相对计时 — 不受系统时钟变化影响：

```cpp
#include "xtils/tasks/timer.h"

SteadyTimer timer(task_group.get());

// 一次性定时器
auto id = timer.SetRelativeTimer(5000, []() {
  LogI("5 秒后触发一次");
}, TimerType::OneShot);

// 重复定时器
auto id2 = timer.SetRepeatingTimer(1000, []() {
  LogI("每秒触发");
});

// 取消
timer.CancelTimer(id);
timer.CancelAllTimers();
```

### SystemTimer（墙上时钟 / UTC）

用于绝对时间调度（例如「在 2025-01-01 00:00:00 UTC 触发」）：

```cpp
SystemTimer timer(task_group.get());

uint64_t target_utc_ms = 1735689600000;
timer.SetAbsoluteUtcTimer(target_utc_ms, []() {
  LogI("新年快乐！");
});
```

::: tip
使用 `SteadyTimer`（别名 `MonotonicTimer`）处理间隔和超时。使用 `SystemTimer`（别名 `UtcTimer`）进行日历调度。
:::

## CronScheduler

使用 cron 表达式或简单间隔调度周期性任务：

```cpp
#include "xtils/tasks/cron_scheduler.h"

CronScheduler cron(480);  // UTC+8

// 简单间隔：每 30 秒
auto id1 = cron.every(Seconds(30), []() {
  LogI("每 30 秒");
});

// Cron 风格：每小时的第 0 分钟
// cron(秒, 分, 时, 日, 月, 星期几, 回调)
// 空集 = 通配符（匹配所有）
auto id2 = cron.cron(
  {0}, {0}, {}, {}, {}, {},
  []() { LogI("整点任务"); }
);

// 每个工作日早上 9:00
auto id3 = cron.cron(
  {0}, {0}, {9}, {}, {}, {1,2,3,4,5},
  []() { LogI("早安！"); }
);

cron.start();
cron.cancel(id1);
cron.stop();
```

## EventManager

跨线程的类型化发布/订阅事件分发：

```cpp
#include "xtils/tasks/event.h"

auto tg = TaskGroup::Parallel(2);
EventManager events(tg);

// 定义事件类型
struct DataReady { std::vector<int> data; };

// 订阅
events.Connect<DataReady>([](const DataReady& e) {
  LogI("收到 %zu 个项目", e.data.size());
});

// 发布（可从任何线程调用）
events.Emit(DataReady{{1, 2, 3, 4, 5}});
```

### 基于枚举的事件

```cpp
enum class Signal { Refresh, Pause, Resume };

events.Connect<Signal>(Signal::Refresh, [](const Signal&) {
  LogI("正在刷新...");
});

events.Emit(Signal::Refresh);
```

## 完整示例

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

  // 每 5 秒收集指标
  timer.SetRepeatingTimer(5000, [&]() {
    pool->PostTask([&]() {
      double cpu = MeasureCpu();
      double mem = MeasureMemory();
      events.Emit(MetricsCollected{cpu, mem});
    });
  });

  // 响应指标
  events.Connect<MetricsCollected>([](const MetricsCollected& m) {
    LogI("CPU: %.1f%%, 内存: %.1f%%", m.cpu, m.memory);
    if (m.cpu > 90.0) LogW("CPU 使用率过高！");
  });

  // Cron：每天凌晨 3 点清理
  CronScheduler cron(480);
  cron.cron({0}, {0}, {3}, {}, {}, {}, []() {
    LogI("执行每日清理...");
    CleanupOldLogs();
  });
  cron.start();

  pool->MainRunner()->Run();
  return 0;
}
```
