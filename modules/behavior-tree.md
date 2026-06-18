# 行为树

行为树（BT）模块提供 JSON 驱动的行为树系统，支持黑板数据共享、输入/输出端口、子树、事件系统和结构化日志。适用于机器人、游戏 AI 和工作流自动化等复杂决策逻辑。

## 概述

行为树是一种模块化的替代状态机方案，用于编码复杂逻辑。它通过组合器（序列、选择器、装饰器）将简单的构建块（动作、条件）组合成层次树。

相比 FSM 的优势：
- **可组合性** — 节点可复用和组合
- **可读性** — 树结构直接映射决策逻辑
- **可扩展性** — 通过添加子树扩展行为，无需重新布线

## 头文件

```cpp
#include "xtils/fsm/behavior_tree.h"
```

## 核心概念

### 节点类型

| 类型 | 角色 | 示例 |
|------|------|------|
| **Composite** | 控制子节点执行顺序 | Sequence, Selector |
| **Action** | 执行工作，返回状态 | MoveToTarget, SendMessage |
| **Decorator** | 修改子节点行为 | Inverter, Delay, Retry |

### 状态

每次 tick 返回以下状态之一：

```cpp
enum class Status {
  Success,   // 节点成功完成
  Failure,   // 节点失败
  Running,   // 节点需要更多 tick 才能完成
  Idle       // 节点尚未启动
};
```

### Tick 生命周期

```cpp
class Node {
  Status tick();                                // 由父节点每帧调用
  virtual Status OnStart() { return Running; }  // 首次 tick 初始化
  virtual Status OnTick() = 0;                  // 主逻辑（每次 tick 调用）
  virtual void OnStop() {}                      // Success/Failure 后的清理
};
```

## 内置节点

| 节点 | 类型 | 描述 |
|------|------|------|
| `Sequence` | Composite | 从左到右运行子节点；遇到第一个失败即失败 |
| `Selector` | Composite | 从左到右运行子节点；遇到第一个成功即成功 |
| `Inverter` | Decorator | 反转子节点结果（Success↔Failure） |
| `Delay` | Decorator | 延迟子节点执行（`delay_ms` 端口） |
| `Retry` | Decorator | 失败时重试子节点（最多 `max_attempts` 次） |
| `SubTree` | Decorator | 执行已注册的子树（`tree_name` 端口） |
| `SimpleAction` | Action | 包装 `std::function<Status()>` |
| `WaitForEvent` | Action | 阻塞直到事件触发 |
| `EventGuard` | Decorator | 事件触发时中断子节点 |

## BtFactory — 构建树

```cpp
BtFactory factory;

// 注册自定义节点类型
factory.Register<MoveToTarget>("MoveToTarget");
factory.Register<CheckBattery>("CheckBattery");

// 注册简单内联动作
factory.RegisterSimpleAction([]() {
  LogI("来自 BT 的问候！");
  return Status::Success;
}, "SayHello");

// 从 JSON 文件加载
factory.LoadTreeFile("trees/patrol.json");
size_t count = factory.LoadTreesFromDirectory("./bt_trees");

// 构建并运行
auto blackboard = std::make_shared<AnyMap>();
blackboard->set("target_x", 10);
auto tree = factory.buildFromRegisteredTree("patrol", blackboard);

while (tree->tick() == Status::Running) {
  std::this_thread::sleep_for(std::chrono::milliseconds(100));
}
```

## JSON 树格式

```json
{
  "name": "patrol",
  "root": {
    "type": "Sequence",
    "children": [
      {
        "type": "CheckBattery",
        "ports": { "min_level": "20" }
      },
      {
        "type": "MoveToTarget",
        "ports": { "target_x": "{waypoint_x}", "target_y": "{waypoint_y}" }
      }
    ]
  }
}
```

`{大括号}` 中的端口值引用黑板键。字面值直接传递。

## 端口与黑板

### 声明端口

```cpp
class MoveToTarget : public ActionNode {
 public:
  MoveToTarget(const std::string& name = "") : ActionNode(name) {}

  static Ports getPorts() {
    return {
      InputPort<int>("target_x"),
      InputPort<int>("target_y"),
      OutputPort<bool>("reached")
    };
  }

  Status OnTick() override {
    auto x = getInput<int>("target_x");
    auto y = getInput<int>("target_y");
    if (!x || !y) return Status::Failure;
    
    // 移动逻辑...
    if (at_target) {
      setOutput("reached", true);
      return Status::Success;
    }
    return Status::Running;
  }
};
```

### 黑板（AnyMap）

黑板在树中的所有节点间共享：

