// pages/activity-create/activity-create.js
const { createActivity } = require('../../services/activity');
const { getUsers } = require('../../services/admin');
const { getCurrentUser } = require('../../utils/auth');

// 默认表单结构
const DEFAULT_FORM = () => ({
  activityDate: '',
  activityUnit: '',
  venue: '',
  peopleCount: '',
  businessType: '',
  venueUsage: '',
  steps: [],
  settlementMethod: '',
  totalCost: '',
  contactPerson: '',
  bookingPerson: '',
  clientInfo: {
    ethnicity: '',
    age: '',
    dietaryRestrictions: '',
    specialRequirements: '',
  },
  venueNeeds: {
    build: false,
    rehearsal: false,
    power: false,
    mainVisual: false,
    filming: false,
  },
  invoiceNeeds: '',
  sachetAccount: '',  // 'clinic' | 'shop'
});

let _stepTempId = 0;

Page({
  data: {
    form: DEFAULT_FORM(),
    userList: [],
    saving: false,
    submitting: false,
    showRegister: false,
    // 自定义时间选择
    showTimePicker: false,
    timePickerValue: [8, 0],
    timeHours: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    timeMinutes: ['00','05','10','15','20','25','30','35','40','45','50','55'],
    editingTimeIndex: -1,
    editingTimeField: '',  // 'startTime' | 'endTime'
  },

  async onLoad() {
    const app = getApp();
    if (!app.globalData.isLoggedIn || !app.globalData.userInfo) {
      this.setData({ showRegister: true });
      return;
    }
    wx.setNavigationBarTitle({ title: '新建活动' });
    // 预填写预订人（当前登录用户）
    const user = getCurrentUser();
    if (user) {
      this.setData({ 'form.bookingPerson': user.name });
      // 只有管理员才需要获取全部用户列表（用于指派环节负责人）
      if (user.role === 'admin') {
        try {
          const userList = await getUsers();
          this.setData({ userList: userList || [] });
        } catch (e) {
          console.warn('获取用户列表失败', e);
        }
      } else {
        // 普通用户：用户列表只包含自己，环节负责人默认是自己
        this.setData({ userList: [user] });
      }
    }
  },

  // 通用字段输入
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  // 日期选择
  onDateChange(e) {
    this.setData({ 'form.activityDate': e.detail.value });
  },

  // 客户信息字段
  onClientInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.clientInfo.${field}`]: e.detail.value });
  },

  // 场地需求切换
  toggleNeed(e) {
    const field = e.currentTarget.dataset.field;
    const cur = this.data.form.venueNeeds[field];
    this.setData({ [`form.venueNeeds.${field}`]: !cur });
  },

  // 香囊账户选择
  setSachet(e) {
    this.setData({ 'form.sachetAccount': e.currentTarget.dataset.val });
  },

  // ===== 流程环节 =====
  addStep() {
    const steps = [...this.data.form.steps];
    steps.push({
      tempId: ++_stepTempId,
      stepName: '',
      startTime: '',
      endTime: '',
      ownerId: '',
      ownerName: '',
      ownerIndex: -1,
    });
    this.setData({ 'form.steps': steps });
  },

  removeStep(e) {
    const idx = e.currentTarget.dataset.index;
    const steps = [...this.data.form.steps];
    steps.splice(idx, 1);
    this.setData({ 'form.steps': steps });
  },

  onStepInput(e) {
    const { index, field } = e.currentTarget.dataset;
    this.setData({ [`form.steps[${index}].${field}`]: e.detail.value });
  },

  onStepTimeChange(e) {
    const { index, field } = e.currentTarget.dataset;
    this.setData({ [`form.steps[${index}].${field}`]: e.detail.value });
  },

  onStepOwnerChange(e) {
    const index = e.currentTarget.dataset.index;
    const ownerIndex = e.detail.value;
    const owner = this.data.userList[ownerIndex];
    if (!owner) return;
    this.setData({
      [`form.steps[${index}].ownerIndex`]: ownerIndex,
      [`form.steps[${index}].ownerId`]:   owner._id,
      [`form.steps[${index}].ownerName`]: owner.name,
    });
  },

  // ===== 自定义时间选择 =====
  openTimePicker(e) {
    const { index, field } = e.currentTarget.dataset;
    const step = this.data.form.steps[index];
    if (!step) return;
    const timeStr = step[field] || '08:00';
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

  // ===== 校验 =====
  _validate() {
    const f = this.data.form;
    if (!f.activityDate)  { wx.showToast({ title: '请选择活动时间', icon: 'none' }); return false; }
    if (!f.activityUnit)  { wx.showToast({ title: '请填写活动单位', icon: 'none' }); return false; }
    if (!f.venue)         { wx.showToast({ title: '请填写活动地点', icon: 'none' }); return false; }
    if (!f.peopleCount)   { wx.showToast({ title: '请填写活动人数', icon: 'none' }); return false; }
    if (!f.bookingPerson) { wx.showToast({ title: '请填写预订人',   icon: 'none' }); return false; }
    for (const [i, s] of f.steps.entries()) {
      if (!s.stepName) {
        wx.showToast({ title: `第${i+1}个环节名称不能为空`, icon: 'none' });
        return false;
      }
    }
    return true;
  },

  // ===== 存为草稿 =====
  async saveDraft() {
    if (this._loading) return;
    this._loading = true;
    this.setData({ saving: true });
    try {
      const res = await createActivity({ ...this.data.form, status: 'draft' });
      console.log('[saveDraft] 成功:', res);
      wx.showToast({ title: '已存为草稿', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1200);
    } catch (e) {
      console.error('[saveDraft] 失败:', e);
      wx.showToast({ title: '保存失败：' + (e.message || e.errMsg || '未知错误'), icon: 'none', duration: 2500 });
    }
    this.setData({ saving: false });
    this._loading = false;
  },

  // ===== 提交活动 =====
  async submitActivity() {
    if (!this._validate()) return;
    if (this._loading) return;
    this._loading = true;
    this.setData({ submitting: true });
    try {
      console.log('[submitActivity] 提交数据:', JSON.stringify(this.data.form));
      const res = await createActivity({ ...this.data.form, status: 'pending' });
      console.log('[submitActivity] 成功:', res);
      // res = { id: 'xxx' } from cloud function
      const activityId = res && (res.id || res._id);
      if (!activityId) {
        wx.showToast({ title: '提交成功但未获取到活动ID，请返回列表刷新', icon: 'none', duration: 2500 });
        setTimeout(() => wx.navigateBack(), 2500);
        return;
      }
      wx.showToast({ title: '活动已提交', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({
          url: `/pages/activity-detail/activity-detail?id=${activityId}`,
        });
      }, 1200);
    } catch (e) {
      console.error('[submitActivity] 失败:', e);
      wx.showToast({ title: '提交失败：' + ((e && e.message) || e.errMsg || '未知错误'), icon: 'none', duration: 2500 });
    }
    this.setData({ submitting: false });
    this._loading = false;
  },

  onRegisterSuccess(e) {
    this.setData({ showRegister: false });
    this.onLoad();
  },
});
