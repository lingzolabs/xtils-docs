# 扫地机器人模拟器

一个完整的扫地机器人模拟器，展示如何将多个 xtils 模块组合成实时交互应用。系统采用客户端-服务器架构，配备基于浏览器的可视化 UI。

## 概述

本示例展示了以下模块的综合运用：

| 模块 | 在本示例中的角色 |
|------|-----------------|
| **App 框架** | 客户端和服务器的服务生命周期管理 |
| **FSM** | 机器人高层状态管理（空闲 → 清扫 → 充电 → 暂停） |
| **行为树** | 详细的清扫逻辑，支持多种清扫模式 |
| **WebSocket** | 实时双向通信 |
| **HTTP 服务器** | REST API + 静态文件服务 |
| **日志** | 全程结构化日志 |
| **JSON** | 协议序列化、地图配置、行为树定义 |

## 系统架构

![系统架构图](/images/robot-architecture.svg)

## 项目结构

```
xtils_app/
├── CMakeLists.txt              # 根构建文件
├── common/
│   ├── protocol.h              # 共享类型：RobotState, RobotMode, MapData
│   ├── map.h                   # 地图数据结构 (CellType, Room, Point)
│   └── map_config.json         # 默认地图布局
├── client/
│   ├── CMakeLists.txt
│   ├── main.cc                 # RobotClientService (FSM + BT + WS 客户端)
│   ├── robot_actions.h         # 所有行为树动作节点
│   ├── sensors.h               # 传感器模拟器（碰撞、悬崖、灰尘）
│   ├── pathfinder.h            # A* 寻路算法
│   ├── physics.h               # 物理常量（电池消耗、速度）
│   └── bt_trees/               # JSON 行为树定义文件
│       ├── sweep.json
│       ├── sweep_room.json
│       ├── sweep_wall.json
│       ├── spot_clean.json
│       ├── charge.json
│       └── recovery_stuck.json
├── server/
│   ├── CMakeLists.txt
│   ├── main.cc                 # ServerService (HTTP + WS 中心)
│   └── web/
│       └── index.html          # 浏览器 UI
└── fsm_graph.dot               # 生成的 FSM 可视化文件
```

## FSM 层

FSM 提供高层状态管理。它定义机器人**应该做什么**，而行为树定义**如何去做**。

### 状态定义

```cpp
enum RobotEvent : fsm::EventType {
  CMD_START_SWEEP     = 1,   // 用户命令
  CMD_RETURN_CHARGE   = 2,
  CMD_PAUSE           = 3,
  CMD_RESUME          = 4,
  CMD_STOP            = 5,
  CMD_START_ROOM_SWEEP = 6,
  CMD_START_WALL_FOLLOW = 7,
  CMD_START_SPOT_CLEAN = 8,
  EVT_BATTERY_LOW     = 10,  // 系统事件
  EVT_CHARGE_COMPLETE = 12,
  EVT_SWEEP_COMPLETE  = 13,
};
```

### 状态机配置

每个状态的进入回调会激活对应的行为树：