```cpp
AnyMap blackboard;

blackboard.set<int>("counter", 0);
blackboard.set<std::string>("target", "waypoint_a");

auto counter = blackboard.get<int>("counter");      // → std::optional<int>
bool exists = blackboard.has("counter");
auto keys = blackboard.keys();  // → vector<string>
```

## BtTree 接口

```cpp
class BtTree {
 public:
  Status tick();
  void   reset();
  void   shutdown();
  AnyMap& blackboard();
  std::string dump();
  Json        dumpTree();

  // 暂停/恢复
  void pause();
  void resume();
  bool isPaused() const;

  // 事件系统
  void sendEvent(EventType type, const AnyData& data = {});
  std::optional<BtEvent> peekEvent   (EventType type) const;  // 不消费
  std::optional<BtEvent> consumeEvent(EventType type);        // 消费
  bool hasEvent  (EventType type) const;
  void clearEvents();
};
```

## 子树

子树允许从较小的可复用树组合复杂行为，有两种使用方式：

### 1. 引用已注册的树

```json
{
  "name": "main",
  "root": {
    "type": "Sequence",
    "children": [
      { "type": "SubTree", "ports": { "tree_name": "navigate" } },
      { "type": "SubTree", "ports": { "tree_name": "interact" } }
    ]
  }
}
```

需要事先通过 `factory.LoadTreeFile(...)` 或 `factory.LoadTreesFromDirectory(...)` 注册名为 `navigate` / `interact` 的子树。

### 2. 内联子树

直接在 `SubTree` 结点内嵌一棵树（未采用 `tree_name` 端口）：

```json
{
  "type": "SubTree",
  "tree": {
    "name": "recovery",
    "root": { "type": "Inverter", "child": { "type": "CheckBattery" } }
  }
}
```

所有 `SubTree` 节点会共享父树的黑板与 logger，实现树间数据流。

## BtLogger

结构化日志，用于离线分析和实时调试。头文件拆分为三个：

```cpp
#include "xtils/fsm/bt_filelogger.h"      // BtFileLogger
#include "xtils/fsm/bt_inspectlogger.h"   // BtInspectLogger
#include "xtils/fsm/bt_compositelogger.h" // BtCompositeLogger
```

```cpp
auto file    = std::make_shared<BtFileLogger>("bt_trace.log");
auto inspect = std::make_shared<BtInspectLogger>("/debug/bt");

auto logger = std::make_shared<BtCompositeLogger>();
logger->Add(file);
logger->Add(inspect);

auto tree = factory.buildFromRegisteredTree("main", blackboard, logger);
```

## 完整示例

```cpp
#include <xtils/fsm/behavior_tree.h>
#include <xtils/logging/logger.h>

using namespace xtils;

class PrintMessage : public ActionNode {
 public:
  PrintMessage(const std::string& name = "") : ActionNode(name) {}
  static Ports getPorts() { return { InputPort<std::string>("text") }; }
  
  Status OnTick() override {
    auto text = getInput<std::string>("text");
    if (!text) return Status::Failure;
    LogI("BT 输出: %s", text->c_str());
    return Status::Success;
  }
};

class CountDown : public ActionNode {
 public:
  CountDown(const std::string& name = "") : ActionNode(name) {}
  static Ports getPorts() { return { InputPort<int>("from") }; }

  Status OnStart() override {
    count_ = getInput<int>("from").value_or(3);
    return Status::Running;
  }

  Status OnTick() override {
    LogI("  %d...", count_);
    if (--count_ <= 0) return Status::Success;
    return Status::Running;
  }

 private:
  int count_ = 0;
};

int main() {
  BtFactory factory;
  factory.Register<PrintMessage>("PrintMessage");
  factory.Register<CountDown>("CountDown");

  Json tree_json = Json::parse(R"({
    "name": "demo",
    "root": {
      "type": "Sequence",
      "children": [
        { "type": "PrintMessage", "ports": { "text": "开始倒计时！" } },
        { "type": "CountDown", "ports": { "from": "5" } },
        { "type": "PrintMessage", "ports": { "text": "完成！" } }
      ]
    }
  })").value();

  auto tree = factory.buildFromJson(tree_json);
  
  while (tree->tick() == Status::Running) {
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
  }
  
  return 0;
}
```

## 可视化工具

关于行为树的可视化设计和调试，请参阅 [BT 编辑器与调试器](/examples/bt-editor) — 配套的浏览器端工具，支持：

- 拖拽式树设计并导出 JSON
- JSONL 日志回放用于离线执行分析
- 实时 WebSocket 调试运行中的树
