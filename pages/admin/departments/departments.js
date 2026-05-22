// pages/admin/departments/departments.js
const { getDepartments, createDepartment, updateDepartment, deleteDepartment, getUsers } = require('../../../services/admin');

Page({
  data: {
    departments: [],
    allUsers: [],
  },

  async onLoad() {
    wx.setNavigationBarTitle({ title: '部门群组管理' });
    const [deptRes, userRes] = await Promise.all([getDepartments(), getUsers()]);
    // 兼容 mock(直接返回数组) 和云函数(返回 { data } ) 两种格式
    const departments = (Array.isArray(deptRes) ? deptRes : ((deptRes && deptRes.data) || [])).map(d => ({
      ...d,
      id: d._id,  // 映射 _id → id，供 wxml data-id 使用
    }));
    const allUsers = Array.isArray(userRes) ? userRes : ((userRes && userRes.data) || []);
    this.setData({ departments, allUsers });
  },

  addDept() {
    wx.showModal({
      title: '新建部门群组',
      editable: true,
      placeholderText: '请输入部门名称',
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        try {
          await createDepartment({ name: res.content, members: [] });
          const raw = await getDepartments();
          const departments = Array.isArray(raw) ? raw : ((raw && raw.data) || []);
          this.setData({ departments });
        } catch (e) {
          wx.showToast({ title: '创建失败', icon: 'none' });
        }
      },
    });
  },

  editDept(e) {
    const id = e.currentTarget.dataset.id;
    const dept = this.data.departments.find(d => d.id === id);
    if (!dept) return;
    const allUsers = this.data.allUsers;
    const memberIds = new Set((dept.members || []).map(m => m.userId));

    // 展示成员选择（实际项目可用自定义 picker 组件）
    const items = allUsers.map(u => `${u.name}（${memberIds.has(u.userId) ? '已在组' : '未加入'}）`);
        wx.showActionSheet({
          itemList: items,
          success: async (res) => {
        const user = allUsers[res.tapIndex];
        if (!user) return;
        const newMembers = memberIds.has(user.userId)
          ? dept.members.filter(m => m.userId !== user.userId)
          : [...(dept.members || []), { userId: user.userId, name: user.name }];
        try {
          await updateDepartment(id, { members: newMembers });
          const raw = await getDepartments();
          const departments = (Array.isArray(raw) ? raw : ((raw && raw.data) || [])).map(d => ({ ...d, id: d._id }));
          this.setData({ departments });
        } catch (e) {
          wx.showToast({ title: '更新失败', icon: 'none' });
        }
      },
    });
  },

  addMember(e) {
    this.editDept(e);
  },

  deleteDept(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除部门群组',
      content: '确认删除此群组？成员不受影响。',
      confirmColor: '#D32F2F',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await deleteDepartment(id);
          const raw = await getDepartments();
          const departments = Array.isArray(raw) ? raw : ((raw && raw.data) || []);
          this.setData({ departments });
        } catch (e) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },
});