```cpp
void SetupFSM() {
  // 注册人类可读的事件名称，用于调试
  fsm_.RegisterEvent(CMD_START_SWEEP, "start_sweep");
  fsm_.RegisterEvent(CMD_RETURN_CHARGE, "return_charge");
  fsm_.RegisterEvent(CMD_PAUSE, "pause");
  fsm_.RegisterEvent(EVT_BATTERY_LOW, "battery_low");
  // ...

  fsm_.AddState("Idle", [this](const fsm::State&, fsm::EventType evt) {
    robot_state_->mode = RobotMode::Idle;
    active_tree_ = nullptr;  // 空闲状态不运行行为树
    if (evt == CMD_STOP) {
      // 显式停止时重置清扫地图
      for (auto& row : robot_state_->cleaned)
        std::fill(row.begin(), row.end(), false);
    }
  });

  fsm_.AddState("Sweeping", [this](const fsm::State&, fsm::EventType) {
    robot_state_->mode = RobotMode::Sweeping;
    // 根据清扫模式选择对应的行为树
    std::string tree_name = "sweep";
    if (sweep_mode_ == "room") tree_name = "sweep_room";
    else if (sweep_mode_ == "wall") tree_name = "sweep_wall";
    else if (sweep_mode_ == "spot") tree_name = "spot_clean";
    SwitchTree(tree_name);
  });

  fsm_.AddState("Charging", [this](const fsm::State&, fsm::EventType) {
    robot_state_->mode = RobotMode::Returning;
    SwitchTree("charge");  // 先导航到充电站，再充电
  });

  fsm_.AddState("Paused", [this](const fsm::State&, fsm::EventType) {
    robot_state_->mode = RobotMode::Paused;
    // 暂停状态下不执行行为树
  });
}
```

### 带守卫条件的转换

守卫条件实现条件性状态转换：

```cpp
// 充电完成后：如果还有未完成的清扫任务，则恢复清扫
fsm_.AddTransition("Charging", "Sweeping", EVT_CHARGE_COMPLETE,
    fsm::MakeGuard("has_pending_sweep", [this](const fsm::State&,
        const fsm::State&, fsm::EventType) {
      return pending_task_ == "sweep" && !AllCleaned();
    }));

// 兜底：如果没有待完成任务，回到空闲
fsm_.AddTransition("Charging", "Idle", EVT_CHARGE_COMPLETE);

// 从暂停恢复：回到之前的活动
fsm_.AddTransition("Paused", "Sweeping", CMD_RESUME,
    fsm::MakeGuard("was_sweeping", [this](const fsm::State&,
        const fsm::State&, fsm::EventType) {
      return pending_task_ == "sweep";
    }));
```

::: tip FSM + BT 模式
FSM 处理**模式间的转换**（做什么），行为树处理**模式内的执行**（怎么做）。这种分离让两层都保持简单且可测试。
:::

### Graphviz 导出

FSM 可以导出其图结构用于可视化：

```cpp
void ExportFsmDot() {
  std::ofstream ofs("fsm_graph.dot");
  ofs << fsm_.ToDotGraph();
}
```

生成的 DOT 文件可以用 `dot -Tsvg fsm_graph.dot -o fsm_graph.svg` 渲染。

## 行为树层

行为树定义每个模式下的详细逻辑，在运行时从 JSON 文件加载。

### 树注册

```cpp
// 注册所有自定义动作节点
factory_.Register<SweepAction>("SweepAction");
factory_.Register<ReturnChargeAction>("ReturnChargeAction");
factory_.Register<ChargingAction>("ChargingAction");
factory_.Register<CheckBatteryLow>("CheckBatteryLow");
factory_.Register<StuckDetectorAction>("StuckDetectorAction");
factory_.Register<BackOffAction>("BackOffAction");
factory_.Register<RotateRandomAction>("RotateRandomAction");
factory_.Register<RoomSweepAction>("RoomSweepAction");
factory_.Register<WallFollowAction>("WallFollowAction");
factory_.Register<SpotCleanAction>("SpotCleanAction");
factory_.Register<ReadSensorsAction>("ReadSensorsAction");
factory_.Register<EmergencyStopAction>("EmergencyStopAction");
// ...

// 从目录批量加载所有树定义
factory_.LoadTreesFromDirectory("./bt_trees");
```

### 清扫树 (sweep.json)

主清扫树使用 Fallback（选择器）节点：先尝试正常清扫，如果卡住则执行恢复逻辑：

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

**工作原理：**
1. `ReadSensorsAction` — 读取碰撞/悬崖/灰尘传感器数据到黑板
2. `StuckDetectorAction` — 检查最近 5 个 tick 内移动是否少于 2 格
3. `SweepAction` — A* 寻路到最近的未清扫格子，每 tick 移动一步
4. 如果卡住（StuckDetectorAction 返回 Failure），Fallback 触发恢复子树

