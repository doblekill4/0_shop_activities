// pages/admin/permission-groups/permission-groups.js
const {
  getPermissionGroups, createPermissionGroup, updatePermissionGroup, deletePermissionGroup,
  getUsers, updateUser,
} = require('../../../services/admin');
const { getCurrentUser } = require('../../../utils/auth');

// 权限中文标签
const PERM_LABELS = {
  manage_users:       '管理用户',
  manage_departments: '管理部门',
  manage_permissions: '管理权限',
  create_activity:    '新建活动',
  edit_activity:      '编辑活动',
  delete_activity:    '删除活动',
  export_data:        '导出数据',
  send_notification:  '发送通知',
  view_all_revisions: '查看修订',
  assign_process_owner: '指派负责人',
  set_capacity_limit: '接待上限更改',
};

Page({
  data: {
    groups: [],
    allUsers: [],
    showEditor: false,
    editorId: '',
    editorName: '',
    editorPerms: {},
    permList: [],
    showMemberPicker: false,
    pickerGroupName: '',
    pickerGroupId: '',
    pickerUsers: [],
  },

  noop: function() {},

  _inited: false,
  _loading: false,

  async onLoad() {
    if (this._inited) return;
    this._inited = true;
    wx.setNavigationBarTitle({ title: '权限组管理' });
    await this._initSystemGroups();
    this._reload();
  },

  _initSystemGroups: async function() {
    try {
      if (this._systemGroupInited) return;
      this._systemGroupInited = true;
      const res = await getPermissionGroups();
      const groups = Array.isArray(res) ? res : ((res && res.data) || []);
      const existingNames = {};
      const needFix = [];
      (groups || []).forEach(function(g) {
        if (g && typeof g.name === 'string' && g.name.trim()) {
          existingNames[g.name.trim()] = true;
        } else if (g && g._id) {
          needFix.push(g);
        }
      });
      const allPerms = Object.keys(PERM_LABELS);
      if (!existingNames['admin']) {
        const result = await createPermissionGroup({ name: 'admin', permissions: allPerms });
        try { await updatePermissionGroup(result.id, { name: 'admin' }); } catch(e) {}
      }
      if (!existingNames['user']) {
        const result2 = await createPermissionGroup({ name: 'user', permissions: [] });
        try { await updatePermissionGroup(result2.id, { name: 'user' }); } catch(e) {}
      }
      for (var i = 0; i < needFix.length; i++) {
        var g = needFix[i];
        var fixName = 'group_' + g._id.substring(0, 8);
        try { await updatePermissionGroup(g._id, { name: fixName }); } catch(e2) {}
      }
    } catch (e) {
      console.warn('[permission-groups] 系统组初始化失败', e);
    }
  },

  async _reload() {
    if (this._loading) return;
    this._loading = true;
    try {
      const [gRes, uRes] = await Promise.all([getPermissionGroups(), getUsers()]);
      const groups   = Array.isArray(gRes) ? gRes : ((gRes && gRes.data) || []);
      const allUsers = Array.isArray(uRes) ? uRes : ((uRes && uRes.data) || []);
      const usersByGroup = {};
      (allUsers || []).forEach(function(u) {
        var gid2 = String(u.permissionGroupId || '__none__');
        if (!usersByGroup[gid2]) usersByGroup[gid2] = [];
        usersByGroup[gid2].push({ userId: u.userId || u._id || u.openid, name: u.name || "未知" });
      });
      const groupsWithMembers = groups.map(function(g) {
        var rawName = g.name;
        var nm = (rawName && String(rawName).trim()) || g._id || "未知";
        if (!rawName) console.warn('[permission-groups] 权限组缺少 name 字段，_id=' + g._id);
        return {
          id: g._id,
          name: nm,
          permissions: g.permissions || [],
          members: usersByGroup[g._id] || [],
          membersCount: (usersByGroup[g._id] || []).length,
          permissionsCount: (g.permissions || []).length,
          isSystem: (nm === 'admin' || nm === 'user'),
        };
      });
      this.setData({ groups: groupsWithMembers, allUsers });
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: 'none' });
    } finally {
      this._loading = false;
    }
  },

  addGroup: function() {
    var permList = Object.entries(PERM_LABELS).map(function(item) {
      return { key: item[0], label: item[1], enabled: false };
    });
    this.setData({ showEditor: true, editorId: '', editorName: '', editorPerms: {}, permList: permList });
  },

  editGroup: function(e) {
    var g = this.data.groups.find(function(x) { return x.id === e.currentTarget.dataset.id; });
    if (!g) return;
    var perms = g.permissions || [];
    var permObj = {};
    perms.forEach(function(p) { permObj[p] = true; });
    var permList = Object.entries(PERM_LABELS).map(function(item) {
      return { key: item[0], label: item[1], enabled: !!permObj[item[0]] };
    });
    this.setData({ showEditor: true, editorId: g.id, editorName: g.name, editorPerms: permObj, permList: permList });
  },

  onEditorName: function(e) { this.setData({ editorName: e.detail.value }); },

  togglePerm: function(e) {
    var key = e.currentTarget.dataset.key;
    var permList = this.data.permList.map(function(p) {
      return p.key === key ? { key: p.key, label: p.label, enabled: !p.enabled } : p;
    });
    var editorPerms = {};
    permList.forEach(function(p) { if (p.enabled) editorPerms[p.key] = true; });
    this.setData({ permList: permList, editorPerms: editorPerms });
  },

  saveEditor: async function() {
    var editorId = this.data.editorId;
    var editorName = this.data.editorName;
    var editorPerms = this.data.editorPerms;
    if (!editorName.trim()) { wx.showToast({ title: "请输入组名", icon: 'none' }); return; }
    var perms = Object.keys(editorPerms || {}).filter(function(k) { return editorPerms[k]; });
    try {
      if (editorId) {
        await updatePermissionGroup(editorId, { name: editorName.trim(), permissions: perms });
      } else {
        var res = await createPermissionGroup({ name: editorName.trim(), permissions: perms });
        // 强制补写 name（防御云函数写入丢失）
        if (res && res.id) {
          try { await updatePermissionGroup(res.id, { name: editorName.trim() }); } catch(e) {}
        }
      }
      this.setData({ showEditor: false });
      this._reload();
    } catch (e) {
      wx.showToast({ title: "保存失败", icon: 'none' });
    }
  },

  closeEditor: function() { this.setData({ showEditor: false }); },

  manageMembers: function(e) {
    var g = this.data.groups.find(function(x) { return x.id === e.currentTarget.dataset.id; });
    if (!g) return;

    // 部门主管权限限制：非管理员只能调整自己所属权限组的成员
    var cu = getCurrentUser();
    if (cu && cu.role !== 'admin') {
      var myGroupId = cu.permissionGroupId;
      // 用户只能管理自己所在的权限组（防止跨部门误调）
      if (myGroupId && myGroupId !== g.id && myGroupId !== g._id) {
        wx.showToast({ title: '只能管理自己所属权限组的成员', icon: 'none' });
        return;
      }
    }

    var allUsers = this.data.allUsers;
    var midSet = new Set((g.members || []).map(function(m) { return m.userId; }));
    var pu = allUsers.map(function(u) {
      var uid2 = u.userId || u._id || u.openid;
      return { userId: uid2, name: u.name || "未知", inGroup: midSet.has(uid2) };
    });
    this.setData({
      showMemberPicker: true,
      pickerGroupId: g.id,
      pickerGroupName: g.name || g._id || "未知",
      pickerUsers: pu,
    });
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
    var pickerGroupId = this.data.pickerGroupId;
    var pickerUsers   = this.data.pickerUsers;
    var addUsers  = pickerUsers.filter(function(u) { return u.inGroup; });
    var removeIds = pickerUsers.filter(function(u) { return !u.inGroup; }).map(function(u) { return u.userId; });
    try {
      for (var i = 0; i < addUsers.length; i++) {
        var u = addUsers[i];
        await updateUser(u.userId, { permissionGroupId: pickerGroupId });
      }
      for (var j = 0; j < removeIds.length; j++) {
        var uid = removeIds[j];
        var doc = this.data.allUsers.find(function(x) { return (x.userId || x._id || x.openid) === uid; });
        if (doc && (doc.permissionGroupId || '') === pickerGroupId) {
          await updateUser(doc._id || uid, { permissionGroupId: '' });
        }
      }
      this.setData({ showMemberPicker: false });
      this._reload();
    } catch (e) {
      wx.showToast({ title: "保存成员失败", icon: 'none' });
    }
  },

  closeMemberPicker: function() { this.setData({ showMemberPicker: false }); },

  deleteGroup: async function(e) {
    var id = e.currentTarget.dataset.id;
    var g  = this.data.groups.find(function(x) { return x.id === id; });
    if (!g) return;
    if (g.isSystem) { wx.showToast({ title: "系统组不可删除", icon: 'none' }); return; }
    var self = this;
    wx.showModal({
      title: "删除权限组",
      content: 'delete ' + g.name + '?',
      confirmColor: '#D32F2F',
      success: async function(res) {
        if (!res.confirm) return;
        try {
          await deletePermissionGroup(id);
          self._reload();
        } catch (e) {
          wx.showToast({ title: "删除失败", icon: 'none' });
        }
      },
    });
  },
});
