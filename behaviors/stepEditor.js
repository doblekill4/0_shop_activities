/**
 * stepEditor Behavior：create 和 edit 页共用的活动环节编辑逻辑
 * 包括：环节增删、步骤字段输入、负责人双列选择、地点选择
 */
const { getCurrentUser } = require('../utils/auth');
const { VENUE_LIST } = require('../utils/constants');

module.exports = Behavior({
  data: {
    userList: [],
    isAdmin: false,
    deptUserRange: [[], []],
    venueOptions: VENUE_LIST,
  },

  methods: {
    // 子类可覆盖，生成 tempId（create 用递增计数器，edit 用 Date.now）
    _getNextTempId() {
      return Date.now();
    },

    addStep() {
      const steps = [...this.data.form.steps];
      steps.push({
        tempId: this._getNextTempId(),
        stepName: '',
        startTime: '',
        endTime: '',
        venue: '',
        venueIndex: 0,
        ownerId: '',
        ownerName: '',
        ownerIndex: -1,
        ownerDeptValue: [0, this._pendingIdx || 0],
      });
      this.setData({ 'form.steps': steps });
    },

    removeStep(e) {
      const idx = e.currentTarget.dataset.index;
      const steps = [...this.data.form.steps];
      steps.splice(idx, 1);
      this.setData({ 'form.steps': steps });
      this.setData({ showSachet: this._shouldShowSachet() });
    },

    onStepInput(e) {
      const { index, field } = e.currentTarget.dataset;
      this.setData({ [`form.steps[${index}].${field}`]: e.detail.value });
      if (field === 'stepName') {
        this.setData({ showSachet: this._shouldShowSachet() });
      }
    },

    onStepTimeChange(e) {
      const { index, field } = e.currentTarget.dataset;
      this.setData({ [`form.steps[${index}].${field}`]: e.detail.value });
    },

    // 负责人选择确认
    onStepOwnerChange(e) {
      const index = e.currentTarget.dataset.index;
      if (!this.data.isAdmin) {
        const owner = this.data.userList[e.detail.value];
        if (!owner) return;
        this.setData({
          [`form.steps[${index}].ownerId`]: owner._id || owner.userId,
          [`form.steps[${index}].ownerName`]: owner.name,
        });
        return;
      }
      const val = e.detail.value;
      const deptName = this._deptNames[val[0]];
      const deptUsers = this._deptUserMap[deptName] || [];
      const isPending = val[1] >= deptUsers.length;
      if (isPending) {
        this.setData({
          [`form.steps[${index}].ownerDeptValue`]: [val[0], -1],
          [`form.steps[${index}].ownerDeptName`]: deptName,
          [`form.steps[${index}].ownerId`]: '__pending__',
          [`form.steps[${index}].ownerName`]: '待分配',
        });
        return;
      }
      const owner = deptUsers[val[1]];
      if (!owner) return;
      this.setData({
        [`form.steps[${index}].ownerDeptValue`]: val,
        [`form.steps[${index}].ownerId`]: owner._id || owner.userId,
        [`form.steps[${index}].ownerName`]: owner.name,
      });
    },

    // 部门列切换时刷新人员列，默认选中"待分配"
    onStepOwnerColumnChange(e) {
      const { column, value } = e.detail;
      if (column !== 0) return;
      const stepIdx = e.currentTarget.dataset.index;
      const deptName = this._deptNames[value];
      const deptUsers = this._deptUserMap[deptName] || [];
      const names = deptUsers.map(u => u.name);
      names.push('待分配');
      const range = this.data.deptUserRange.slice();
      range[1] = names;
      if (stepIdx !== undefined) {
        this.setData({
          deptUserRange: range,
          [`form.steps[${stepIdx}].ownerDeptValue`]: [value, names.length - 1],
        });
      } else {
        this.setData({ deptUserRange: range });
      }
    },

    // 环节地点变更（create 页有自定义输入，edit 页无；页面可覆盖此方法）
    onStepVenueChange(e) {
      const index = e.currentTarget.dataset.index;
      const venueIdx = Number(e.detail.value);
      const venueList = VENUE_LIST;
      const venue = venueIdx < venueList.length - 1 ? venueList[venueIdx] : '';
      // 默认实现：直接设置 venue（edit 页行为）
      this.setData({
        [`form.steps[${index}].venue`]: venue,
        [`form.steps[${index}].venueIndex`]: venueIdx,
      });
    },

    // 构建部门-人员双列选择器
    _buildDeptUserPicker(userList) {
      const deptMap = {};
      userList.forEach(u => {
        const dept = u.department || '未分组';
        if (!deptMap[dept]) deptMap[dept] = [];
        deptMap[dept].push(u);
      });
      const deptNames = Object.keys(deptMap);
      const storeIdx = deptNames.indexOf('店长');
      if (storeIdx !== -1) deptNames.splice(storeIdx, 1);
      deptNames.sort((a, b) => a.localeCompare(b, 'zh'));
      if (storeIdx !== -1) deptNames.push('店长');
      // 当前用户所在部门排到最前
      const user = getCurrentUser();
      if (user && user.department) {
        const myDept = user.department;
        const myIdx = deptNames.indexOf(myDept);
        if (myIdx > 0) {
          deptNames.splice(myIdx, 1);
          deptNames.unshift(myDept);
        }
      }
      this._deptNames = deptNames;
      this._deptUserMap = deptMap;
      const firstDeptUsers = deptNames.length > 0 ? (deptMap[deptNames[0]] || []) : [];
      const firstNames = firstDeptUsers.map(u => u.name);
      firstNames.push('待分配');
      this._pendingIdx = firstNames.length - 1;
      this.setData({ deptUserRange: [deptNames, firstNames] });
    },

    // 查找用户在部门选择器中的 [deptIdx, userIdx]
    _findOwnerDeptValue(user) {
      if (!user || !this._deptNames) return [0, 0];
      const dept = user.department || '未分组';
      const deptIdx = this._deptNames.indexOf(dept);
      if (deptIdx < 0) return [0, 0];
      const deptUsers = this._deptUserMap[dept] || [];
      const userIdx = deptUsers.findIndex(u => u._id === user._id);
      return [deptIdx, userIdx >= 0 ? userIdx : 0];
    },
  },
});
