// tools/upload.js - 通过 miniprogram-ci 上传体验版（不依赖开发者工具）
// 用法: node tools/upload.js "更新描述"
// 全局模块路径
if (!process.env.NODE_PATH) {
  process.env.NODE_PATH = require('os').homedir() + '\\AppData\\Roaming\\npm\\node_modules';
  require('module').Module._initPaths();
}
const { readFileSync, existsSync } = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const desc = process.argv[2] || 'CodeBuddy 自动上传';
const ci = require('miniprogram-ci');
const IProject = ci.Project;

const appJs = readFileSync(path.resolve(root, 'app.js'), 'utf8');
const verMatch = appJs.match(/appVersion:\s*['"]([^'"]+)['"]/);
const version = verMatch ? verMatch[1] : '1.0.0';

const keyFile = path.resolve(root, 'private.wx48dc1d4e69e6c3aa.key');
if (!existsSync(keyFile)) {
  console.error('❌ 缺少上传密钥: private.wx48dc1d4e69e6c3aa.key');
  process.exit(1);
}

console.log(`📦 上传: 零号备忘 v${version}`);
console.log(`📝 描述: ${desc}`);

const project = new IProject({
  appid: 'wx48dc1d4e69e6c3aa',
  type: 'miniProgram',
  projectPath: root,
  privateKeyPath: keyFile,
  ignores: ['node_modules/**/*'],
});

ci.upload({
  project,
  version,
  desc,
  robot: 1,
  setting: { es6: true, minify: true, autoPrefixWXSS: true },
}).then(() => {
  console.log('✅ 上传成功！请到微信后台提交审核。');
}).catch((e) => {
  console.error('❌ 上传失败:', e.message);
  process.exit(1);
});
