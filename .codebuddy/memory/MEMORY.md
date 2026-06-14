# 项目记忆

## 项目概况
- 知嘛健康零号店 - 活动管理微信小程序
- 云开发环境 ID: `cloud1-6gxw5t089a5cfdce`
- 当前状态：体验版 (`miniprogramState: 'trial'`)，ICP 备案已通过

## 关键技术决策

### 凭证预览
- 体验版中非开发者无法通过客户端 SDK 获取云存储临时链接
- 解决方案：通过云函数 `getFileTempURL` action（管理员权限）代理获取 `tempFileURL`
- 云函数 `getFileTempURL` 降级链：云函数 → `wx.cloud.downloadFile` → 失败提示

### 通知系统
- 订阅消息模板（3个）：
  - `XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70` — 定时提醒（thing24项目名称, thing12任务名称, thing10地点, name3责任人, time27开始时间）
  - `gw8f84WumXoZkBDaMErZ7YVDTna9P8jwosJf0bURSSg` — 清洁任务提醒（time3提醒时间, thing1清洁地址, thing2清洁内容）
  - `vRCdbLk5V3L1OpnyPm7M5oOUWIBJIZh7jnNi6SFRfwA` — 活动状态变更通知（time4开始时间, thing1活动名称, thing2活动描述, phrase3活动状态, thing7联系人）
- 通知系统已重构为事件驱动模式：create/update 活动时预生成通知任务 (`_type: 'scheduled_msg'`)，定时器每小时仅查询到期任务
- 部门主管查找：交集逻辑 = 部门成员 ∩ 部门主管权限组
- 权限组管理限制：部门主管只能调整自己所属权限组的成员
- 全局规则存储在 `activities` 集合的 `_system_global_rules` 文档中
- 用户通知开关通过 `users` 集合的 `notifyEnabled` 字段控制

### 接待上限
- 上限标记存储在 `activities` 集合，使用 `_limit_YYYY-MM-DD` 前缀的文档 ID

### 代码约定
- 云函数 action 分发模式（`switch(event.action)`）
- 服务层封装在 `services/` 目录
- 系统文档过滤：`_system_` 和 `_limit_` 前缀在列表查询中过滤
