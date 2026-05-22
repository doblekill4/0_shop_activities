// pages/profile/profile.js
const { getCurrentUser, hasPermission, isAdmin: checkAdmin, logout } = require('../../utils/auth');

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
};

Page({
  data: {
    userInfo: {},
    permList: [],
    isAdmin: false,
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
    // 管理员功能菜单权限标志（细粒度控制显隐）
    const permFlags = {
      manageUsers:       admin || hasPermission('manage_users'),
      manageDepartments: admin || hasPermission('manage_departments'),
      exportData:        admin || hasPermission('export_data'),
      sendNotification:  admin || hasPermission('send_notification'),
    };
    this.setData({
      userInfo: {
        ...user,
        roleLabel: admin ? '管理员' : '普通成员',
      },
      permList: permList.filter(p => p.has), // 只显示拥有的权限
      isAdmin: admin,
      permFlags,
    });
  },

  goPermissions() {
    wx.navigateTo({ url: '/pages/admin/permissions/permissions' });
  },

  goDepartments() {
    wx.navigateTo({ url: '/pages/admin/departments/departments' });
  },

  goExport() {
    wx.navigateTo({ url: '/subpackages/admin/pages/export/export' });
  },

  goNotificationConfig() {
    wx.navigateTo({ url: '/subpackages/admin/pages/notification-config/notification-config' });
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
