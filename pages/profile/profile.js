// pages/profile/profile.js
const { getCurrentUser, hasPermission, isAdmin: checkAdmin, logout } = require('../../utils/auth');
const { markCapacityLimit } = require('../../services/activity');

const PERM_LABELS = {
  create_activity:    '新建活动',
  edit_activity:      '编辑活动',
  delete_activity:    '删除活动',
  upload_voucher:     '上传凭证',
  manage_users:       '管理用户',
  manage_departments: '管理部门',
  view_all_revisions: '查看修订',
  export_data:        '导出数据',
  send_notification:  '发送通知',
  assign_process_owner: '指派负责人',
  set_capacity_limit: '接待上限更改',
};

Page({
  data: {
    userInfo: {},
    permList: [],
    isAdmin: false,
    notifyEnabled: true,
    capacityDate: '',
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.loginReady) return;
    const user = getCurrentUser();
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    const admin = checkAdmin();
    const permList = Object.entries(PERM_LABELS).map(([key, label]) => ({
      key,
      label,
      has: admin || hasPermission(key),
    }));
    const permFlags = {
      manageUsers:       admin || hasPermission('manage_users'),
      manageDepartments: admin || hasPermission('manage_departments'),
      exportData:        admin || hasPermission('export_data'),
      sendNotification:  admin || hasPermission('send_notification'),
      capacityLimit:     admin || hasPermission('set_capacity_limit'),
    };
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    this.setData({
      userInfo: {
        ...user,
        roleLabel: admin ? '管理员' : '普通成员',
      },
      permList: permList.filter(p => p.has),
      isAdmin: admin,
      permFlags,
      notifyEnabled: user.notifyEnabled !== false,
      capacityDate: todayStr,
    });
  },

  toggleNotify() {
    const currentlyEnabled = this.data.notifyEnabled;
    if (currentlyEnabled) {
      // 关闭通知
      this.setData({ notifyEnabled: false });
      wx.cloud.callFunction({
        name: 'auth',
        data: { action: 'setNotifyEnabled', enabled: false },
      }).catch(() => {});
    } else {
      // 打开通知：先弹授权（必须由 tap 事件触发）
      wx.requestSubscribeMessage({
        tmplIds: [
          'XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70',            // 定时提醒
          'gw8f84WumXoZkBDaMErZ7YVDTna9P8jwosJf0bURSSg',            // 清洁任务提醒
          'vRCdbLk5V3L1OpnyPm7M5oOUWIBJIZh7jnNi6SFRfwA',            // 活动状态变更通知
        ],
        success: (res) => {
          const accepted = res['XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70'] === 'accept';
          if (accepted) {
            this.setData({ notifyEnabled: true });
            wx.cloud.callFunction({
              name: 'auth',
              data: { action: 'setNotifyEnabled', enabled: true },
            }).catch(() => {});
            wx.showToast({ title: '已开启通知', icon: 'success' });
          } else {
            wx.showToast({ title: '需授权才能收到通知', icon: 'none' });
          }
        },
        fail: () => {
          wx.showToast({ title: '授权失败，请重试', icon: 'none' });
        },
      });
    }
  },

  goPermissions() {
    wx.navigateTo({ url: '/pages/admin/permission-groups/permission-groups' });
  },

  goDepartments() {
    wx.navigateTo({ url: '/pages/admin/departments/departments' });
  },

  goExport() {
    wx.navigateTo({ url: '/subpackages/admin/pages/export/export' });
  },

  // 通知测试（仅王万全可用）
  testNotify() {
    // 先请求订阅消息授权
    const allTmplIds = ['XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70', 'gw8f84WumXoZkBDaMErZ7YVDTna9P8jwosJf0bURSSg', 'vRCdbLk5V3L1OpnyPm7M5oOUWIBJIZh7jnNi6SFRfwA'];
    wx.requestSubscribeMessage({
      tmplIds: allTmplIds,
      success: (res) => {
        const accepted = res['XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70'] === 'accept';
        if (!accepted) {
          wx.showToast({ title: '需要授权订阅消息才能发送', icon: 'none' });
          return;
        }
        wx.showLoading({ title: '发送测试通知...' });
        wx.cloud.callFunction({
          name: 'notifications',
          data: { action: 'testSend' },
          success: (r) => {
            wx.hideLoading();
            const msg = (r.result && r.result.message) || '发送完成';
            wx.showToast({ title: msg, icon: 'success', duration: 2000 });
          },
          fail: (err) => {
            wx.hideLoading();
            wx.showToast({ title: '发送失败: ' + (err.errMsg || '未知'), icon: 'none', duration: 2500 });
          },
        });
      },
      fail: () => {
        wx.showToast({ title: '授权弹窗失败，请稍后重试', icon: 'none' });
      },
    });
  },

  goUserManage() {
    wx.navigateTo({ url: '/subpackages/admin/pages/user-manage/user-manage' });
  },

  resetStoreGroup() {
    wx.showModal({
      title: '重置门店群白名单',
      content: '重置后，下一次从群聊中点击小程序卡片的人所在的群将成为新的门店群。确定重置？',
      confirmColor: '#D32F2F',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '重置中...' });
        wx.cloud.callFunction({
          name: 'auth',
          data: { action: 'resetStoreGroup' },
          success: (result) => {
            wx.hideLoading();
            const r = result.result || {};
            const msg = r.code === 0 ? r.message : ('失败：' + (r.message || '未知'));
            wx.showToast({ title: msg, icon: r.code === 0 ? 'success' : 'none', duration: 2500 });
          },
          fail: (err) => {
            wx.hideLoading();
            wx.showToast({ title: '重置失败：' + (err.errMsg || '未知错误'), icon: 'none', duration: 3000 });
          },
        });
      },
    });
  },

  onShareAppMessage() {
    return {
      title: '知嘛健康零号店-活动管理',
      path: '/pages/activity-list/activity-list',
      imageUrl: '/assets/images/share-logo.png',
    };
  },

  goNotificationConfig() {
    wx.navigateTo({ url: '/subpackages/admin/pages/notification-config/notification-config' });
  },

  // 标记接待上限
  async onCapacityDatePick(e) {
    const dateStr = e.detail.value;
    const confirm = await this._showModalAsync('接待上限标记', `确定将 ${dateStr} 标记为接待上限？\n标记后当天其他人将无法提交新活动`);
    if (!confirm) return;
    this._doMarkLimit(dateStr, false);
  },

  // 取消接待上限
  async onCapacityDateUnmark(e) {
    const dateStr = e.detail.value;
    const confirm = await this._showModalAsync('取消上限标记', `确定取消 ${dateStr} 的接待上限标记？`, '#D32F2F');
    if (!confirm) return;
    this._doMarkLimit(dateStr, true);
  },

  _showModalAsync(title, content, confirmColor) {
    return new Promise(resolve => {
      wx.showModal({
        title, content, confirmText: '确定', confirmColor: confirmColor || '#2E7D32',
        success: r => resolve(r.confirm),
        fail: () => resolve(false),
      });
    });
  },

  async _doMarkLimit(dateStr, remove) {
    wx.showLoading({ title: remove ? '取消中...' : '标记中...' });
    try {
      // 用原生 callFunction 绕过 callCloudFunc 的自动 toast
      const res = await wx.cloud.callFunction({
        name: 'activities',
        data: { action: 'markCapacityLimit', date: dateStr, remove },
      });
      wx.hideLoading();
      if (res.result && res.result.code === 0) {
        wx.showToast({ title: remove ? '已取消标记' : '已标记', icon: 'success' });
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '操作失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      console.error('[profile] markCapacityLimit error', e);
    }
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出登录？',
      success: (res) => {
        if (res.confirm) logout();
      },
    });
  },
});
