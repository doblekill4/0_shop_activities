// subpackages/admin/pages/notification-config/notification-config.js
const { configureReminders } = require('../../../../services/notification');
const { getDepartments, getUsers } = require('../../../../services/admin');

Page({
  data: {
    rules: [],
    timingOptions: ['活动开始前', '活动结束后'],
    departments: [],
    allUsers: [],
    saving: false,
  },

  async onLoad() {
    wx.setNavigationBarTitle({ title: '通知配置' });
    const [deptRes, userRes] = await Promise.all([getDepartments(), getUsers()]);
    this.setData({
      departments: deptRes.data || [],
      allUsers: userRes.data || [],
    });
    // 加载已有规则（如有）
    const saved = wx.getStorageSync('notification_rules');
    if (saved) this.setData({ rules: saved });
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
    this.setData({ [`rules[${idx}].timingIndex`]: e.detail.value });
  },

  onMinutesInput(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`rules[${idx}].minutes`]: parseInt(e.detail.value) || 0 });
  },

  onTargetTypeChange(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({
      [`rules[${idx}].targetTypeIndex`]: e.detail.value,
      [`rules[${idx}].targets`]: [],
    });
  },

  addTarget(e) {
    const ruleIndex = e.currentTarget.dataset.ruleIndex;
    const rule = this.data.rules[ruleIndex];
    const list = rule.targetTypeIndex === 0 ? this.data.allUsers : this.data.departments;
    const items = list.map(i => i.name);

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const selected = list[res.tapIndex];
        const targets = [...rule.targets];
        if (!targets.find(t => t.id === selected.id)) {
          targets.push({ id: selected.id || selected.userId, name: selected.name });
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
      wx.setStorageSync('notification_rules', this.data.rules);
      wx.showToast({ title: '配置已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
    this.setData({ saving: false });
  },
});
