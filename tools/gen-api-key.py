# tools/gen-api-key.py
# 生成 API 访问密钥，运行：python tools/gen-api-key.py
import secrets
key = secrets.token_hex(32)
print('API_KEY=' + key)
print()
print('将此密钥设置到云函数 api 的环境变量中（见 API.md 部署步骤）。')
print('外部调用方请求头格式：Authorization: Bearer ' + key)
