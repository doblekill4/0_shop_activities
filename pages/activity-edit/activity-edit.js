// pages/activity-edit/activity-edit.js
const { getActivityDetail, updateActivity } = require('../../services/activity');
const { getUsers } = require('../../services/admin');
const { formatDate } = require('../../utils/format');
const { getCurrentUser, isAdmin, hasPermission } = require('../../utils/auth');

const VENUE_LIST = [
  '零号店1-3层', '零号店正门', '吧台后方书吧', '吧台沙发区', '吧台前台',
  '战略报告厅', '大包间', '小包间', '西餐厅',
  '散台小吃用餐区', '散台圆桌', '二层', '三层',
  '三层LED区', '四层DIY区', '五层多功能厅',
  '五层会议室一', '五层会议室二', '五层圆桌会议室',
  '员工餐厅', '元宇宙数字化工厂', '其他（手动输入）',
];

Page({
  data: {
    activityId: null,
    form: {},
    venueOptions: VENUE_LIST,
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
          const vIdx = s.venue ? VENUE_LIST.indexOf(s.venue) : -1;
          return {
            id:          s._id || s.id,
            tempId:      s._id || s.id,
            stepName:    s.stepName,
            startTime:   s.startTime,
            endTime:     s.endTime,
            venue:       s.venue || '',
            venueIndex:  vIdx >= 0 ? vIdx : VENUE_LIST.length - 1,
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

      // 修正双列选择器右列：确保初始显示选中部门的人员（而非默认为第一部门）
      if (isAdmin && form.steps.length > 0) {
        const firstStep = form.steps[0];
        if (firstStep.ownerDeptValue && firstStep.ownerDeptValue[0] >= 0) {
          const deptName = this._deptNames[firstStep.ownerDeptValue[0]];
          const deptUsers = (this._deptUserMap[deptName] || []).map(u => u.name);
          deptUsers.push('待分配');
          const range = this.data.deptUserRange.slice();
          range[1] = deptUsers;
          this.setData({ deptUserRange: range });
        }
      }

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
      venue: '',
      venueIndex: 0,  // 默认"零号店1-3层"
      ownerId: '', ownerName: '', ownerIndex: -1,
      ownerDeptValue: [0, this._pendingIdx || 0],  // 默认"待分配"
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
    // 判断是否选择了「待分配」
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

  // 部门列切换时刷新人员列，并默认选中"待分配"
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
    // 切换部门时，人员列默认选"待分配"（最后一个）
    if (stepIdx !== undefined) {
      this.setData({
        deptUserRange: range,
        [`form.steps[${stepIdx}].ownerDeptValue`]: [value, names.length - 1],
      });
    } else {
      this.setData({ deptUserRange: range });
    }
  },

  // 环节地点变更
  onStepVenueChange(e) {
    const index = e.currentTarget.dataset.index;
    const venueIdx = Number(e.detail.value);
    const venue = venueIdx < VENUE_LIST.length - 1 ? VENUE_LIST[venueIdx] : '';
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
    // 店长不常用，显式排到末尾，其余按拼音排序
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
    this.setData({
      deptUserRange: [deptNames, firstNames],
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
