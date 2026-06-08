// pages/admin/permissions/permissions.js
const { getPermissionGroups, createPermissionGroup, updatePermissionGroup, deletePermissionGroup } = require('../../../services/admin');

const ALL_PERMS = [
  { key: 'create_activity',    label: '新建活动' },
  { key: 'edit_activity',      label: '编辑活动' },
  { key: 'delete_activity',    label: '删除活动' },
  { key: 'upload_voucher',     label: '上传凭证' },
  { key: 'manage_users',       label: '管理用户' },
  { key: 'manage_departments', label: '管理部门' },
  { key: 'view_all_revisions', label: '查看修订' },
  { key: 'export_data',        label: '导出数据' },
  { key: 'send_notification',  label: '发送通知' },
  { key: 'assign_process_owner', label: '指派负责人' },
  { key: 'set_capacity_limit', label: '接待上限更改' },
];

Page({
  data: {
    groups: [],
    loading: false,
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '权限组管理' });
    this.loadGroups();
  },

  async loadGroups() {
    this.setData({ loading: true });
    try {
      const res = await getPermissionGroups();
      // 兼容 mock(直接返回数组) 和云函数(返回 { data } ) 两种格式
      const groupsData = Array.isArray(res) ? res : ((res && res.data) || []);
      const groups = groupsData.map(g => ({
        ...g,
        id: g._id,  // 映射 _id → id，供 wxml data-id 使用
        permissions: ALL_PERMS.map(p => ({
          ...p,
          enabled: (g.permissions || []).includes(p.key),
        })),
      }));
      this.setData({ groups });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  async togglePerm(e) {
    const { groupId, permKey } = e.currentTarget.dataset;
    const groups = this.data.groups.map(g => {
      if (g.id !== groupId) return g;
      const permissions = g.permissions.map(p =>
        p.key === permKey ? { ...p, enabled: !p.enabled } : p
      );
      return { ...g, permissions };
    });
    this.setData({ groups });

    // 保存
    const group = groups.find(g => g.id === groupId);
    try {
      await updatePermissionGroup(groupId, {
        permissions: group.permissions.filter(p => p.enabled).map(p => p.key),
      });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  addGroup() {
    wx.showModal({
      title: '新建权限组',
      editable: true,
      placeholderText: '请输入权限组名称',
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        try {
          await createPermissionGroup({ name: res.content, permissions: [] });
          this.loadGroups();
        } catch (e) {
          wx.showToast({ title: '创建失败', icon: 'none' });
        }
      },
    });
  },

  editGroup(e) {
    const id = e.currentTarget.dataset.id;
    const group = this.data.groups.find(g => g.id === id);
    wx.showModal({
      title: '编辑权限组名称',
      editable: true,
      content: group.name,
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        try {
          await updatePermissionGroup(id, { name: res.content });
          this.loadGroups();
        } catch (e) {
          wx.showToast({ title: '修改失败', icon: 'none' });
        }
      },
    });
  },

  deleteGroup(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除权限组',
      content: '确认删除该权限组？成员权限将被重置。',
      confirmColor: '#D32F2F',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await deletePermissionGroup(id);
          this.loadGroups();
        } catch (e) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },
});