### 充电树 (charge.json)

演示装饰器节点（Retry + Timeout）：

```json
{
  "name": "charge",
  "root": {
    "name": "Sequence",
    "children": [
      {
        "name": "Retry",
        "ports": { "max_retries": 3 },
        "children": [
          {
            "name": "Timeout",
            "ports": { "timeout_ms": 30000 },
            "children": [
              { "name": "ReturnChargeAction" }
            ]
          }
        ]
      },
      { "name": "ChargingAction" }
    ]
  }
}
```

**流程：** 导航到充电站（失败重试，30 秒超时）→ 然后充电直到 100%。

### 恢复子树 (recovery_stuck.json)

用于脱困的简单序列：

```json
{
  "name": "recovery_stuck",
  "root": {
    "name": "Sequence",
    "children": [
      { "name": "BackOffAction" },
      { "name": "RotateRandomAction" },
      { "name": "ResetStuckFlagAction" }
    ]
  }
}
```

### 自定义动作节点实现

以下是 `SweepAction` 的实现 — 核心清扫逻辑：

```cpp
class SweepAction : public xtils::ActionNode {
 public:
  SweepAction(const std::string& name = "") : ActionNode(name) {}

  xtils::Status OnStart() override {
    path_.clear();
    path_idx_ = 0;
    return xtils::Status::Running;
  }

  xtils::Status OnTick() override {
    auto state = GetRobotState(blackboard_);
    if (!state) return xtils::Status::Failure;

    // 标记当前格子为已清扫
    state->cleaned[state->y][state->x] = true;

    // 路径用尽时，规划新路径到最近的未清扫格子
    if (path_idx_ >= (int)path_.size()) {
      auto map = GetMapData(blackboard_);
      if (!map) return xtils::Status::Failure;

      // 找最近的未清扫可行走格子（曼哈顿距离）
      Point target = FindNearestUncleaned(*state, *map);
      if (target.x < 0) {
        return xtils::Status::Success;  // 全部清扫完成！
      }

      // A* 寻路
      path_ = pathfinder::FindPath(*map, {state->x, state->y}, target);
      if (path_.empty()) {
        state->cleaned[target.y][target.x] = true;  // 不可达
        return xtils::Status::Running;
      }
      path_idx_ = 1;  // 跳过起始位置
    }

    // 沿路径移动一步
    state->x = path_[path_idx_].x;
    state->y = path_[path_idx_].y;
    path_idx_++;

    // 消耗电量
    state->battery -= physics::DRAIN_SWEEPING;
    return xtils::Status::Running;
  }

 private:
  std::vector<Point> path_;
  int path_idx_ = 0;
};
```

### 卡住检测与恢复

`StuckDetectorAction` 通过滑动窗口监控移动情况：

```cpp
class StuckDetectorAction : public xtils::ActionNode {
  xtils::Status OnTick() override {
    auto state = GetRobotState(blackboard_);
    history_.push_back({state->x, state->y});
    if (history_.size() > 5) history_.erase(history_.begin());

    if (history_.size() < 5) return xtils::Status::Success;

    // 计算窗口内总位移
    int displacement = 0;
    for (int i = 1; i < history_.size(); i++) {
      displacement += std::abs(history_[i].x - history_[i-1].x)
                    + std::abs(history_[i].y - history_[i-1].y);
    }

    if (displacement < 2) {
      state->is_stuck = true;
      return xtils::Status::Failure;  // 触发恢复子树
    }
    return xtils::Status::Success;
  }
};
```

### 黑板使用

黑板在节点之间以及 FSM/BT 层之间共享数据：

