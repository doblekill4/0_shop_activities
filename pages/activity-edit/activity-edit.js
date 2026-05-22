// pages/activity-edit/activity-edit.js
// 编辑页复用创建页逻辑，额外加载原始数据并做差异对比生成修订记录
const { getActivityDetail, updateActivity } = require('../../services/activity');
const { getUsers } = require('../../services/admin');
const { formatDate } = require('../../utils/format');

Page({
  data: {
    activityId: null,
    form: {},
    originalForm: {},   // 保存原始值，用于对比生成修订摘要
    userList: [],
    saving: false,
    // 自定义时间选择
    showTimePicker: false,
    timePickerValue: [8, 0],
    timeHours: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    timeMinutes: ['00','05','10','15','20','25','30','35','40','45','50','55'],
    editingTimeIndex: -1,
    editingTimeField: '',  // 'startTime' | 'endTime'
  },

  async onLoad(options) {
    const id = options.id;
    wx.setNavigationBarTitle({ title: '编辑活动' });
    this.setData({ activityId: id });

    try {
      const [detail, usersRes] = await Promise.all([
        getActivityDetail(id),
        getUsers(),
      ]);

      const form = {
        activityDate:     formatDate(detail.activityDate),
        activityUnit:     detail.activityUnit || '',
        venue:            detail.venue || '',
        peopleCount:      String(detail.peopleCount || ''),
        businessType:     detail.businessType || '',
        venueUsage:       detail.venueUsage || '',
        steps:            (detail.steps || []).map(s => ({
          id:        s.id,
          tempId:    s.id,
          stepName:  s.stepName,
          startTime: s.startTime,
          endTime:   s.endTime,
          ownerId:   s.ownerId,
          ownerName: s.ownerName,
          ownerIndex: (usersRes.data || []).findIndex(u => u.userId === s.ownerId),
        })),
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
        userList: usersRes.data || [],
      });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 通用输入
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onDateChange(e) {
    this.setData({ 'form.activityDate': e.detail.value });
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
      [`form.steps[${index}].ownerId`]:   owner.userId,
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

  // 保存修改（服务端自动生成修订日志）
  async saveEdit() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      // 清理前端临时字段，只保留数据库需要的字段
      const form = { ...this.data.form };
      if (form.steps) {
        form.steps = form.steps.map(({ tempId, ownerIndex, ...rest }) => rest);
      }
      await updateActivity(this.data.activityId, form);
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1200);
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
    this.setData({ saving: false });
  },
});
