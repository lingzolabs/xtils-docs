# BT 编辑器与调试器

[行为树编辑器](https://lingzolabs.github.io/bt-editor/) 是 xtils 行为树的配套可视化工具。它提供拖拽式树编辑器，以及强大的回放/实时调试系统用于分析树的执行过程。

**[🔗 在线编辑器 (GitHub Pages)](https://lingzolabs.github.io/bt-editor/)**

## 功能特性

| 功能 | 说明 |
|------|------|
| **可视化编辑** | 拖拽创建节点、可视化连接、缩放/平移 |
| **JSON 导入导出** | 加载和保存与 xtils 相同格式的 JSON 树 |
| **日志回放** | 加载 `BtFileLogger` 生成的 `.jsonl` 日志，逐帧回放执行过程 |
| **实时调试** | 通过 WebSocket 连接，实时观察运行中的行为树 |
| **自定义节点** | 运行时注册项目的自定义动作/装饰器节点 |

## 与 xtils 的集成

编辑器直接使用 xtils 的行为树格式：

```
┌───────────────────┐         JSON 树文件            ┌──────────────────┐
│  BT 编辑器        │ ◄──────────────────────────────► │  xtils BtFactory │
│  (浏览器)         │                                  │  (C++ 运行时)    │
└───────────────────┘                                  └────────┬─────────┘
        ▲                                                       │
        │  .jsonl 日志文件                                       │
        │  (或 WebSocket)                                       ▼
        │                                              ┌──────────────────┐
        └───────────────────────────────────────────── │  BtFileLogger    │
                                                       └──────────────────┘
```

### 工作流程

1. 在编辑器中**可视化设计**行为树 → 导出为 JSON
2. 在 xtils 中通过 `BtFactory::LoadTreeFile()` 或 `LoadTreesFromDirectory()` **加载** JSON
3. 启用 `BtFileLogger` **运行**应用程序
4. 将生成的 `.jsonl` 文件加载回编辑器进行**调试**回放

## 配置 BtFileLogger

在 xtils 应用中，挂载 `BtFileLogger` 来捕获执行轨迹：

```cpp
#include <xtils/fsm/behavior_tree.h>
#include <xtils/fsm/bt_filelogger.h>

// 创建日志记录器（写入 bt_debug.jsonl）
auto logger = std::make_shared<BtFileLogger>("./bt_debug.jsonl");

// 构建树时传入
auto tree = factory.buildFromRegisteredTree("sweep", blackboard, logger);

// 每次 tick 都会自动记录
while (running) {
  tree->tick();  // 记录器捕获树结构 + 所有节点状态转换
}
```

记录器生成 JSONL（换行分隔的 JSON）文件，包含以下事件类型：

### 日志格式

```jsonl
{"type":"tree", "ts":1716000000000, "data":{"name":"sweep","root":{...}}}
{"type":"tick_begin", "ts":1716000000500, "tick":1}
{"type":"transition", "ts":1716000000500, "tick":1, "nid":0, "name":"Selector", "from":"Idle", "to":"Running"}
{"type":"transition", "ts":1716000000500, "tick":1, "nid":1, "name":"Sequence", "from":"Idle", "to":"Running"}
{"type":"transition", "ts":1716000000500, "tick":1, "nid":2, "name":"SweepAction", "from":"Idle", "to":"Running"}
{"type":"tick_end", "ts":1716000000501, "tick":1, "result":"Running"}
```

| 事件类型 | 字段 | 说明 |
|---------|------|------|
| `tree` | `data` | 完整树结构（启动时发出一次） |
| `tick_begin` | `tick` | 新 tick 周期开始 |
| `transition` | `tick`, `nid`, `name`, `from`, `to` | 节点状态变更 |
| `tick_end` | `tick`, `result` | tick 完成，附带最终结果 |

## 使用编辑器

### 可视化创建树

1. 打开[编辑器](https://lingzolabs.github.io/bt-editor/)
2. 从左侧面板拖拽节点到画布
3. 从父节点输出端口拖拽到子节点输入端口建立连接
4. 点击节点配置端口参数（如 `delay_ms`、`max_retries`）

### 注册自定义节点

你的项目可能有自定义动作节点（如 `SweepAction`、`ReturnChargeAction`）。在编辑器中注册它们：

1. 点击侧边栏的 **"+"** 按钮
2. 输入节点名称（必须与 C++ 注册名匹配）
3. 选择类型：组合 / 动作 / 装饰器
4. 按需添加端口（输入/输出，名称，类型）

或者导入节点定义 JSON 文件：

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

节点类型：`0` = 组合节点，`1` = 动作节点，`2` = 装饰器节点。
端口模式：`0` = 输入，`1` = 输出。

### 导出树

点击 **导出** → 编辑器生成 xtils 兼容格式的 JSON：

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

将文件保存到项目的 `bt_trees/` 目录，然后加载：

```cpp
factory.LoadTreeFile("./bt_trees/sweep.json");
// 或从目录批量加载：
factory.LoadTreesFromDirectory("./bt_trees");
```

## 日志回放

回放功能让你逐帧浏览树的执行过程，节点以颜色标示状态。

### 加载日志文件

1. 点击工具栏的 **回放** 按钮（🎮）
2. 点击 **"加载文件"** 选择 `.jsonl` 文件
3. 编辑器自动导入树结构并进入回放模式

### 播放控制

| 控制 | 操作 |
|------|------|
| ▶️ 播放 | 按可配置速度自动推进 |
| ⏸️ 暂停 | 停止自动推进 |
| ⏮️ 后退 | 到前一个 tick |
| ⏭️ 前进 | 到下一个 tick |
| 滑块 | 跳转到任意 tick |
| 速度 | 0.5x / 1x / 2x / 5x / 10x |

### 视觉反馈

回放时，节点按状态着色：

| 状态 | 颜色 | 含义 |
|------|------|------|
| Idle | 灰色 | 本 tick 未访问 |
| Running | 黄色/琥珀色 | 正在执行 |
| Success | 绿色 | 成功完成 |
| Failure | 红色 | 执行失败 |

画布会自动聚焦到活跃节点，方便跟踪执行流程。

### 示例：调试扫地机器人

```bash
# 1. 启用日志运行机器人
./robot_client 127.0.0.1:9000
# 在工作目录生成 bt_debug.jsonl

# 2. 打开编辑器加载日志
# 树结构已嵌入日志文件中
# 逐帧查看清扫过程
```

典型调试场景：
- **为什么机器人卡住了？** — 跳到 `StuckDetectorAction` 从 Success 变为 Failure 的 tick
- **为什么没去充电？** — 检查 `CheckBatteryLow` 是否曾返回 Success
- **路径规划问题** — 观察 `SweepAction` 在 Running 和 Failure 之间的转换

## 实时 WebSocket 调试

编辑器可以通过 WebSocket 连接到运行中的应用进行实时调试。

### xtils 端设置

使用 Inspect 模块暴露 WebSocket 端点来推送 BT 事件：

```cpp
#include <xtils/debug/inspect.h>
#include <xtils/fsm/behavior_tree.h>

// 在 Service 的 Init() 中：
INSPECT_WEBSOCKET("/bt/live", "Live BT events", [](auto& req, auto& conn) {
  // 连接建立 — 客户端将接收发布的事件
});

// 创建向 Inspect 发布的日志记录器
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
  // ... onTickBegin, onTickEnd, update 类似实现
};
```

### 从编辑器连接

1. 打开回放面板
2. 点击 **"WebSocket"** 标签
3. 输入 URL：`ws://localhost:8080/bt/live`
4. 点击 **连接**

编辑器将实时接收事件并更新节点颜色。特别适用于：
- 监控长时间运行的行为
- 观察树对外部事件的响应
- 验证守卫条件和子树切换

## 键盘快捷键

| 快捷键 | 操作 |
|--------|------|
| `Ctrl+S` | 导出树 |
| `Ctrl+C` | 复制选中节点 |
| `Ctrl+V` | 粘贴节点 |
| `Delete` | 删除选中 |
| `Esc` | 取消选择 |
| `Space + 拖拽` | 平移画布 |
| `滚轮` | 缩放 |

## 树 JSON 格式参考

编辑器使用与 xtils `BtFactory` 相同的 JSON 格式：

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

### JSON 中的节点类型

| 类型 | 值 | 示例节点 |
|------|-----|---------|
| 组合节点 | `0` | Sequence, Selector, Parallel, RandomSelector |
| 动作节点 | `1` | AlwaysSuccess, AlwaysFailure, Wait, 自定义动作 |
| 装饰器 | `2` | Inverter, Repeater, Delay, Timeout, Retry |

### 端口值

端口向节点传递配置。JSON 格式中：

```json
{
  "name": "Retry",
  "type": 2,
  "ports": { "max_retries": 3 },
  "children": [{ "name": "SweepAction", "type": 1 }]
}
```

黑板引用使用 `&` 前缀：

```json
{
  "name": "CheckBatteryLow",
  "type": 1,
  "ports": { "threshold": "&battery_threshold" }
}
```

这会在运行时从黑板读取 `battery_threshold` 的值。

## 本地运行

用于开发或需要日志加载 API 时：

```bash
git clone https://github.com/lingzolabs/bt-editor.git
cd bt-editor
npm install
npm start
# 打开 http://localhost:3000
```

本地服务器提供额外的 API 端点，可从 `logs/` 目录加载日志文件。

## 源代码

- **仓库**: [github.com/lingzolabs/bt-editor](https://github.com/lingzolabs/bt-editor)
- **在线演示**: [lingzolabs.github.io/bt-editor](https://lingzolabs.github.io/bt-editor/)
- **许可证**: MIT
