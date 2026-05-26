# BT Editor & Debugger

The [Behavior Tree Editor](https://lingzolabs.github.io/bt-editor/) is a companion visual tool for xtils behavior trees. It provides a drag-and-drop editor for designing trees, and a powerful replay/live-debugging system for analyzing tree execution.

**[🔗 Open Online Editor (GitHub Pages)](https://lingzolabs.github.io/bt-editor/)**

## Features

| Feature | Description |
|---------|-------------|
| **Visual Editing** | Drag-and-drop node creation, visual connections, zoom/pan |
| **JSON Import/Export** | Load and save trees in the same JSON format xtils uses |
| **Log Replay** | Load `.jsonl` logs from `BtFileLogger`, step through execution frame-by-frame |
| **Live Debugging** | Connect via WebSocket to observe running trees in real-time |
| **Custom Nodes** | Register your project's custom action/decorator nodes at runtime |

## Integration with xtils

The editor works directly with xtils behavior tree formats:

```
┌───────────────────┐         JSON tree files         ┌──────────────────┐
│  BT Editor        │ ◄──────────────────────────────► │  xtils BtFactory │
│  (browser)        │                                  │  (C++ runtime)   │
└───────────────────┘                                  └────────┬─────────┘
        ▲                                                       │
        │  .jsonl log file                                      │
        │  (or WebSocket)                                       ▼
        │                                              ┌──────────────────┐
        └───────────────────────────────────────────── │  BtFileLogger    │
                                                       └──────────────────┘
```

### Workflow

1. **Design** trees visually in the editor → Export as JSON
2. **Load** the JSON in xtils via `BtFactory::LoadTreeFile()` or `LoadTreesFromDirectory()`
3. **Run** your application with `BtFileLogger` enabled
4. **Debug** by loading the generated `.jsonl` file back into the editor for replay

## Setting Up BtFileLogger

In your xtils application, attach a `BtFileLogger` to capture execution traces:

```cpp
#include <xtils/fsm/behavior_tree.h>
#include <xtils/fsm/bt_filelogger.h>

// Create the logger (writes to bt_debug.jsonl)
auto logger = std::make_shared<BtFileLogger>("./bt_debug.jsonl");

// Pass it when building trees
auto tree = factory.buildFromRegisteredTree("sweep", blackboard, logger);

// Every tick is automatically recorded
while (running) {
  tree->tick();  // Logger captures tree structure + all node transitions
}
```

The logger generates a JSONL (newline-delimited JSON) file with the following event types:

### Log Format

```jsonl
{"type":"tree", "ts":1716000000000, "data":{"name":"sweep","root":{...}}}
{"type":"tick_begin", "ts":1716000000500, "tick":1}
{"type":"transition", "ts":1716000000500, "tick":1, "nid":0, "name":"Selector", "from":"Idle", "to":"Running"}
{"type":"transition", "ts":1716000000500, "tick":1, "nid":1, "name":"Sequence", "from":"Idle", "to":"Running"}
{"type":"transition", "ts":1716000000500, "tick":1, "nid":2, "name":"SweepAction", "from":"Idle", "to":"Running"}
{"type":"tick_end", "ts":1716000000501, "tick":1, "result":"Running"}
{"type":"tick_begin", "ts":1716000000700, "tick":2}
{"type":"transition", "ts":1716000000700, "tick":2, "nid":2, "name":"SweepAction", "from":"Running", "to":"Running"}
{"type":"tick_end", "ts":1716000000701, "tick":2, "result":"Running"}
```

| Event Type | Fields | Description |
|-----------|--------|-------------|
| `tree` | `data` | Full tree structure (emitted once at start) |
| `tick_begin` | `tick` | Start of a new tick cycle |
| `transition` | `tick`, `nid`, `name`, `from`, `to` | A node changed status |
| `tick_end` | `tick`, `result` | Tick completed with final result |

## Using the Editor

### Creating Trees Visually

1. Open the [editor](https://lingzolabs.github.io/bt-editor/)
2. Drag nodes from the left panel onto the canvas
3. Connect parent outputs to child inputs by dragging between ports
4. Configure node ports (e.g., `delay_ms`, `max_retries`) by clicking on nodes

### Registering Custom Nodes

Your project likely has custom action nodes (like `SweepAction`, `ReturnChargeAction`). Register them in the editor:

1. Click the **"+"** button in the sidebar
2. Enter node name (must match your C++ registration name)
3. Select type: Composite / Action / Decorator
4. Add ports if needed (input/output, name, type)

Or import a node definition JSON file:

```json
{
  "nodes": [
    { "id": "SweepAction", "type": 1, "ports": null },
    { "id": "ReturnChargeAction", "type": 1, "ports": null },
    { "id": "CheckBatteryLow", "type": 1, "ports": [
      { "name": "threshold", "mode": 0, "type_name": "int" }
    ]},
    { "id": "StuckDetectorAction", "type": 1, "ports": null },
    { "id": "BackOffAction", "type": 1, "ports": null }
  ]
}
```

Node types: `0` = Composite, `1` = Action, `2` = Decorator.
Port modes: `0` = Input, `1` = Output.

### Exporting Trees

Click **Export** → The editor produces JSON in the xtils-compatible format:

```json
{
  "name": "sweep",
  "root": {
    "name": "Fallback",
    "children": [
      {
        "name": "Sequence",
        "children": [
          { "name": "ReadSensorsAction" },
          { "name": "StuckDetectorAction" },
          { "name": "SweepAction" }
        ]
      },
      {
        "name": "SubTree",
        "ports": { "tree_name": "recovery_stuck" }
      }
    ]
  }
}
```

Save this file to your project's `bt_trees/` directory and load it with:

```cpp
factory.LoadTreeFile("./bt_trees/sweep.json");
// or load all trees from a directory:
factory.LoadTreesFromDirectory("./bt_trees");
```

## Log Replay

The replay feature lets you step through tree execution frame-by-frame with visual node coloring.

### Loading a Log File

1. Click the **Replay** button (🎮) in the toolbar
2. Click **"Load File"** and select your `.jsonl` file
3. The editor automatically imports the tree structure and sets up replay

### Playback Controls

| Control | Action |
|---------|--------|
| ▶️ Play | Auto-advance through ticks at configurable speed |
| ⏸️ Pause | Stop auto-advance |
| ⏮️ Step Back | Go to previous tick |
| ⏭️ Step Forward | Go to next tick |
| Slider | Seek to any tick directly |
| Speed | 0.5x / 1x / 2x / 5x / 10x |

### Visual Feedback

During replay, nodes are color-coded by their status:

| Status | Color | Meaning |
|--------|-------|---------|
| Idle | Gray | Not yet visited this tick |
| Running | Yellow/Amber | Currently executing |
| Success | Green | Completed successfully |
| Failure | Red | Failed |

The canvas auto-focuses on the active node so you can follow execution flow.

### Example: Debugging the Robot Vacuum

```bash
# 1. Run the robot with logging enabled
./robot_client 127.0.0.1:9000
# This creates bt_debug.jsonl in the working directory

# 2. Open the editor and load the log
# The tree structure is embedded in the log file
# Step through to see how the sweep progresses
```

Typical debugging scenarios:
- **Why did the robot get stuck?** — Step to the tick where `StuckDetectorAction` transitions from Success to Failure
- **Why didn't it go to charge?** — Check if `CheckBatteryLow` ever returned Success
- **Path planning issues** — Look at `SweepAction` transitions between Running and Failure

## Live WebSocket Debugging

For real-time debugging, the editor can connect to a running application via WebSocket.

### Setup on the xtils Side

Use xtils's Inspect module to expose a WebSocket endpoint that streams BT events:

```cpp
#include <xtils/debug/inspect.h>
#include <xtils/fsm/behavior_tree.h>

// In your service Init():
INSPECT_WEBSOCKET("/bt/live", "Live BT events", [](auto& req, auto& conn) {
  // Connection established — client will receive published events
});

// Create a logger that publishes to Inspect
class InspectBtLogger : public BtLogger {
  void record(const Node& n, Status from, Status to) override {
    Json event;
    event["type"] = "transition";
    event["tick"] = current_tick_;
    event["nid"] = n.getId();
    event["name"] = n.getName();
    event["from"] = StatusToStr(from);
    event["to"] = StatusToStr(to);
    Inspect::Get().Publish("/bt/live", event);
  }
  // ... similar for onTickBegin, onTickEnd, update
};
```

### Connecting from the Editor

1. Open the Replay panel
2. Click **"WebSocket"** tab
3. Enter URL: `ws://localhost:8080/bt/live`
4. Click **Connect**

The editor will receive events in real-time and update node colors as the tree executes. This is especially useful for:
- Monitoring long-running behaviors
- Observing how the tree reacts to external events
- Validating guard conditions and subtree switching

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Export tree |
| `Ctrl+C` | Copy selected node(s) |
| `Ctrl+V` | Paste node(s) |
| `Delete` | Delete selected |
| `Esc` | Deselect all |
| `Space + Drag` | Pan canvas |
| `Scroll` | Zoom in/out |

## Tree JSON Format Reference

The editor uses the same JSON format as xtils `BtFactory`:

```json
{
  "name": "tree_name",
  "root": {
    "name": "NodeTypeName",
    "type": 0,
    "ports": { "key": "value" },
    "children": [ ... ]
  }
}
```

### Node Types in JSON

| Type | Value | Example Nodes |
|------|-------|---------------|
| Composite | `0` | Sequence, Selector, Parallel, RandomSelector |
| Action | `1` | AlwaysSuccess, AlwaysFailure, Wait, custom actions |
| Decorator | `2` | Inverter, Repeater, Delay, Timeout, Retry |

### Port Values

Ports pass configuration to nodes. In the JSON format:

```json
{
  "name": "Retry",
  "type": 2,
  "ports": { "max_retries": 3 },
  "children": [{ "name": "SweepAction", "type": 1 }]
}
```

Blackboard references use the `&` prefix:

```json
{
  "name": "CheckBatteryLow",
  "type": 1,
  "ports": { "threshold": "&battery_threshold" }
}
```

This reads the `battery_threshold` value from the blackboard at runtime.

## Running Locally

For development or if you need the log-loading API:

```bash
git clone https://github.com/lingzolabs/bt-editor.git
cd bt-editor
npm install
npm start
# Open http://localhost:3000
```

The local server provides an additional API endpoint for loading logs from a `logs/` directory.

## Source Code

- **Repository**: [github.com/lingzolabs/bt-editor](https://github.com/lingzolabs/bt-editor)
- **Online Demo**: [lingzolabs.github.io/bt-editor](https://lingzolabs.github.io/bt-editor/)
- **License**: MIT
