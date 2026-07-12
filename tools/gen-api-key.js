// tools/gen-api-key.js
// 生成 API 访问密钥，运行：node tools/gen-api-key.js
const crypto = require('crypto');
const key = crypto.randomBytes(32).toString('hex');
console.log('API_KEY=' + key);
console.log('');
console.log('将此密钥设置到云函数 api 的环境变量中（见 API.md 部署步骤）。');
console.log('外部调用方请求头格式：Authorization: Bearer ' + key);
