// subpackages/admin/pages/notification-config/notification-config.js
const { configureReminders } = require('../../../../services/notification');
const { getDepartments, getUsers } = require('../../../../services/admin');

Page({
  data: {
    rules: [],
    timingOptions: [
      '活动开始前',
      '活动结束后',
      '流程开始前（通知环节负责人）',
      '上一流程结束后（通知下一环节负责人）',
      '上一流程结束后（通知指定部门）',
    ],
    departments: [],
    allUsers: [],
    saving: false,
  },

  async onLoad() {
    wx.setNavigationBarTitle({ title: '通知配置' });
    wx.showLoading({ title: '加载中...' });
    try {
      const [deptRes, userRes] = await Promise.all([getDepartments(), getUsers()]);
      this.setData({
        departments: Array.isArray(deptRes) ? deptRes : (deptRes.data || []),
        allUsers: Array.isArray(userRes) ? userRes : (userRes.data || []),
      });
    } catch (e) {
      console.warn('[notif-config] 加载数据失败', e);
    }

    // 加载已有规则：优先云端，本地缓存兜底
    try {
      const cloudRes = await wx.cloud.callFunction({
        name: 'notifications',
        data: { action: 'loadGlobalReminders' },
      });
      if (cloudRes.result && cloudRes.result.code === 0 && cloudRes.result.data.length > 0) {
        this.setData({ rules: cloudRes.result.data });
        wx.setStorageSync('notification_rules', cloudRes.result.data);
        wx.hideLoading();
        return;
      }
    } catch (e) { /* 云端加载失败，用本地缓存 */ }
    const saved = wx.getStorageSync('notification_rules');
    if (saved && saved.length) this.setData({ rules: saved });
    wx.hideLoading();
  },

  addRule() {
    const rules = [...this.data.rules, {
      id: Date.now(),
      timingIndex: 0,  // 0=开始前, 1=结束后
      minutes: 30,
      targetTypeIndex: 0,  // 0=人员, 1=群组
      targets: [],
    }];
    this.setData({ rules });
  },

  deleteRule(e) {
    const idx = e.currentTarget.dataset.index;
    const rules = [...this.data.rules];
    rules.splice(idx, 1);
    this.setData({ rules });
  },

  onTimingChange(e) {
    const idx = e.currentTarget.dataset.index;
    const newVal = Number(e.detail.value);
    // timingIndex=4（通知指定部门）时默认选部门群组
    const updates = { [`rules[${idx}].timingIndex`]: newVal };
    if (newVal === 4) {
      updates[`rules[${idx}].targetTypeIndex`] = 1;
      updates[`rules[${idx}].targets`] = [];
    }
    this.setData(updates);
  },

  onMinutesInput(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`rules[${idx}].minutes`]: parseInt(e.detail.value) || 0 });
  },

  onTargetTypeChange(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({
      [`rules[${idx}].targetTypeIndex`]: Number(e.detail.value),
      [`rules[${idx}].targets`]: [],
    });
  },

  addTarget(e) {
    const ruleIndex = e.currentTarget.dataset.ruleIndex;
    const rule = this.data.rules[ruleIndex];
    if (!rule) return;
    // timingIndex=4（通知部门）强制用部门列表
    const useDepartments = rule.targetTypeIndex === 1 || rule.timingIndex === 4;
    const list = useDepartments ? this.data.departments : this.data.allUsers;
    if (!list || list.length === 0) {
      wx.showToast({ title: '暂无可选人员或群组', icon: 'none' });
      return;
    }
    const items = list.map(i => i.name || '未命名');

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const selected = list[res.tapIndex];
        if (!selected) return;
        const selId = selected._id || selected.id || selected.userId;
        const targets = [...rule.targets];
        if (!targets.find(t => t.id === selId)) {
          targets.push({ id: selId, name: selected.name });
        }
        this.setData({ [`rules[${ruleIndex}].targets`]: targets });
      },
    });
  },

  removeTarget(e) {
    const { ruleIndex, targetId } = e.currentTarget.dataset;
    const targets = this.data.rules[ruleIndex].targets.filter(t => t.id !== targetId);
    this.setData({ [`rules[${ruleIndex}].targets`]: targets });
  },

  async saveRules() {
    this.setData({ saving: true });
    try {
      // 本地缓存
      wx.setStorageSync('notification_rules', this.data.rules);
      // 保存到云函数（全局提醒规则）
      try {
        const { configureReminders } = require('../../../../services/notification');
        await configureReminders('global', this.data.rules);
      } catch (e) {
        console.warn('[notif-config] 云函数保存失败，已保存到本地', e);
      }
      wx.showToast({ title: '配置已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
    this.setData({ saving: false });
  },
});
