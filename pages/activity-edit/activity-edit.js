// pages/activity-edit/activity-edit.js
// 编辑页复用创建页逻辑，额外加载原始数据并做差异对比生成修订记录
const { getActivityDetail, updateActivity } = require('../../services/activity');
const { getUsers } = require('../../services/admin');
const { formatDate } = require('../../utils/format');
const { getCurrentUser, isAdmin, hasPermission } = require('../../utils/auth');

Page({
  data: {
    activityId: null,
    form: {},
    originalForm: {},   // 保存原始值，用于对比生成修订摘要
    originalStatus: '', // 原始活动状态（用于判断是否是草稿）
    isAdmin: false,     // 是否管理员（控制预订人可编辑性）
    userList: [],
    deptUserRange: [[], []],  // 管理员双列选择器
    saving: false,
    submitting: false,
    showSachet: false,  // 根据业务体现/流程中是否含香囊关键词动态显示
    // 自定义时间选择
    showTimePicker: false,
    timePickerValue: [8, 0],
    timeHours: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    timeMinutes: ['00','05','10','15','20','25','30','35','40','45','50','55'],
    editingTimeIndex: -1,
    editingTimeField: '',  // 'startTime' | 'endTime'
  },

  // 计算属性：香囊是否显示
  _shouldShowSachet() {
    const f = this.data.form;
    const bizText = (f.businessType || '') + (f.venueUsage || '');
    const stepsText = (f.steps || []).map(s => (s.stepName || '')).join(' ');
    const combined = bizText + ' ' + stepsText;
    return combined.indexOf('香囊') !== -1;
  },

  async onLoad(options) {
    const id = options.id;
    wx.setNavigationBarTitle({ title: '编辑活动' });
    this.setData({ activityId: id });

    try {
      const user = getCurrentUser();
      const isAdmin = user && user.role === 'admin';
      const canAssignOwner = hasPermission('assign_process_owner');
      let userList = [];

      if (canAssignOwner) {
        // 有指派权限：尝试拉全部用户（管理员直接成功，非管理员走公开接口）
        try {
          const res = await getUsers();
          userList = res.data || res || [];
        } catch (e) {
          // getUsers 需要管理员，失败时用公开接口兜底
          try {
            const pubRes = await wx.cloud.callFunction({ name: 'auth', data: { action: 'getPublicUserList' } });
            if (pubRes.result && pubRes.result.code === 0) {
              userList = pubRes.result.data || [];
            }
          } catch (e2) {}
        }
      } else if (user) {
        // 无指派权限：只能看到自己
        userList = [user];
      }

      this.setData({ canAssignOwner, isAdmin, userList });
      // 管理员：构建部门-人员双列选择器
      if (isAdmin) this._buildDeptUserPicker(userList);

      const [detail] = await Promise.all([
        getActivityDetail(id),
      ]);

      const form = {
        activityDate:     formatDate(detail.activityDate),
        arrivalTime:      detail.arrivalTime || '',
        activityUnit:     detail.activityUnit || '',
        venue:            detail.venue || '',
        peopleCount:      String(detail.peopleCount || ''),
        businessType:     detail.businessType || '',
        venueUsage:       detail.venueUsage || '',
        steps:            (detail.steps || []).map(s => {
          const owner = (userList || []).find(u => u._id === s.ownerId || u.userId === s.ownerId);
          return {
            id:          s._id || s.id,
            tempId:      s._id || s.id,
            stepName:    s.stepName,
            startTime:   s.startTime,
            endTime:     s.endTime,
            ownerId:     s.ownerId,
            ownerName:   s.ownerName,
            completedAt: s.completedAt,
            completedBy: s.completedBy,
            ownerIndex:  owner ? (userList || []).indexOf(owner) : -1,
            ownerDeptValue: isAdmin ? this._findOwnerDeptValue(owner || null) : [0, 0],
          };
        }),
        settlementMethod: detail.settlementMethod || '',
        totalCost:        String(detail.totalCost || ''),
        contactPerson:    detail.contactPerson || '',
        bookingPerson:    detail.bookingPerson || '',
        clientInfo:       detail.clientInfo || {},
        venueNeeds:       detail.venueNeeds || {},
        invoiceNeeds:     detail.invoiceNeeds || '',
        sachetAccount:    detail.sachetAccount || '',
      };

      this.setData({
        form,
        originalForm: JSON.parse(JSON.stringify(form)),
        originalStatus: detail.status || '',
        canAssignOwner,
        userList: userList || [],
        showSachet: (() => {
          const bizText = (form.businessType || '') + (form.venueUsage || '');
          const stepsText = (form.steps || []).map(s => (s.stepName || '')).join(' ');
          return (bizText + ' ' + stepsText).indexOf('香囊') !== -1;
        })(),
      });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 通用输入
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
    if (field === 'businessType' || field === 'venueUsage') {
      this.setData({ showSachet: this._shouldShowSachet() });
    }
  },

  onDateChange(e) {
    this.setData({ 'form.activityDate': e.detail.value });
  },

  onArrivalTimeChange(e) {
    this.setData({ 'form.arrivalTime': e.detail.value });
  },

  onClientInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.clientInfo.${field}`]: e.detail.value });
  },

  toggleNeed(e) {
    const field = e.currentTarget.dataset.field;
    const cur = this.data.form.venueNeeds[field];
    this.setData({ [`form.venueNeeds.${field}`]: !cur });
  },

  setSachet(e) {
    this.setData({ 'form.sachetAccount': e.currentTarget.dataset.val });
  },

  addStep() {
    const steps = [...this.data.form.steps, {
      tempId: Date.now(),
      stepName: '', startTime: '', endTime: '',
      ownerId: '', ownerName: '', ownerIndex: -1,
    }];
    this.setData({ 'form.steps': steps });
    this.setData({ showSachet: this._shouldShowSachet() });
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

  // 双列选择器确认（管理员：部门+人员）
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
    // 管理员：双列选择器 [deptIdx, userIdx]
    const val = e.detail.value;
    const deptName = this._deptNames[val[0]];
    const deptUsers = this._deptUserMap[deptName] || [];
    const owner = deptUsers[val[1]];
    if (!owner) return;
    this.setData({
      [`form.steps[${index}].ownerDeptValue`]: val,
      [`form.steps[${index}].ownerId`]: owner._id || owner.userId,
      [`form.steps[${index}].ownerName`]: owner.name,
    });
  },

  // 部门列切换时刷新人员列
  onStepOwnerColumnChange(e) {
    const { column, value } = e.detail;
    if (column !== 0) return;
    const deptName = this._deptNames[value];
    const deptUsers = this._deptUserMap[deptName] || [];
    const range = this.data.deptUserRange.slice();
    range[1] = deptUsers.map(u => u.name);
    this.setData({ deptUserRange: range });
  },

  // 构建部门-人员双列选择器
  _buildDeptUserPicker(userList) {
    const deptMap = {};
    userList.forEach(u => {
      const dept = u.department || '未分组';
      if (!deptMap[dept]) deptMap[dept] = [];
      deptMap[dept].push(u);
    });
    const deptNames = Object.keys(deptMap).sort((a, b) => {
      if (a === '店长组') return 1;
      if (b === '店长组') return -1;
      return a.localeCompare(b);
    });
    this._deptNames = deptNames;
    this._deptUserMap = deptMap;
    const firstDeptUsers = deptNames.length > 0 ? (deptMap[deptNames[0]] || []) : [];
    this.setData({
      deptUserRange: [deptNames, firstDeptUsers.map(u => u.name)],
    });
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

  // ===== 自定义时间选择 =====
  openTimePicker(e) {
    const { index, field } = e.currentTarget.dataset;
    const step = this.data.form.steps[index];
    if (!step) return;
    // 结束时间默认对齐开始时间
    let timeStr = step[field];
    if (!timeStr && field === 'endTime' && step.startTime) {
      timeStr = step.startTime;
    }
    if (!timeStr) timeStr = '08:00';
    const parts = timeStr.split(':');
    const h = parseInt(parts[0]) || 8;
    const m = parseInt(parts[1]) || 0;
    const minuteIndex = this.data.timeMinutes.indexOf(String(m).padStart(2, '0'));
    this.setData({
      showTimePicker: true,
      editingTimeIndex: Number(index),
      editingTimeField: field,
      timePickerValue: [h, minuteIndex >= 0 ? minuteIndex : 0],
    });
  },

  onTimePickerChange(e) {
    this.setData({ timePickerValue: e.detail.value });
  },

  confirmTimePicker() {
    const { editingTimeIndex, editingTimeField, timePickerValue, timeHours, timeMinutes } = this.data;
    if (editingTimeIndex < 0 || !editingTimeField) return;
    const h = timeHours[timePickerValue[0]];
    const m = timeMinutes[timePickerValue[1]];
    const timeStr = `${h}:${m}`;
    this.setData({
      [`form.steps[${editingTimeIndex}].${editingTimeField}`]: timeStr,
      showTimePicker: false,
    });
  },

  closeTimePicker() {
    this.setData({ showTimePicker: false });
  },

  // 保存修改（服务端自动生成修订日志）
  async saveEdit() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const cleanForm = this._buildCleanForm();
      console.log('[saveEdit] 提交 cleanForm:', cleanForm);
      await updateActivity(this.data.activityId, cleanForm);
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1200);
    } catch (e) {
      console.error('[saveEdit] 保存失败:', e);
      wx.showToast({ title: '保存失败：' + (e.message || e.errMsg || '未知错误'), icon: 'none' });
    }
    this.setData({ saving: false });
  },

  // 提交草稿（从草稿状态变为待确认，同时保存编辑内容）
  async submitDraft() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const cleanForm = this._buildCleanForm();
      cleanForm.status = 'pending';  // 关键：将草稿变为正式活动
      console.log('[submitDraft] 提交 cleanForm:', cleanForm);
      await updateActivity(this.data.activityId, cleanForm);
      wx.showToast({ title: '活动已提交', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({
          url: `/pages/activity-detail/activity-detail?id=${this.data.activityId}`,
        });
      }, 1200);
    } catch (e) {
      console.error('[submitDraft] 提交失败:', e);
      wx.showToast({ title: '提交失败：' + (e.message || e.errMsg || '未知错误'), icon: 'none' });
    }
    this.setData({ submitting: false });
  },

  // 构建清洗后的表单数据（提取公共逻辑）
  _buildCleanForm() {
    const f = this.data.form;
    const cleanSteps = f.steps ? f.steps.map(s => ({
      _id:         s.id || s._id || s.tempId || ('step_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8)),
      stepName:    s.stepName || '',
      startTime:   s.startTime || '',
      endTime:     s.endTime || '',
      ownerId:     s.ownerId || '',
      ownerName:   s.ownerName || '',
      completedAt: s.completedAt || null,
      completedBy: s.completedBy || null,
    })) : [];

    return {
      activityDate:    f.activityDate || '',
      arrivalTime:     f.arrivalTime || '',
      activityUnit:    f.activityUnit || '',
      venue:           f.venue || '',
      peopleCount:     Number(f.peopleCount) || 0,
      businessType:    f.businessType || '',
      venueUsage:      f.venueUsage || '',
      steps:           cleanSteps,
      settlementMethod: f.settlementMethod || '',
      totalCost:        String(f.totalCost || ''),
      contactPerson:    f.contactPerson || '',
      bookingPerson:    f.bookingPerson || '',
      clientInfo:       f.clientInfo || {},
      venueNeeds:       f.venueNeeds || {},
      invoiceNeeds:     f.invoiceNeeds || '',
      sachetAccount:    f.sachetAccount || '',
    };
  },
});