```cpp
void SwitchTree(const std::string& name) {
  auto bb = std::make_shared<AnyMap>();
  
  // 共享机器人状态（FSM 写模式，BT 读写位置和电量）
  bb->set("robot_state", robot_state_);
  
  // 共享地图数据（用于寻路）
  bb->set("map", map_data_);
  
  // 定点清扫参数（仅 spot_clean 树使用）
  if (name == "spot_clean") {
    bb->set("spot_x", spot_x_);
    bb->set("spot_y", spot_y_);
    bb->set("spot_radius", spot_radius_);
  }

  active_tree_ = factory_.buildFromRegisteredTree(name, bb, bt_logger_);
}
```

## 传感器模拟

`SensorSimulator` 提供带噪声和故障注入的真实传感器数据：

```cpp
class SensorSimulator {
 public:
  SensorData Update(const MapData& map, int x, int y, bool cleaned) {
    SensorData data;

    // 碰撞传感器：真实检测 + 2% 误报率
    bool real_collision = HasAdjacentObstacle(map, x, y);
    data.collision = collision_fault_
        ? RandomBool(0.5)   // 故障时：随机输出
        : real_collision || RandomBool(0.02);

    // 悬崖传感器：靠近地图边缘 + 1% 误报率
    bool real_cliff = IsNearEdge(map, x, y);
    data.cliff = cliff_fault_
        ? RandomBool(0.5)
        : real_cliff || RandomBool(0.01);

    // 灰尘传感器：基于是否已清扫 + 高斯噪声
    int base_dust = cleaned ? 10 : 80;
    std::normal_distribution<double> noise(0.0, 5.0);
    data.dust_level = std::clamp(base_dust + (int)noise(rng_), 0, 100);

    return data;
  }

  // 故障注入（用于测试）
  void SetCollisionFault(bool fault) { collision_fault_ = fault; }
  void SetCliffFault(bool fault) { cliff_fault_ = fault; }
};
```

## 网络层

### WebSocket 客户端（机器人 → 服务器）

机器人客户端连接到服务器，每 200ms 上报一次状态：

```cpp
void Init() override {
  // 配置 WebSocket 自动重连
  ws_listener_.SetCommandCallback([this](const std::string& msg) {
    HandleCommand(msg);  // 处理来自服务器/浏览器的命令
  });
  
  ws_client_ = std::make_unique<WebSocketClient>(&task_runner_, &ws_listener_);
  ws_client_->SetAutoReconnect(true, 3000);  // 断开后每 3 秒重连
  ws_client_->Connect("ws://" + server_url_ + "/ws");

  // 主循环
  ctx->Every(200, [this]() {
    UpdateSensors();
    TickBehaviorTree();
    ReportState();  // 通过 WebSocket 发送完整状态 JSON
  });
}
```

### HTTP 服务器（服务 UI + 中转消息）

服务器作为机器人客户端和浏览器 UI 之间的中心：

```cpp
class RobotServerHandler : public HttpRequestHandler {
  void OnHttpRequest(const HttpRequest& req) override {
    std::string path(req.uri);
    std::string method(req.method);

    // WebSocket 升级用于实时流
    if (req.is_websocket_handshake && path == "/ws") {
      req.conn->UpgradeToWebsocket(req);
      ws_clients_.push_back(req.conn);
      return;
    }

    // REST API
    if (path == "/api/map" && method == "GET") {
      SendJson(req.conn, map_json_);
      return;
    }

    if (path == "/api/command" && method == "POST") {
      BroadcastCommand(std::string(req.body));
      SendJson(req.conn, R"({"ok":true})");
      return;
    }

    // 静态文件服务
    ServeStaticFile(req, path);
  }

  void OnWebsocketMessage(const WebsocketMessage& msg) override {
    // 机器人状态更新 → 广播给所有浏览器客户端
    auto j = Json::parse(msg.data);
    if (j && j->has_key("mode")) {
      current_state_ = std::string(msg.data);
      BroadcastState(current_state_);
    }
  }
};
```

