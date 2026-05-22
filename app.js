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
    // 不再自动登录：由登录页手动触发，避免云函数超时阻塞启动
    this.globalData.loginReady = true;
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

  globalData: {
    isLoggedIn: false,
    userInfo: null,     // { _id, name, department, permissions[], role }
    loginReady: false,  // 登录检测是否完成
    // role: 'admin' | 'manager' | 'user'
    appVersion: '1.0.0',
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
    },
  },
});
