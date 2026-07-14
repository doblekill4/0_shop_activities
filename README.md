# 知嘛健康零号店 - 活动管理微信小程序

门店活动预订与流程管理，支持粘贴识别、负责人指派、环节通知、甘特图、数据导出。

## 技术栈

- 微信小程序 + 云开发（云函数 + 文档数据库）
- 订阅消息通知（3 个模板）

## 快速开始

1. 微信开发者工具打开项目根目录
2. 填入 AppID `wx48dc1d4e69e6c3aa`
3. 云开发环境选择 `cloud1-6gxw5t089a5cfdce`
4. 编译运行

## 部署云函数

需上传并在云端安装依赖的云函数：
- `auth` — 登录/注册/权限
- `activities` — 活动 CRUD/甘特图/凭证
- `notifications` — 订阅消息发送/定时调度
- `process` — 环节确认/撤销
- `admin` — 用户/部门/权限组管理
- `api` — 外部 HTTP 接口（需配环境变量 API_KEY）

## 外部 API

详见 [API.md](./API.md)

## 目录结构

```
components/        # 公共组件（notify-overlay, register-dialog）
behaviors/         # 共享行为（formBase, stepEditor）
services/          # 服务层
utils/             # 工具函数（auth, constants, format, request）
cloudfunctions/    # 云函数
pages/             # 页面
subpackages/       # 分包（admin 导出/用户管理）
tools/             # 工具脚本（gen-api-key.py）
```

## 版本发布

1. `app.js` → 修改 `appVersion`
2. 提交代码并上传体验版
3. 部署有变更的云函数
4. 微信后台 → 版本管理 → 提交审核
5. 审核通过后发布正式版
6. **正式版发布后，必须配置 `notifications` 云函数环境变量**（见下方👇）

### 发布后关键配置

审核期间通知跳转体验版，发布后必须改为正式版，否则用户收通知点不进来：

```
云开发控制台 → 云函数 → notifications → 版本与配置 → 环境变量
添加：
  变量名：MINIPROGRAM_STATE
  变量值：formal
保存即生效，无需重新上传云函数。
```

默认值为 `trial`，不设环境变量时自动回退体验版。
