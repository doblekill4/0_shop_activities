// utils/auth.js - 微信登录与权限工具（云开发版 + 本地备用模式）
const { callCloudFunc } = require('./request');

// 获取当前小程序环境版本（develop/trial/release）
function getMiniEnv() {
  try {
    const info = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null;
    return (info && info.miniProgram && info.miniProgram.envVersion) || '';
  } catch (e) { return ''; }
}

// =====================================================
// 开关：设为 false 可切换为纯本地注册模式（不依赖云函数）
// 用于云函数未部署或调试阶段快速跑通流程
// =====================================================
const USE_CLOUD = true;

/**
 * 微信登录（云函数版 或 本地备用版）
 * @param {object} data - { name, department } 新用户需要填写
 */
const login = (data = {}) => {
  return new Promise((resolve, reject) => {
    // ---- 本地备用模式 ----
    if (!USE_CLOUD) {
      const isAdmin = data.name === '王万全';
      const mockUser = {
        _id: 'local_' + Date.now(),
        name: data.name || '测试用户',
        department: data.department || '未分配',
        permissions: isAdmin
          ? ['create_activity', 'edit_activity', 'delete_activity', 'upload_voucher', 'manage_users', 'manage_departments', 'view_all_revisions', 'export_data', 'send_notification', 'assign_process_owner', 'set_capacity_limit']
          : ['create_activity', 'edit_activity', 'upload_voucher'],
        role: isAdmin ? 'admin' : 'user',
      };
      wx.setStorageSync('userInfo', mockUser);
      const app = getApp();
      app.globalData.isLoggedIn = true;
      app.globalData.userInfo = mockUser;
      console.log('[auth.login] 本地模式注册成功', mockUser);
      resolve(mockUser);
      return;
    }

    // ---- 云函数模式 ----
    wx.cloud.callFunction({
      name: 'auth',
      data: {
        action: 'login',
        miniprogramEnv: getMiniEnv(),
        ...data,
      },
      success: (res) => {
        console.log('[auth.login] 云函数返回', res);
        const result = res.result;
        if (!result || result.code === 402) {
          // 402 = 新用户需要注册
          reject('需要注册');
          return;
        }
        if (result.code === 0) {
          const user = result.data.userInfo;
          wx.setStorageSync('userInfo', user);
          const app = getApp();
          app.globalData.isLoggedIn = true;
          app.globalData.userInfo = user;
          resolve(user);
          return;
        }
        // 其他错误
        const msg = result.message || '登录失败（云函数返回异常）';
        console.error('[auth.login] 业务错误', result);
        reject(msg);
      },
      fail: (err) => {
        console.error('[auth.login] 调用失败', err);
        if (err.errMsg && err.errMsg.includes('timeout')) {
          reject('云函数调用超时，请检查云函数是否已部署');
        } else {
          reject('网络错误：' + (err.errMsg || '未知错误'));
        }
      },
    });
  });
};

/**
 * 自动登录（检查是否已注册）
 */
const autoLogin = (extraData = {}) => {
  return new Promise((resolve, reject) => {
    // ---- 本地备用模式 ----
    if (!USE_CLOUD) {
      const localUser = wx.getStorageSync('userInfo');
      if (localUser) {
        const app = getApp();
        app.globalData.isLoggedIn = true;
        app.globalData.userInfo = localUser;
        resolve(localUser);
      } else {
        // 清除全部缓存后，自动创建默认管理员用户（方便开发调试）
        const defaultUser = {
          _id: 'local_default',
          name: '王万全',
          department: '管理部',
          permissions: [
            'create_activity', 'edit_activity', 'delete_activity',
            'upload_voucher', 'manage_users', 'manage_departments',
            'view_all_revisions', 'export_data', 'send_notification',
            'assign_process_owner',
            'set_capacity_limit',
          ],
          role: 'admin',
        };
        wx.setStorageSync('userInfo', defaultUser);
        const app = getApp();
        app.globalData.isLoggedIn = true;
        app.globalData.userInfo = defaultUser;
        console.log('[auth.autoLogin] 自动登录为默认管理员', defaultUser.name);
        resolve(defaultUser);
      }
      return;
    }

    // ---- 云函数模式 ----
    wx.cloud.callFunction({
      name: 'auth',
      data: { action: 'autoLogin', miniprogramEnv: getMiniEnv(), ...extraData },
      success: (res) => {
        console.log('[auth.autoLogin] 云函数返回', res);
        const result = res.result;
        if (result && result.code === 0) {
          const user = result.data.userInfo;
          wx.setStorageSync('userInfo', user);
          // 审核模式标记（云端状态覆盖 globalData + Storage）
          if (result.data.reviewMode) {
            wx.setStorageSync('reviewMode', true);
          } else {
            wx.removeStorageSync('reviewMode');
          }
          getApp().globalData._reviewMode = !!result.data.reviewMode;
          getApp().globalData.isLoggedIn = true;
          getApp().globalData.userInfo = user;
          resolve(user);
        } else {
          // 被清退时清除本地缓存
          if (result && (result.code === 401 || result.code === 403)) {
            wx.removeStorageSync('userInfo');
            wx.removeStorageSync('reviewMode');
          }
          resolve(null);
        }
      },
      fail: (err) => {
        console.error('[auth.autoLogin] 调用失败', err);
        resolve(null);
      },
    });
  });
};

/**
 * 获取当前登录用户信息（含权限列表）
 */
const getCurrentUser = () => {
  return wx.getStorageSync('userInfo') || null;
};

/**
 * 判断当前用户是否拥有某权限
 * @param {string} permission - 权限标识（如 'create_activity'）
 */
const hasPermission = (permission) => {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.role === 'admin') return true;  // admin 拥有所有权限
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
};

/**
 * 判断是否为管理员
 */
const isAdmin = () => {
  const user = getCurrentUser();
  return user && user.role === 'admin';
};

/**
 * 退出登录
 */
const logout = () => {
  wx.setStorageSync('_loggingOut', Date.now());
  wx.clearStorageSync();
  wx.setStorageSync('_loggingOut', Date.now());
  const app = getApp();
  app.globalData.isLoggedIn = false;
  app.globalData.userInfo = null;
  wx.reLaunch({ url: '/pages/login/login' });
};

module.exports = { login, autoLogin, getCurrentUser, hasPermission, isAdmin, logout };
