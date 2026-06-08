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

  toggleNotify(e) {
    const enabled = e.detail.value;
    this.setData({ notifyEnabled: enabled });
    // 同步到数据库，云函数发通知前会检查
    wx.cloud.callFunction({
      name: 'auth',
      data: { action: 'setNotifyEnabled', enabled },
    }).catch(() => {});
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
            const msg = result.result ? result.result.message : '操作完成';
            wx.showToast({ title: msg, icon: 'success', duration: 2000 });
          },
          fail: (err) => {
            wx.hideLoading();
            wx.showToast({ title: '重置失败：' + (err.errMsg || '未知错误'), icon: 'none' });
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
