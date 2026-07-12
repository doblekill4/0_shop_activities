# 外部 API 对接文档

## 一、概述

本接口提供指定日期的所有正式活动数据，供外部系统调用。采用 HTTPS + Bearer Token 鉴权，返回 JSON 格式。

---

## 二、部署步骤（项目方操作，一次性）

### 1. 生成密钥
```bash
cd 项目根目录
node tools/gen-api-key.js
```
输出示例：
```
API_KEY=a1b2c3d4e5f6...（64位十六进制串）
```

### 2. 设置环境变量
微信开发者工具 → 云开发控制台 → 点击「**云函数**」→ 找到 `api` → 点击「**版本与配置**」→「**环境变量**」→ 添加：
```
变量名：API_KEY
变量值：a1b2c3d4e5f6...（上一步生成的密钥）
```
点击保存。

### 3. 开启 HTTP 访问服务
云开发控制台 → 「**设置**」→「**HTTP 访问服务**」→ 点击「**开启**」。

记录生成的**访问域名**，格式类似：
```
https://cloud1-6gxw5t089a5cfdce.ap-shanghai.tcb-api.tencentcloudapi.com/api
```

### 4. 上传云函数
微信开发者工具 → 右键 `cloudfunctions/api` → 「**上传并部署：云端安装依赖**」

### 5. 将以下信息发给对接方
- **接口地址**：第 3 步记录的域名
- **API Key**：第 1 步生成的密钥
- 本文档

---

## 三、接口规范（对接方使用）

### 基本信息

| 项目 | 值 |
|---|---|
| 协议 | HTTPS |
| 方法 | POST |
| Content-Type | application/json |
| 鉴权 | Bearer Token |

### 请求

**URL**
```
POST https://<你的域名>/api
```

**Headers**
```
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

**Body（JSON）**
```json
{
  "action": "exportByDate",
  "date": "2026-07-12"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| action | string | 是 | 固定值 `exportByDate` |
| date | string | 是 | 活动日期，格式 `YYYY-MM-DD` |

### 响应

**成功（200）**
```json
{
  "code": 0,
  "date": "2026-07-12",
  "count": 3,
  "list": [
    {
      "activityUnit": "某某科技有限公司",
      "venue": "零号店",
      "arrivalTime": "08:30",
      "date": "2026年7月12日",
      "peopleCount": 20,
      "businessType": "参观品鉴、手作体验",
      "venueUsage": "零号店1-3层，五层会议室二",
      "steps": [
        {
          "name": "参观品鉴",
          "startTime": "09:00",
          "endTime": "09:30",
          "venue": "零号店1-3层",
          "ownerName": "张三"
        }
      ],
      "settlementMethod": "现场结算",
      "totalCost": "1200",
      "contactPerson": "李经理",
      "bookingPerson": "王万全",
      "clientInfo": {
        "ethnicity": "",
        "age": "",
        "dietaryRestrictions": "",
        "specialRequirements": ""
      },
      "venueNeeds": {
        "build": false,
        "rehearsal": false,
        "power": false,
        "mainVisual": false,
        "filming": false
      },
      "invoiceNeeds": "",
      "sachetAccount": "clinic"
    }
  ],
  "text": "时间：2026年7月12日 08:30\n活动单位：某某科技有限公司\n..."
}
```

| 字段 | 说明 |
|---|---|
| code | 0 = 成功 |
| count | 活动总数 |
| list | 结构化数组，可直接解析入库 |
| list[].steps | 环节列表（名称/时间/地点/负责人） |
| list[].sachetAccount | `clinic`=医馆账户 `shop`=零号店账户 `""`=未确认 |
| text | 纯文本格式（list 拼接后的可读文本，备用） |

**鉴权失败（403）**
```json
{ "code": 403, "message": "Forbidden: invalid token" }
```

**缺少参数（400）**
```json
{ "code": 400, "message": "date is required" }
```

---

## 四、对接方调用示例

### curl
```bash
curl -X POST https://你的域名/api \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"action":"exportByDate","date":"2026-07-12"}'
```

### Python
```python
import requests

res = requests.post(
    "https://你的域名/api",
    headers={
        "Authorization": "Bearer <API_KEY>",
        "Content-Type": "application/json"
    },
    json={"action": "exportByDate", "date": "2026-07-12"}
)
data = res.json()
for act in data["list"]:
    print(act["activityUnit"], act["arrivalTime"])
```

### JavaScript / Node.js
```js
const res = await fetch("https://你的域名/api", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <API_KEY>",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ action: "exportByDate", date: "2026-07-12" })
});
const data = await res.json();
console.log(data.count, "个活动");
```

---

## 五、接收方处理建议

1. **每天凌晨定时拉取当日活动**（如 cron `0 5 * * *`）
2. `list[].steps[].ownerName` 可提取为任务分配
3. `list[].sachetAccount` 决定香囊结算账户
4. `text` 字段可直接发送 IM/邮件，无需二次拼装
5. 返回的活动已过滤草稿，只包含 `pending/confirmed/completed/settled` 状态

---

## 六、故障排查

| 现象 | 排查 |
|---|---|
| 403 Forbidden | API_KEY 不匹配或未设置环境变量 |
| 404 Unknown action | body 中 action 字段拼写错误 |
| 500 服务异常 | 查看云函数日志（云开发控制台 → 云函数 → api → 日志） |
| 返回 0 条 | 当日确无活动，或活动状态为草稿（草稿不导出） |
| 调用未触发 | HTTP 访问服务未开启（见第二节步骤 3） |
