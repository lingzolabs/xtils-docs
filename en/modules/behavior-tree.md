# Behavior Tree

The Behavior Tree (BT) module provides a JSON-driven behavior tree system with blackboard data sharing, input/output ports, subtrees, an event system, and structured logging. It's designed for complex decision-making logic such as robotics, game AI, and workflow automation.

## Overview

Behavior trees are a modular alternative to state machines for encoding complex logic. They compose simple building blocks (actions, conditions) into hierarchical trees using combinators (sequences, selectors, decorators).

```
         [Selector]
        /          \
  [Sequence]    [Fallback Action]
  /        \
[Check]  [Execute]
```

Key advantages over FSMs:
- **Composability** — nodes are reusable and combinable
- **Readability** — tree structure maps to decision logic
- **Extensibility** — add new behavior by adding subtrees, not rewiring transitions

## Header

```cpp
#include "xtils/fsm/behavior_tree.h"
```

## Core Concepts

### Node Types

| Type | Role | Examples |
|------|------|---------|
| **Composite** | Controls child execution order | Sequence, Selector |
| **Action** | Performs work, returns status | MoveToTarget, SendMessage |
| **Decorator** | Modifies child behavior | Inverter, Delay, Retry |

### Status

Every node tick returns one of:

```cpp
enum class Status {
  Success,   // Node completed successfully
  Failure,   // Node failed
  Running,   // Node needs more ticks to complete
  Idle       // Node hasn't started yet
};
```

### Tick Lifecycle

```cpp
class Node {
  Status tick();                          // Called by parent each frame
  virtual Status OnStart() { return Running; }  // First tick initialization
  virtual Status OnTick() = 0;           // Main logic (called every tick)
  virtual void OnStop() {}               // Cleanup after Success/Failure
};
```

## Built-in Nodes

| Node | Type | Description |
|------|------|-------------|
| `Sequence` | Composite | Runs children left-to-right; fails on first failure |
| `Selector` | Composite | Runs children left-to-right; succeeds on first success |
| `Inverter` | Decorator | Inverts child result (Success↔Failure) |
| `Delay` | Decorator | Delays child execution by `delay_ms` port |
| `Retry` | Decorator | Retries child up to `max_attempts` times on failure |
| `SubTree` | Decorator | Executes a registered subtree by `tree_name` port |
| `SimpleAction` | Action | Wraps a `std::function<Status()>` |
| `AlwaysSuccess` | Action | Always returns Success |
| `AlwaysFailure` | Action | Always returns Failure |
| `WaitForEvent` | Action | Blocks until event fires (`event_type`, `timeout_ms` ports) |
| `EventGuard` | Decorator | Interrupts child execution when event fires |

## BtFactory — Building Trees

```cpp
#include "xtils/fsm/behavior_tree.h"
using namespace xtils;

BtFactory factory;

// Register custom node types
factory.Register<MoveToTarget>("MoveToTarget");
factory.Register<CheckBattery>("CheckBattery");
factory.Register<ChargingAction>("ChargingAction");

// Register a simple action inline
factory.RegisterSimpleAction([]() {
  LogI("Hello from BT!");
  return Status::Success;
}, "SayHello");
```

### Loading Trees from JSON

```cpp
// Load a single tree file
factory.LoadTreeFile("trees/patrol.json");

// Load all .json files in a directory
size_t count = factory.LoadTreesFromDirectory("./bt_trees");
LogI("Loaded %zu trees", count);
```

### Building and Running

```cpp
// Build from a registered tree
auto blackboard = std::make_shared<AnyMap>();
blackboard->set("target_x", 10);
blackboard->set("target_y", 5);

auto tree = factory.buildFromRegisteredTree("patrol", blackboard);

// Tick loop
while (tree->tick() == Status::Running) {
  std::this_thread::sleep_for(std::chrono::milliseconds(100));
}
```

## JSON Tree Format

Trees are defined in JSON files:

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
        "type": "Selector",
        "children": [
          {
            "type": "MoveToTarget",
            "ports": { "target_x": "{waypoint_x}", "target_y": "{waypoint_y}" }
          },
          {
            "type": "ReturnToBase"
          }
        ]
      }
    ]
  }
}
```

Port values in `{braces}` reference blackboard keys. Literal values are passed directly.

## Ports & Blackboard

### Declaring Ports

Custom nodes declare their input/output ports:

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
    
    // Movement logic...
    if (at_target) {
      setOutput("reached", true);
      return Status::Success;
    }
    return Status::Running;
  }
};
```

### Blackboard (AnyMap)

The blackboard is shared across all nodes in a tree:

```cpp
AnyMap blackboard;

// Write
blackboard.set<int>("counter", 0);
blackboard.set<std::string>("target", "waypoint_a");
blackboard.set("robot_state", shared_ptr_to_state);

// Read
auto counter = blackboard.get<int>("counter");      // → std::optional<int>
auto target = blackboard.get<std::string>("target"); // → std::optional<string>

// Check & list
bool exists = blackboard.has("counter");
auto keys = blackboard.keys();  // → vector<string>
```

