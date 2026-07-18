# 项目记忆

## 项目概况
- 知嘛健康零号店 - 活动管理微信小程序
- 云开发环境 ID: `cloud1-6gxw5t089a5cfdce`
- ICP 备案已通过
- 微信 AppID: `wx48dc1d4e69e6c3aa`
- 当前版本: `1.0.3`（`app.js` 的 `appVersion` 统一管理）

## ⚠️ 发布后必做
正式版发布后，在云开发控制台 → `notifications` 云函数 → 环境变量添加：
```
MINIPROGRAM_STATE = formal
```
默认 `trial`（体验版）。不设此变量通知用户点了跳不过来。

## 共享模块架构（防止 create/edit 同步遗漏）
- `utils/constants.js` — VENUE_LIST, VENUE_ALIASES, matchStepVenue, SUBSCRIBE_TMPL_IDS
- `behaviors/formBase.js` — 表单基础方法（onInput/onDateChange/onClientInput/toggleNeed/setSachet）+ 自定义时间选择器
- `behaviors/stepEditor.js` — 步骤增删改 + 负责人双列选择 + 地点选择 + _buildDeptUserPicker
- create/edit 页面通过 `behaviors: [...]` 引用，各自仅保留差异化逻辑（parseInfo/日历/提审 vs onLoad/修订/保存）

## 地点系统
- `VENUE_LIST`: 零号店1-3层, 零号店正门, 吧台后方书吧, 战略报告厅, 四层DIY区, 五层会议室二, 员工餐厅 …（共22个+1个"其他"）
- 别名映射 `VENUE_ALIASES`: 食堂→员工餐厅, 售药机→零号店正门, 开放式报告厅→三层LED区, 四层→四层DIY区 …（23组）
- 匹配策略: 别名精确命中 → 子串包含 → 2字bigram重叠度≥4分阈值
- 粘贴识别 `parseInfo()` 自动预填 venue/venueIndex
- 新建步骤默认 `venueIndex: 0`（零号店1-3层）

## 通知系统
- 订阅消息模板（3个）:
  - `XrO2RLN7...` — 定时提醒（thing24/thing12/thing10/name3/time27, 字段限制20/10字）
  - `gw8f84Wu...` — 清洁任务提醒（仅保洁部门申请）
  - `vRCdbLk5...` — 活动状态变更通知（time4必须HH:mm格式!）
- 事件驱动模式: create/update → scheduleForActivity 预生成任务，定时器每小时扫描
- `sendRobust()`: 三模板接力（43101时自动切），配合前端每次onShow弹授权补充额度
- 43101 根因: 版本更新后旧授权失效（非额度用完）。浮层检测 `notifyAuthVersion !== appVersion`
- 部门主管查找: 部门成员 ∩ 部门主管权限组
- 用户通知开关: `users.notifyEnabled`, 关闭时同步写 globalData + Storage + 云数据库
- 编码陷阱: `padStart`/`findIndex` 在行为文件中会触发 babel 压缩 OOM，一律改为 ES5 手写

## 凭证预览
- 体验版非开发者无法通过客户端 SDK 获取云存储临时链接
- 方案: 云函数 `getFileTempURL` 代理获取 → 内存缓存1.5h
- 返回值兼容: `Array.isArray(res) ? res : res.data`（callCloudFunc 会剥 code/data）

## 负责人选择器
- 双列: [部门, 人员]，人员末尾固定"待分配"（`__pending__`）
- 当前用户部门排最前（拼音排序，店长末尾）
- 切换部门时人员默认跳到"待分配"
- ownerDeptValue 索引计算: `this._pendingIdx` 存真实索引，避免 [0,-1] 空白

## 甘特图
- 场地使用区: 简洁卡片列表（绿头白底），非时间轴对齐
- 整体垂直滚动: `gantt-main-scroll` 包裹 body + 图例 + 场地

## 导出
- 步骤行格式: `1.09:00-09:30 参观品鉴 地点:零号店1-3层`
- 不带表情，不带"按照活动模板填写"首行

## 构建/部署提示
- `minified: true` 代码质量检查必须开启
- 修改云函数需重新上传（notifications 最频繁）
- 部署新版时改 `app.js` 的 `appVersion`，浮层和profile自动同步
- 开发者工具 OOM 时清理 `%LOCALAPPDATA%\微信web开发者工具` 缓存
- `project.config.json` 确认 `es6: true, enhance: true`