### 通信协议

所有消息均为 JSON。机器人状态上报：

```json
{
  "x": 5, "y": 3,
  "battery": 72,
  "mode": "sweeping",
  "sweep_mode": "zigzag",
  "sensor_collision": false,
  "sensor_cliff": false,
  "sensor_dust_level": 45,
  "is_stuck": false,
  "active_tree_name": "sweep",
  "bt_status": "running",
  "bt_events": ["Tree switched: sweep"],
  "cleaned": [0,0,1,1,1,0,...],
  "current_path": [{"x":5,"y":3},{"x":5,"y":4},{"x":6,"y":4}]
}
```

浏览器下发命令：

```json
{"command": "start_sweep"}
{"command": "start_room_sweep"}
{"command": "pause"}
{"command": "resume"}
{"command": "stop"}
{"command": "start_spot_clean", "x": 5, "y": 3, "radius": 3}
```

## 多种清扫模式

机器人支持 4 种清扫模式，每种对应独立的行为树：

| 模式 | 树文件 | 算法 | 说明 |
|------|--------|------|------|
| 锯齿形 | `sweep.json` | A* 最近未清扫格 | 标准清扫 — 寻找最近的脏格子 |
| 逐房间 | `sweep_room.json` | 按房间顺序 | 一次清扫一个房间 |
| 沿边 | `sweep_wall.json` | 右手法则 | 沿墙壁/障碍物清扫边缘 |
| 定点 | `spot_clean.json` | 螺旋向外 | 清扫某个点周围的圆形区域 |

### 沿边算法

使用右手法则进行边缘清扫：

```cpp
class WallFollowAction : public xtils::ActionNode {
  xtils::Status OnTick() override {
    // 右手法则：尝试右转、直行、左转、掉头
    int try_dirs[] = {
      (direction_ + 1) % 4,  // 右转
      direction_,             // 直行
      (direction_ + 3) % 4,  // 左转
      (direction_ + 2) % 4   // 掉头
    };

    for (int d : try_dirs) {
      int nx = state->x + dx[d];
      int ny = state->y + dy[d];
      if (map.IsWalkable(nx, ny)) {
        state->x = nx;
        state->y = ny;
        direction_ = d;
        break;
      }
    }

    // 回到起点时完成
    if (steps_ > 4 && state->x == start_x_ && state->y == start_y_) {
      return xtils::Status::Success;
    }
    return xtils::Status::Running;
  }
};
```

## 主循环

FSM、BT、传感器和通信的集成点：

```cpp
ctx->Every(200, [this]() {
  // 1. 更新传感器读数
  UpdateSensors();

  // 2. 执行当前活跃的行为树
  TickBehaviorTree();

  // 3. 向服务器上报状态
  ReportState();
});
```

### TickBehaviorTree — 集成逻辑

```cpp
void TickBehaviorTree() {
  // 根据当前状态生成告警
  robot_state_->alerts.clear();
  if (robot_state_->battery <= 10 && !fsm_.IsInState("Charging"))
    robot_state_->alerts.push_back("low_battery_critical");
  if (robot_state_->is_stuck)
    robot_state_->alerts.push_back("stuck");

  // 暂停或空闲时不执行
  if (fsm_.IsInState("Paused") || fsm_.IsInState("Idle")) return;
  if (!active_tree_) return;

  // 执行行为树
  auto status = active_tree_->tick();

  if (status == Status::Running) {
    // 清扫时低电量自动返回充电
    if (fsm_.IsInState("Sweeping") && robot_state_->battery <= 20) {
      fsm_.ProcessEvent(EVT_BATTERY_LOW);
    }
    return;
  }

  // 树执行完成 — 触发 FSM 事件
  if (fsm_.IsInState("Sweeping")) {
    fsm_.ProcessEvent(EVT_SWEEP_COMPLETE);
  } else if (fsm_.IsInState("Charging")) {
    fsm_.ProcessEvent(EVT_CHARGE_COMPLETE);
  }
}
```

