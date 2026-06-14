/**
 * formBase Behavior：create 和 edit 页共用的表单基础逻辑
 * 包括：字段输入、场地需求切换、香囊账户、自定义时间选择
 */
module.exports = Behavior({
  data: {
    showTimePicker: false,
    timePickerValue: [8, 0],
    timeHours: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    timeMinutes: ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'],
    editingTimeIndex: -1,
    editingTimeField: '',
  },

  methods: {
    // 通用字段输入
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

    // 香囊是否显示
    _shouldShowSachet() {
      const f = this.data.form;
      const bizText = (f.businessType || '') + (f.venueUsage || '');
      const stepsText = (f.steps || []).map(s => (s.stepName || '')).join(' ');
      const combined = bizText + ' ' + stepsText;
      return combined.indexOf('香囊') !== -1;
    },

    // ---- 自定义时间选择器 ----

    openTimePicker(e) {
      const { index, field } = e.currentTarget.dataset;
      const step = this.data.form.steps[index];
      if (!step) return;
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
      this.setData({
        [`form.steps[${editingTimeIndex}].${editingTimeField}`]: `${h}:${m}`,
        showTimePicker: false,
      });
    },

    closeTimePicker() {
      this.setData({ showTimePicker: false });
    },
  },
});
