// app.js - 知嘛健康零号号店活动预定小程序（云开发版）
const { initStore } = require('./stores/index');
const { autoLogin } = require('./utils/auth');

App({
  async onLaunch(options) {
    console.log('[App] onLaunch', options);

    // 初始化腾讯云开发环境
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或更高版本的开发者工具');
    } else {
      wx.cloud.init({
        env: 'cloud1-6gxw5t089a5cfdce',  // 您的环境 ID
        traceUser: true,
      });
      console.log('[App] 云开发初始化完成');
    }

    // 初始化本地存储结构
    this.initLocalStorage();
    // 初始化全局状态
    initStore();
    // 自动登录（加超时保护，避免云函数超时阻塞启动）
    this._doAutoLogin();
  },

  onShow(options) {
    console.log('[App] onShow', options);
  },

  onHide() {
    console.log('[App] onHide');
  },

  onError(msg) {
    console.error('[App] Error:', msg);
  },

  // 初始化本地存储默认结构
  initLocalStorage() {
    if (!wx.getStorageSync('draft_activities')) {
      wx.setStorageSync('draft_activities', []);
    }
  },

  // 自动登录（带超时保护，避免阻塞启动）
  _doAutoLogin() {
    const self = this;
    let finished = false;

    // 超时保护：5 秒后强制结束，避免永远卡在启动页
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        console.warn('[App] autoLogin 超时，检查本地缓存');
        // 从本地缓存恢复（防止页面反复横跳）
        const cached = wx.getStorageSync('userInfo');
        if (cached) {
          self.globalData.isLoggedIn = true;
          self.globalData.userInfo = cached;
          console.log('[App] autoLogin 超时，从缓存恢复用户:', cached.name);
        }
        self.globalData.loginReady = true;
      }
    }, 5000);

    const { autoLogin } = require('./utils/auth');
    // 收集群入口信息（用于设定门店群白名单）
    const groupInfo = wx.getGroupEnterInfo ? wx.getGroupEnterInfo() : null;
    const groupParams = (groupInfo && groupInfo.encryptedData) ? {
      groupEncryptedData: groupInfo.encryptedData,
      groupIv: groupInfo.iv,
    } : {};
    autoLogin(groupParams).then(user => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (user) {
        self.globalData.isLoggedIn = true;
        self.globalData.userInfo = user;
        // 审核模式下关闭通知弹窗（存 result.reviewMode）
        console.log('[App] autoLogin 成功：', user.name);
      } else {
        console.log('[App] autoLogin：未登录，需要手动登录');
      }
      self.globalData.loginReady = true;
    }).catch(err => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      console.warn('[App] autoLogin 失败（非致命）：', err);
      self.globalData.loginReady = true;
    });
  },

  globalData: {
    isLoggedIn: false,
    userInfo: null,     // { _id, name, department, permissions[], role }
    loginReady: false,  // 登录检测是否完成
    // role: 'admin' | 'manager' | 'user'
    appVersion: '1.0.4',
    // 权限标识
    PERMISSIONS: {
      CREATE_ACTIVITY: 'create_activity',
      EDIT_ACTIVITY: 'edit_activity',
      DELETE_ACTIVITY: 'delete_activity',
      UPLOAD_VOUCHER: 'upload_voucher',
      MANAGE_USERS: 'manage_users',
      MANAGE_DEPARTMENTS: 'manage_departments',
      VIEW_ALL_REVISIONS: 'view_all_revisions',
      EXPORT_DATA: 'export_data',
      SEND_NOTIFICATION: 'send_notification',
      ASSIGN_PROCESS_OWNER: 'assign_process_owner',
      SET_CAPACITY_LIMIT: 'set_capacity_limit',
    },
  },
});
