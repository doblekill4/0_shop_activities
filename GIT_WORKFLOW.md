# Git 工作流规范

> 适用项目：微信小程序活动管理平台
> 目的：让 AI 修改代码前先保存快照，改错能一键回退

---

## 核心原则

**每次 AI 修改文件之前，必须先 commit 当前状态（改前快照）**
**每次完成一个独立功能/修复后，再 commit（改后说明）**

---

## 标准工作流

### 第一步：改前快照

```bash
# 查看当前状态
git status

# 如有未提交改动，先提交
git add .
git commit -m "改前快照：<简短说明当前状态>"
```

### 第二步：执行修改

AI 执行代码修改（Read / Edit / Write 工具）

### 第三步：改后 commit

```bash
git add <修改的文件>
git commit -m "feat/fix: <具体改动说明>"
```

commit 信息规范：
- `feat: <新功能说明>` — 新功能
- `fix: <修复的问题>` — Bug 修复
- `refactor: <重构说明>` — 代码重构
- `docs: <文档更新>` — 文档更新

---

## 查看改动历史

```bash
# 查看完整 commit 历史
git log --oneline

# 查看某次 commit 的改动详情
git show <commit-hash>

# 查看某个文件的改动历史
git log -p <file-path>

# 查看工作区与最新 commit 的差异
git diff

# 查看已暂存（staged）的差异
git diff --cached
```

---

## 回退方法

### 方法一：回退单个文件到某个版本

```bash
# 查看文件的历史版本
git log --oneline -- <file-path>

# 回退单个文件到某个 commit
git checkout <commit-hash> -- <file-path>
```

### 方法二：回退整个项目到某个版本（临时查看）

```bash
# 回退到某个 commit（会进入 detached HEAD 状态）
git checkout <commit-hash>

# 回到最新版本
git checkout master
```

### 方法三：撤销某次 commit（保留文件改动）

```bash
# 撤销最近一次 commit，保留改动在工作区
git reset --soft HEAD~1

# 撤销最近一次 commit，不保留改动
git reset --hard HEAD~1
```

### 方法四：用 revert 创建"反向 commit"（推荐，安全）

```bash
# 创建一个新 commit，抵消某次 commit 的改动
git revert <commit-hash>
```

---

## 分支策略（可选）

当前纯本地开发，不使用分支。如需实验性修改：

```bash
# 创建实验分支
git checkout -b experiment

# 实验成功后合并回 master
git checkout master
git merge experiment

# 实验失败，丢弃分支
git checkout master
git branch -D experiment
```

---

## 禁止推送到远程

本项目纯本地版本管理，**不执行** `git push`。

远程仓库（如 GitHub、Gitee）按需手动配置。

---

## AI 行为规范（写给 AI 看）

1. **每次修改文件前**，先执行 `git status`，如有未提交改动先 commit
2. **修改完成后**，必须执行 `git add + commit`，写明改动说明
3. **如果用户要求"改回去/回退"**，用 `git log --oneline` 找到目标版本，用 `git checkout <hash> -- <file>` 或 `git revert` 执行
4. **不要** 用 `git reset --hard` 除非用户明确要求
5. **不要** 执行 `git push`
