// behaviors/stepEditor.js
// create/edit 共用的活动环节编辑逻辑
var auth = require('../utils/auth');
var constants = require('../utils/constants');
var VENUE_LIST = constants.VENUE_LIST;

module.exports = Behavior({
  data: {
    userList: [],
    isAdmin: false,
    deptUserRange: [[], []],
    venueOptions: VENUE_LIST,
  },

  methods: {
    _getNextTempId: function () {
      return Date.now();
    },

    addStep: function () {
      var steps = this.data.form.steps.slice();
      steps.push({
        tempId: this._getNextTempId(),
        stepName: '', startTime: '', endTime: '',
        venue: '', venueIndex: 0,
        ownerId: '', ownerName: '', ownerIndex: -1,
        ownerDeptValue: [0, this._pendingIdx || 0],
      });
      this.setData({ 'form.steps': steps });
    },

    removeStep: function (e) {
      var idx = e.currentTarget.dataset.index;
      var steps = this.data.form.steps.slice();
      steps.splice(idx, 1);
      this.setData({ 'form.steps': steps });
      this.setData({ showSachet: this._shouldShowSachet() });
    },

    onStepInput: function (e) {
      var d = e.currentTarget.dataset;
      this.setData({ ['form.steps[' + d.index + '].' + d.field]: e.detail.value });
      if (d.field === 'stepName') {
        this.setData({ showSachet: this._shouldShowSachet() });
      }
    },

    onStepTimeChange: function (e) {
      var d = e.currentTarget.dataset;
      this.setData({ ['form.steps[' + d.index + '].' + d.field]: e.detail.value });
    },

    onStepOwnerChange: function (e) {
      var index = e.currentTarget.dataset.index;
      if (!this.data.isAdmin) {
        var owner = this.data.userList[e.detail.value];
        if (!owner) return;
        this.setData({
          ['form.steps[' + index + '].ownerId']: owner._id || owner.userId,
          ['form.steps[' + index + '].ownerName']: owner.name,
        });
        return;
      }
      var val = e.detail.value;
      var deptName = this._deptNames[val[0]];
      var deptUsers = this._deptUserMap[deptName] || [];
      if (val[1] >= deptUsers.length) {
        this.setData({
          ['form.steps[' + index + '].ownerDeptValue']: [val[0], -1],
          ['form.steps[' + index + '].ownerDeptName']: deptName,
          ['form.steps[' + index + '].ownerId']: '__pending__',
          ['form.steps[' + index + '].ownerName']: '待分配',
        });
        return;
      }
      var owner = deptUsers[val[1]];
      if (!owner) return;
      this.setData({
        ['form.steps[' + index + '].ownerDeptValue']: val,
        ['form.steps[' + index + '].ownerId']: owner._id || owner.userId,
        ['form.steps[' + index + '].ownerName']: owner.name,
      });
    },

    onStepOwnerColumnChange: function (e) {
      if (e.detail.column !== 0) return;
      var stepIdx = e.currentTarget.dataset.index;
      var deptName = this._deptNames[e.detail.value];
      var deptUsers = this._deptUserMap[deptName] || [];
      var names = deptUsers.map(function (u) { return u.name; });
      names.push('待分配');
      var range = this.data.deptUserRange.slice();
      range[1] = names;
      if (stepIdx !== undefined) {
        this.setData({
          deptUserRange: range,
          ['form.steps[' + stepIdx + '].ownerDeptValue']: [e.detail.value, names.length - 1],
        });
      } else {
        this.setData({ deptUserRange: range });
      }
    },

    onStepVenueChange: function (e) {
      var index = e.currentTarget.dataset.index;
      var venueIdx = Number(e.detail.value);
      var venue = venueIdx < VENUE_LIST.length - 1 ? VENUE_LIST[venueIdx] : '';
      this.setData({
        ['form.steps[' + index + '].venue']: venue,
        ['form.steps[' + index + '].venueIndex']: venueIdx,
      });
    },

    _buildDeptUserPicker: function (userList) {
      var deptMap = {};
      userList.forEach(function (u) {
        var dept = u.department || '未分组';
        if (!deptMap[dept]) deptMap[dept] = [];
        deptMap[dept].push(u);
      });
      var deptNames = Object.keys(deptMap);
      var storeIdx = deptNames.indexOf('店长');
      if (storeIdx !== -1) deptNames.splice(storeIdx, 1);
      deptNames.sort(function (a, b) { return a.localeCompare(b, 'zh'); });
      if (storeIdx !== -1) deptNames.push('店长');
      var user = auth.getCurrentUser();
      if (user && user.department) {
        var myIdx = deptNames.indexOf(user.department);
        if (myIdx > 0) { deptNames.splice(myIdx, 1); deptNames.unshift(user.department); }
      }
      this._deptNames = deptNames;
      this._deptUserMap = deptMap;
      var firstUsers = deptNames.length > 0 ? (deptMap[deptNames[0]] || []) : [];
      var firstNames = firstUsers.map(function (u) { return u.name; });
      firstNames.push('待分配');
      this._pendingIdx = firstNames.length - 1;
      this.setData({ deptUserRange: [deptNames, firstNames] });
    },

    _findOwnerDeptValue: function (user) {
      if (!user || !this._deptNames) return [0, 0];
      var dept = user.department || '未分组';
      var deptIdx = this._deptNames.indexOf(dept);
      if (deptIdx < 0) return [0, 0];
      var deptUsers = this._deptUserMap[dept] || [];
      var userIdx = -1;
      for (var ui = 0; ui < deptUsers.length; ui++) {
        if (deptUsers[ui]._id === user._id) { userIdx = ui; break; }
      }
      return [deptIdx, userIdx >= 0 ? userIdx : 0];
    },
  },
});
