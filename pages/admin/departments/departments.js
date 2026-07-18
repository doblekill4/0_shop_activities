// pages/admin/departments/departments.js
const { getDepartments, createDepartment, updateDepartment, deleteDepartment, getUsers, getPermissionGroups } = require('../../../services/admin');

Page({
  data: {
    departments: [],
    allUsers: [],
    permGroups: [],
    permGroupNames: [],
    showMemberPicker: false,
    pickerDeptId: '',
    pickerDeptName: '',
    pickerUsers: [],
  },

  noop: function() {},

  _inited: false,

  async onLoad() {
    if (this._inited) return;
    this._inited = true;
    wx.setNavigationBarTitle({ title: "部门群组管理" });
    await this._initDepartments();
    this._reload();
  },

  _initDepartments: async function() {
    try {
      const res = await getDepartments();
      const depts = Array.isArray(res) ? res : ((res && res.data) || []);
      for (var i = 0; i < depts.length; i++) {
        var d = depts[i];
        if (d && d._id && (!d.name || typeof d.name !== 'string' || !d.name.trim())) {
          var fixName = '部门_' + d._id.substring(0, 8);
          console.log('[departments] 修复部门 name:', d._id, '→', fixName);
          try { await updateDepartment(d._id, { name: fixName }); } catch(e2) {}
        }
      }
    } catch (e) {
      console.warn('[departments] 初始化修复失败', e);
    }
  },

  async _reload() {
    wx.showLoading({ title: '加载中...' });
    try {
      var deptRes, userRes, permRes;
      var arr = await Promise.all([
        getDepartments(),
        getUsers().catch(() => ({ data: [] })),
        getPermissionGroups().catch(() => ({ data: [] })),
      ]);
      deptRes = arr[0];
      userRes = arr[1];
      permRes = arr[2];
      var depts = Array.isArray(deptRes) ? deptRes : ((deptRes && deptRes.data) || []);
      var permGroups = Array.isArray(permRes) ? permRes : ((permRes && permRes.data) || []);
      var permGroupNames = permGroups.map(function(p) { return p.name || ''; });

      var departments = depts.map(function(d) {
        var rawName = d.name;
        var nm = (rawName && String(rawName).trim()) || ('部门_' + (d._id || '').substring(0, 6));
        var pgIdx = d.permissionGroupId
          ? permGroups.findIndex(function(p) { return p._id === d.permissionGroupId; })
          : -1;
        return {
          id: d._id, name: nm,
          members: d.members || [], membersCount: (d.members || []).length,
          permissionGroupId: d.permissionGroupId || '',
          permissionGroupIndex: pgIdx,
        };
      });
      var allUsers = Array.isArray(userRes) ? userRes : ((userRes && userRes.data) || []);
      this.setData({
        departments: departments, allUsers: allUsers,
        permGroups: permGroups, permGroupNames: permGroupNames,
      });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: 'none' });
    }
    wx.hideLoading();
  },

  addDept: function() {
    var self = this;
    wx.showModal({
      title: "新建部门群组",
      editable: true,
      placeholderText: "请输入部门名称",
      success: async function(res) {
        if (!res.confirm || !res.content) return;
        try {
          var result = await createDepartment({ name: res.content, members: [] });
          // 强制补写 name（防御云函数写入丢失）
          if (result && result.id) {
            try { await updateDepartment(result.id, { name: res.content }); } catch(e) {}
          }
          self._reload();
        } catch (e) {
          wx.showToast({ title: "创建失败", icon: 'none' });
        }
      },
    });
  },

  editDept: function(e) {
    var id = e.currentTarget.dataset.id;
    var d = this.data.departments.find(function(item) { return item.id === id; });
    if (!d) return;
    var memberIdSet = new Set((d.members || []).map(function(m) { return m.userId; }));
    var pickerUsers = (this.data.allUsers || []).map(function(u) {
      var uid = u.userId || u._id || u.openid;
      return { userId: uid, name: u.name || "未知", inGroup: memberIdSet.has(uid) };
    });
    this.setData({
      showMemberPicker: true,
      pickerDeptId: id,
      pickerDeptName: d.name || '',
      pickerUsers: pickerUsers,
    });
  },

  addMember: function(e) {
    this.editDept(e);
  },

  toggleMember: function(e) {
    var uid = e.currentTarget.dataset.userId;
    this.setData({
      pickerUsers: this.data.pickerUsers.map(function(u) {
        return u.userId === uid ? { userId: u.userId, name: u.name, inGroup: !u.inGroup } : u;
      }),
    });
  },

  saveMembers: async function() {
    var pickerDeptId = this.data.pickerDeptId;
    var pickerUsers = this.data.pickerUsers;
    var newMembers = pickerUsers
      .filter(function(u) { return u.inGroup; })
      .map(function(u) { return { userId: u.userId, name: u.name }; });
    try {
      await updateDepartment(pickerDeptId, { members: newMembers });
      this.setData({ showMemberPicker: false });
      this._reload();
    } catch (e) {
      wx.showToast({ title: "更新失败", icon: 'none' });
    }
  },

  closeMemberPicker: function() {
    this.setData({ showMemberPicker: false });
  },

  deleteDept: function(e) {
    var id = e.currentTarget.dataset.id;
    var self = this;
    wx.showModal({
      title: "删除部门群组",
      content: "确认删除此群组？成员不受影响。",
      confirmColor: '#D32F2F',
      success: async function(res) {
        if (!res.confirm) return;
        try {
          await deleteDepartment(id);
          self._reload();
        } catch (e) {
          wx.showToast({ title: "删除失败", icon: 'none' });
        }
      },
    });
  },

  // 部门关联权限组
  onDeptPermChange: async function(e) {
    var deptId = e.currentTarget.dataset.id;
    var permIdx = e.detail.value;
    var permGroup = this.data.permGroups[permIdx];
    var deptIdx = e.currentTarget.dataset.index;

    // 更新本地显示
    var departments = this.data.departments.slice();
    departments[deptIdx].permissionGroupIndex = permIdx;
    departments[deptIdx].permissionGroupId = permGroup ? permGroup._id : '';
    this.setData({ departments: departments });

    // 保存到数据库
    try {
      await updateDepartment(deptId, {
        permissionGroupId: permGroup ? permGroup._id : '',
      });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
});