## BtTree Interface

```cpp
class BtTree {
 public:
  BtTree(Node::Ptr root, const std::string& name = "",
         std::shared_ptr<AnyMap> blackboard = nullptr,
         std::shared_ptr<BtLogger> logger = nullptr);

  Status tick();        // Tick the tree once
  void reset();         // Reset all nodes to Idle
  void shutdown();      // Stop and cleanup

  AnyMap& blackboard();  // Access the shared blackboard

  // Visualization
  std::string dump();   // Text representation
  Json dumpTree();      // JSON representation

  // Pause/Resume
  void pause();
  void resume();
  bool isPaused() const;

  // Event system
  void sendEvent(EventType type, const AnyData& data = {});
  std::optional<BtEvent> peekEvent(EventType type) const;
  std::optional<BtEvent> consumeEvent(EventType type);
  bool hasEvent(EventType type) const;
  void clearEvents();
};
```

## Subtrees

Subtrees allow composing complex behaviors from smaller reusable trees:

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

Each subtree shares the parent's blackboard, enabling data flow between trees.

## Event System

Trees can communicate through events:

```cpp
// Send event from application code
tree->sendEvent(EventType::OBSTACLE_DETECTED, AnyData(obstacle_info));

// In a WaitForEvent node (blocks until event fires)
{
  "type": "WaitForEvent",
  "ports": { "event_type": "1", "timeout_ms": "5000" }
}

// EventGuard: interrupts child when event fires
{
  "type": "EventGuard",
  "ports": { "event_type": "2" },
  "child": { "type": "LongRunningAction" }
}
```

## BtLogger

Structured logging for offline analysis and live debugging:

```cpp
#include "xtils/fsm/bt_logger.h"

// File logger — writes structured log to file
auto file_logger = std::make_shared<BtFileLogger>("bt_trace.log");

// Inspect logger — sends to debug server via WebSocket
auto inspect_logger = std::make_shared<BtInspectLogger>("/debug/bt");

// Composite — combine multiple loggers
auto logger = std::make_shared<BtCompositeLogger>();
logger->Add(file_logger);
logger->Add(inspect_logger);

auto tree = factory.buildFromRegisteredTree("main", blackboard, logger);
```

## Custom Action Node Example

```cpp
class SendNotification : public ActionNode {
 public:
  SendNotification(const std::string& name = "") : ActionNode(name) {}

  static Ports getPorts() {
    return {
      InputPort<std::string>("message"),
      InputPort<std::string>("channel")
    };
  }

  static std::string desc() { return "Send a notification message"; }

  Status OnStart() override {
    auto msg = getInput<std::string>("message");
    auto ch = getInput<std::string>("channel");
    if (!msg || !ch) return Status::Failure;
    
    // Start async send...
    pending_ = send_async(*ch, *msg);
    return Status::Running;
  }

  Status OnTick() override {
    if (pending_.is_ready()) {
      return pending_.success() ? Status::Success : Status::Failure;
    }
    return Status::Running;
  }

  void OnStop() override {
    pending_.cancel();
  }

 private:
  AsyncResult pending_;
};
```

## Complete Example

```cpp
#include <xtils/fsm/behavior_tree.h>
#include <xtils/logging/logger.h>

using namespace xtils;

// Define custom nodes
class PrintMessage : public ActionNode {
 public:
  PrintMessage(const std::string& name = "") : ActionNode(name) {}
  static Ports getPorts() { return { InputPort<std::string>("text") }; }
  
  Status OnTick() override {
    auto text = getInput<std::string>("text");
    if (!text) return Status::Failure;
    LogI("BT says: %s", text->c_str());
    return Status::Success;
  }
};

class CountDown : public ActionNode {
 public:
  CountDown(const std::string& name = "") : ActionNode(name) {}
  static Ports getPorts() { return { InputPort<int>("from") }; }

  Status OnStart() override {
    auto from = getInput<int>("from");
    count_ = from.value_or(3);
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

  // Build tree from JSON
  Json tree_json = Json::parse(R"({
    "name": "demo",
    "root": {
      "type": "Sequence",
      "children": [
        { "type": "PrintMessage", "ports": { "text": "Starting countdown!" } },
        { "type": "CountDown", "ports": { "from": "5" } },
        { "type": "PrintMessage", "ports": { "text": "Done!" } }
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

## Visual Tools

For designing and debugging behavior trees visually, see the [BT Editor & Debugger](/en/examples/bt-editor) — a companion browser-based tool that supports:

- Drag-and-drop tree design with JSON export
- JSONL log replay for offline execution analysis
- Live WebSocket debugging of running trees