## 地图系统

地图以 JSON 定义，支持运行时动态编辑：

```json
{
  "width": 20,
  "height": 15,
  "charger_x": 1,
  "charger_y": 1,
  "obstacles": [1,1,1,...,0,0,0,...,1,1,1],
  "rooms": [
    {"id": 1, "name": "客厅", "x1": 1, "y1": 1, "x2": 9, "y2": 7},
    {"id": 2, "name": "厨房", "x1": 10, "y1": 1, "x2": 18, "y2": 7}
  ]
}
```

格子类型：`0` = 空地（可行走），`1` = 墙壁，`2` = 家具。

## A* 寻路

机器人使用 A* 算法配合曼哈顿距离启发式进行导航：

```cpp
namespace pathfinder {

std::vector<Point> FindPath(const MapData& map, Point start, Point goal) {
  // 四方向移动（无对角线）
  // 曼哈顿距离启发式（对四方向移动是容许的）
  // 优先队列（按 f = g + h 排列的最小堆）
  // 返回包含起点和终点的路径，不可达时返回空

  auto heuristic = [&](int x, int y) -> int {
    return std::abs(x - goal.x) + std::abs(y - goal.y);
  };

  // ... 标准 A* 实现 ...

  // 沿 parent 指针重建路径
  std::vector<Point> path;
  int key = goal_key;
  while (key != start_key) {
    path.push_back(decode(key));
    key = parent[key];
  }
  path.push_back(start);
  std::reverse(path.begin(), path.end());
  return path;
}

}  // namespace pathfinder
```

## 服务生命周期

客户端和服务器都遵循 xtils Service 模式：

```cpp
// 客户端：在 Deinit 中进行清理，此时事件循环仍在运行
void Deinit() override {
  if (ws_client_ && ws_client_->IsConnected()) {
    ws_client_->Close();  // WebSocket 关闭握手需要事件循环！
  }
}

// 服务器：优雅停止 HTTP 服务器
void Deinit() override {
  if (server_) server_->Stop();
}
```

::: warning
`Deinit()` 在事件循环停止**之前**调用。这对 WebSocket 关闭握手至关重要 — 它需要事件循环来收发关闭帧。
:::

## 运行示例

```bash
# 在 xtils_app 目录下
cmake -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build

# 终端 1：启动服务器
./build/server/robot_server ./server/web 9000

# 终端 2：启动机器人客户端
./build/client/robot_client 127.0.0.1:9000

# 浏览器：打开 http://localhost:9000
```

## 关键设计模式

### 1. FSM + BT 关注点分离

| 层 | 职责 | 示例 |
|----|------|------|
| FSM | 模式转换，高层决策 | "低电量 → 去充电" |
| BT | 模式内的执行逻辑 | "导航到充电站 → 充电到满" |
| 黑板 | 层间共享状态 | `robot_state`、`map`、传感器数据 |

### 2. 事件驱动架构

- 浏览器发送命令 → 服务器 → 机器人（通过 WebSocket）
- 机器人上报状态 → 服务器 → 所有浏览器（广播）
- FSM 事件触发模式切换 → 行为树切换
- BT 完成触发 FSM 事件 → 模式转换

### 3. 优雅降级

- WebSocket 自动重连（3 秒延迟）
- A* 兜底：不可达格子标记为已清扫
- 卡住恢复：后退 + 随机转向
- 电量管理：20% 时自动返回充电

### 4. 运行时可配置

- 地图从 JSON 加载（运行时可编辑）
- 行为树从 JSON 文件加载（无需重新编译即可替换）
- 清扫模式运行时可选
- 定点清扫参数可按次配置

## 源代码

完整源代码可在 [`xtils_app`](https://github.com/lingzolabs/xtils) 的应用示例中找到。
