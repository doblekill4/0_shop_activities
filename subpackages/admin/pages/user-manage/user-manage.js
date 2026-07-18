// subpackages/admin/pages/user-manage/user-manage.js
const { isAdmin } = require('../../../../utils/auth');

Page({
  data: { users: [] },

  onShow() {
    if (!isAdmin()) { wx.navigateBack(); return; }
    wx.showLoading({ title: '加载中...' });
    this.loadUsers();
  },

  async loadUsers() {
    try {
      const res = await wx.cloud.callFunction({ name: 'auth', data: { action: 'listUsers' } });
      const list = (res.result && res.result.data) || [];
      this.setData({ users: list });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    wx.hideLoading();
  },

  toggleStatus(e) {
    const id = e.currentTarget.dataset.id;
    const currentStatus = e.currentTarget.dataset.status || '';
    const newStatus = currentStatus === 'inactive' ? 'active' : 'inactive';
    const actionLabel = newStatus === 'inactive' ? '标记离职' : '恢复在职';
    wx.showModal({
      title: actionLabel,
      content: `确定${actionLabel}该员工？`,
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中...' });
        try {
          const r = await wx.cloud.callFunction({
            name: 'auth',
            data: { action: 'setUserStatus', userId: id, status: newStatus },
          });
          const msg = (r.result && r.result.message) || '操作完成';
          wx.showToast({ title: msg, icon: 'success' });
          this.loadUsers();
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      },
    });
  },
});
