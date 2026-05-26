# 有限状态机（FSM）

FSM 模块提供有限状态机，支持命名状态、事件驱动的转换、守卫条件、动作、历史记录追踪、线程安全和 Graphviz DOT 导出。适用于应用状态建模、设备控制流和游戏逻辑。

## 概述

有限状态机由通过**转换**连接的**状态**组成。转换由**事件**触发，并可由守卫条件进行保护。FSM 追踪转换历史，并可将其图导出为可视化格式。

```cpp
#include <xtils/fsm/fsm.h>

using namespace xtils::fsm;

enum Event : EventType {
  START = 1,
  PAUSE = 2,
  STOP = 3,
};

FSM fsm;

// 注册可读的事件名称
fsm.RegisterEvent(START, "start");
fsm.RegisterEvent(PAUSE, "pause");
fsm.RegisterEvent(STOP, "stop");

// 定义状态
fsm.AddState("Idle", [](const State&, EventType) { LogI("→ Idle"); });
fsm.AddState("Running", [](const State&, EventType) { LogI("→ Running"); });
fsm.AddState("Paused", [](const State&, EventType) { LogI("→ Paused"); });

// 定义转换
fsm.AddTransition("Idle", "Running", START);
fsm.AddTransition("Running", "Paused", PAUSE);
fsm.AddTransition("Paused", "Running", START);
fsm.AddTransition("Running", "Idle", STOP);
fsm.AddTransition("Paused", "Idle", STOP);

// 运行
fsm.Start("Idle");
fsm.ProcessEvent(START);  // Idle → Running
fsm.ProcessEvent(PAUSE);  // Running → Paused
```

## 头文件

```cpp
#include "xtils/fsm/fsm.h"
```

## 状态管理

```cpp
StateId AddState(std::unique_ptr<State> state);
StateId AddState(const std::string& name);
StateId AddState(const std::string& name, StateCallback on_enter);
StateId AddState(const std::string& name, StateCallback on_enter, StateCallback on_exit);
```

## 转换

```cpp
void AddTransition(const std::string& from, const std::string& to,
                   EventType event, TransitionConditionPtr condition = nullptr);
void AddTransition(const std::string& from, const std::string& to,
                   std::vector<EventType> events, TransitionConditionPtr condition = nullptr);
```

## 控制

```cpp
void Start(const std::string& initial_state);
void Reset(const std::string& state_name);
void ProcessEvent(EventType event);
```

## 转换条件（守卫与动作）

守卫返回 `false` 时阻止转换。动作在转换触发时执行：

```cpp
// 创建守卫
auto guard = MakeGuard("name", [](const State& from, const State& to, EventType evt) {
  return /* 条件 */;
});

// 创建动作
auto action = MakeAction("name", [](const State& from, const State& to, EventType evt) {
  // 转换时的副作用
});

// 组合
auto cond = MakeCondition("name", guard_fn, action_fn);
```

### 示例：带守卫的转换

```cpp
// 仅在电量 > 20% 时允许启动
fsm.AddTransition("Idle", "Running", START,
    MakeGuard("battery_check", [&](const State&, const State&, EventType) {
      return battery_level > 20;
    }));
```

## 事件注册

注册事件的可读名称，这些名称会出现在历史记录和 DOT 图输出中：

```cpp
void RegisterEvent(EventType event, const std::string& name);
std::string GetEventName(EventType event) const;
```

## 历史记录

FSM 将所有转换尝试记录在双端队列中：

```cpp
std::deque<HistoryEntry> GetHistory() const;  // 返回副本（线程安全）
void ClearHistory();
void SetMaxHistorySize(size_t max_size);
void SetRecordFailedEvents(bool record);      // 记录未触发转换的事件
std::string DumpHistory() const;              // 格式化多行输出
```

### `HistoryEntry`

```cpp
struct HistoryEntry {
  std::int64_t timestamp;      // 墙上时钟（自 Unix 纪元以来的毫秒数）
  StateId from_state;
  StateId to_state;
  EventType event;
  bool transition_occurred;    // 如果守卫阻止则为 false
  std::string from_name;       // 可读的源状态名
  std::string to_name;         // 可读的目标状态名
  std::string event_name;      // 可读的事件名
  std::string description;
  std::string toString() const;
};
```

## 线程安全

默认情况下 FSM 不是线程安全的。当多个线程调用 `ProcessEvent` 时启用线程安全：

```cpp
fsm.EnableThreadSafety(true);  // 内部使用 recursive_mutex
```

::: warning
`GetHistory()` 返回**值**（副本）以避免竞争。不要缓存对内部历史记录的引用。
:::

## Graphviz DOT 导出

导出 FSM 图以使用 Graphviz 或在线工具可视化：

```cpp
std::string dot = fsm.ToDotGraph();
// 渲染: dot -Tpng fsm.dot -o fsm.png
```

## 完整示例

```cpp
#include <xtils/fsm/fsm.h>
#include <xtils/logging/logger.h>

using namespace xtils::fsm;

enum LightEvent : EventType {
  TURN_ON = 1,
  TURN_OFF = 2,
  DIM = 3,
  BRIGHTEN = 4,
};

FSM light;

light.RegisterEvent(TURN_ON, "turn_on");
light.RegisterEvent(TURN_OFF, "turn_off");
light.RegisterEvent(DIM, "dim");
light.RegisterEvent(BRIGHTEN, "brighten");

light.AddState("Off",
  [](const State&, EventType) { LogI("灯 关闭"); },
  [](const State&, EventType) { LogI("离开 关闭 状态"); });
light.AddState("On",
  [](const State&, EventType) { LogI("灯 开启（全亮）"); });
light.AddState("Dimmed",
  [](const State&, EventType) { LogI("灯 调暗"); });

light.AddTransition("Off", "On", TURN_ON);
light.AddTransition("On", "Off", TURN_OFF);
light.AddTransition("Dimmed", "Off", TURN_OFF);
light.AddTransition("On", "Dimmed", DIM);
light.AddTransition("Dimmed", "On", BRIGHTEN);

light.SetMaxHistorySize(50);
light.EnableThreadSafety(true);

light.Start("Off");
light.ProcessEvent(TURN_ON);   // Off → On
light.ProcessEvent(DIM);       // On → Dimmed
light.ProcessEvent(BRIGHTEN);  // Dimmed → On
light.ProcessEvent(TURN_OFF);  // On → Off

LogI("当前状态: %s", light.GetCurrentStateName()->c_str());
LogI("DOT 图:\n%s", light.ToDotGraph().c_str());
LogI("历史记录:\n%s", light.DumpHistory().c_str());
```
