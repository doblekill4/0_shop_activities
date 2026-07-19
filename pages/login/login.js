// pages/login/login.js - 微信风格授权登录 + 群入口自动识别
const { login, getCurrentUser } = require('../../utils/auth');
const app = getApp();

Page({
  data: {
    step: 'auth',       // 'auth' | 'profile'
    loading: false,
    reviewLoading: false,
    reviewMode: false,  // 审核模式快捷入口
    agreed: false,      // 隐私政策勾选
    saving: false,
    isEmployee: false,
    fromGroup: false,
    avatarUrl: '',
    nickname: '',
    name: '',
    employeeId: '',
    department: '',
    departmentIndex: -1,
    departmentList: [],
    departmentNames: [],
  },

  onLoad() {
    wx.removeStorageSync('_loggingOut');
    // 等 app.js autoLogin 完成后再判断
    this._waitForLoginReady();
  },

  _waitForLoginReady() {
    if (app.globalData.loginReady) {
      const user = getCurrentUser();
      if (user) {
        wx.switchTab({ url: '/pages/activity-list/activity-list' });
        return;
      }
      this._loadDepartments();
      this._checkGroupEntry();
      this._checkReviewMode();
    } else {
      setTimeout(() => this._waitForLoginReady(), 100);
    }
  },

  // 检测审核模式
  async _checkReviewMode() {
    try {
      const env = (wx.getAccountInfoSync ? wx.getAccountInfoSync() : {}) || {};
      const miniprogramEnv = (env.miniProgram || {}).envVersion || '';
      const res = await wx.cloud.callFunction({ name: 'auth', data: { action: 'checkReviewMode', miniprogramEnv } });
      const data = (res.result || {}).data || {};
      if (data.reviewMode) {
        wx.setStorageSync('reviewMode', true);
        this.setData({ reviewMode: true });
      }
    } catch (e) { /* 忽略 */ }
  },

  // ===== 获取部门列表 =====
  async _loadDepartments() {
    try {
      // 尝试从云函数获取部门列表
      const res = await wx.cloud.callFunction({
        name: 'auth',
        data: { action: 'listDepartments' },
      });
      if (res.result && res.result.code === 0 && Array.isArray(res.result.data)) {
        const names = res.result.data.map(d => d.name || '');
        this.setData({
          departmentList: res.result.data,
          departmentNames: names,
        });
        return;
      }
    } catch (e) {
      console.warn('[_loadDepartments] 获取部门失败，使用默认列表', e);
    }
    // 默认部门列表
    const defaults = ['运营部', '销售部', '管理部', '外部客户'];
    this.setData({
      departmentList: defaults.map(n => ({ name: n })),
      departmentNames: defaults,
    });
  },

  // ===== 检测群入口 =====
  _checkGroupEntry() {
    try {
      // 先用 scene 判断是否从群聊进入（scene 1044=群聊会话）
      const options = wx.getEnterOptionsSync ? wx.getEnterOptionsSync() : {};
      console.log('[login] enterOptions:', JSON.stringify(options));
      const fromGroupScene = options.scene === 1044 || options.scene === 1008; // 1044=群聊, 1008=群内卡片

      const groupInfo = wx.getGroupEnterInfo ? wx.getGroupEnterInfo() : null;
      console.log('[login] groupEnterInfo:', JSON.stringify(groupInfo));
      if (groupInfo && groupInfo.encryptedData) {
        this._groupEncryptedData = groupInfo.encryptedData;
        this._groupIv = groupInfo.iv;
        this.setData({ isEmployee: true, fromGroup: true });
        console.log('[login] 检测到群入口，加密数据已保存');
      } else if (fromGroupScene && groupInfo) {
        // 从群进入但无加密数据（可能体验版受限），先标记
        console.log('[login] 从群进入但无加密数据(scene=' + options.scene + ')，可能体验版限制');
      }
    } catch (e) {
      console.warn('[login] getGroupEnterInfo 失败', e);
    }
  },

  // ===== Step 0: 授权登录 =====
  async handleAuth() {
    if (this.data.loading) return;
    // 清理审核测试残留缓存
    if (wx.getStorageSync('userReview')) {
      wx.removeStorageSync('userInfo');
      wx.removeStorageSync('userReview');
    }
    this.setData({ loading: true });

    try {
      // 先查当前微信ID对应的账号，不直接登录
      const env2 = (wx.getAccountInfoSync ? wx.getAccountInfoSync() : {}) || {};
      const res = await wx.cloud.callFunction({ name: 'auth', data: { action: 'login', miniprogramEnv: (env2.miniProgram || {}).envVersion || '' } });
      const result = res.result || {};
      if (result.code === 0 && result.data && result.data.userInfo) {
        const user = result.data.userInfo;
        this.setData({ loading: false });
        wx.showModal({
          title: '确认登录',
          content: '当前微信账号关联：' + (user.name || '未知用户') + '\n\n是否继续登录？',
          confirmText: '继续登录',
          cancelText: '切换账号',
          success: (r) => {
            if (r.confirm) {
              // 确认 → 写入 Storage 并进入
              wx.setStorageSync('userInfo', user);
              getApp().globalData.isLoggedIn = true;
              getApp().globalData.userInfo = user;
              this._enterApp();
            } else {
              // 切换 → 清空缓存，走注册流程
              wx.removeStorageSync('userInfo');
              this.setData({ step: 'wechatInfo' });
            }
          },
        });
      } else if (result.code === 402) {
        this.setData({ step: 'wechatInfo' });
      } else {
        wx.showToast({ title: result.message || '登录失败', icon: 'none' });
      }
    } catch (err) {
      console.error('[handleAuth] 失败:', err);
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  // ===== Step 1: 完善信息 =====

  // 微信原生头像选择（open-type="chooseAvatar"）
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    if (avatarUrl) {
      this.setData({ avatarUrl });
    }
  },

  // Step 1.5: 微信资料获取完毕，进入姓名填写
  confirmWechatInfo() {
    if (!this.data.avatarUrl && !this.data.nickname) {
      wx.showToast({ title: '请点击获取微信头像和昵称', icon: 'none' });
      return;
    }
    this.setData({ step: 'profile' });
  },

  onNicknameInput(e) { this.setData({ nickname: e.detail.value }); },
  onNameInput(e)    { this.setData({ name: e.detail.value }); },
  onEmployeeIdInput(e) { this.setData({ employeeId: e.detail.value }); },

  // 部门选择器
  onDepartmentChange(e) {
    const idx = e.detail.value;
    const dept = this.data.departmentNames[idx];
    this.setData({ departmentIndex: idx, department: dept || '' });
  },

  async saveProfile() {
    const { nickname, name, employeeId, department, avatarUrl, isEmployee } = this.data;

    if (!name.trim()) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    if (!department) {
      wx.showToast({ title: '请选择部门', icon: 'none' });
      return;
    }
    if (isEmployee && !employeeId.trim()) {
      wx.showToast({ title: '员工请填写工号', icon: 'none' });
      return;
    }
    if (this.data.saving) return;
    this.setData({ saving: true });

    try {
      // 上传头像
      let finalAvatarUrl = '';
      if (avatarUrl && (avatarUrl.startsWith('wxfile://') || avatarUrl.startsWith('http://tmp'))) {
        try {
          const cloudPath = `avatars/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
          const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: avatarUrl });
          finalAvatarUrl = uploadRes.fileID;
        } catch (e) {
          console.warn('头像上传失败', e);
        }
      }

      const enterOptions = wx.getEnterOptionsSync ? wx.getEnterOptionsSync() : {};

      // 注册前刷新登录态，确保 session_key 有效，避免 cloud.openData 群解密失败
      await new Promise((resolve) => wx.login({ success: resolve, fail: resolve }));

      await login({
        name: name.trim(),
        nickname: nickname.trim() || name.trim(),
        employeeId: employeeId.trim(),
        department: department,
        avatarUrl: finalAvatarUrl,
        fromGroup: isEmployee || enterOptions.scene === 1044,
        groupEncryptedData: this._groupEncryptedData || '',
        scene: enterOptions.scene || 0,
        groupIv: this._groupIv || '',
      });

      this._enterApp();
    } catch (err) {
      console.error('[saveProfile] 注册失败:', err);
      wx.showToast({ title: '注册失败，请重试', icon: 'none' });
    }
    this.setData({ saving: false });
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  openPrivacy() {
    wx.openPrivacyContract ? wx.openPrivacyContract() : wx.showToast({ title: '隐私政策功能暂不可用', icon: 'none' });
  },

  _enterApp() {
    wx.switchTab({ url: '/pages/activity-list/activity-list' });
  },

  // 审核快捷登录（独立通道，不经过 utils/auth.js 的 login，不写 Storage）
  async reviewQuickLogin() {
    if (this.data.reviewLoading) return;
    this.setData({ reviewLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'auth',
        data: { action: 'reviewLogin' },
      });
      const result = res.result || {};
      if (result.code !== 0) {
        throw new Error(result.message || '登录失败');
      }
      const user = result.data.userInfo;
      if (!user) throw new Error('获取用户信息失败');
      // 仅写内存 + globalData，不写 Storage → 不污染正常登录的缓存态
      app.globalData.isLoggedIn = true;
      app.globalData.userInfo = user;
      // 但页面导航时 getCurrentUser 会读 Storage，最小化写入仅含关键字段
      wx.setStorageSync('userReview', true);
      wx.setStorageSync('userInfo', user);
      this._enterApp();
    } catch (e) {
      wx.showToast({ title: '登录失败：' + (e.message || '请重试'), icon: 'none', duration: 3000 });
    }
    this.setData({ reviewLoading: false });
  },
});
