// behaviors/formBase.js
// create/edit 共用的表单基础逻辑
module.exports = Behavior({
  data: {
    showTimePicker: false,
    timePickerValue: [8, 0],
    timeHours: [],
    timeMinutes: ['00','05','10','15','20','25','30','35','40','45','50','55'],
    editingTimeIndex: -1,
    editingTimeField: '',
  },

  lifetimes: {
    attached() {
      var h = [];
      for (var i = 0; i < 24; i++) h.push(String(i).padStart(2, '0'));
      this.setData({ timeHours: h });
    },
  },

  methods: {
    onInput: function (e) {
      var field = e.currentTarget.dataset.field;
      this.setData({ ['form.' + field]: e.detail.value });
      if (field === 'businessType' || field === 'venueUsage') {
        this.setData({ showSachet: this._shouldShowSachet() });
      }
    },

    onDateChange: function (e) {
      this.setData({ 'form.activityDate': e.detail.value });
    },

    onArrivalTimeChange: function (e) {
      this.setData({ 'form.arrivalTime': e.detail.value });
    },

    onClientInput: function (e) {
      var field = e.currentTarget.dataset.field;
      this.setData({ ['form.clientInfo.' + field]: e.detail.value });
    },

    toggleNeed: function (e) {
      var field = e.currentTarget.dataset.field;
      var cur = this.data.form.venueNeeds[field];
      this.setData({ ['form.venueNeeds.' + field]: !cur });
    },

    setSachet: function (e) {
      this.setData({ 'form.sachetAccount': e.currentTarget.dataset.val });
    },

    _shouldShowSachet: function () {
      var f = this.data.form;
      var biz = (f.businessType || '') + (f.venueUsage || '');
      var stepsText = (f.steps || []).map(function (s) { return s.stepName || ''; }).join(' ');
      return (biz + ' ' + stepsText).indexOf('香囊') !== -1;
    },

    openTimePicker: function (e) {
      var d = e.currentTarget.dataset;
      var step = this.data.form.steps[d.index];
      if (!step) return;
      var ts = step[d.field];
      if (!ts && d.field === 'endTime' && step.startTime) ts = step.startTime;
      if (!ts) ts = '08:00';
      var p = ts.split(':');
      var h = parseInt(p[0]) || 8;
      var m = parseInt(p[1]) || 0;
      var mi = this.data.timeMinutes.indexOf(String(m).padStart(2, '0'));
      this.setData({
        showTimePicker: true,
        editingTimeIndex: Number(d.index),
        editingTimeField: d.field,
        timePickerValue: [h, mi >= 0 ? mi : 0],
      });
    },

    onTimePickerChange: function (e) {
      this.setData({ timePickerValue: e.detail.value });
    },

    confirmTimePicker: function () {
      var d = this.data;
      if (d.editingTimeIndex < 0 || !d.editingTimeField) return;
      var h = d.timeHours[d.timePickerValue[0]];
      var m = d.timeMinutes[d.timePickerValue[1]];
      this.setData({
        ['form.steps[' + d.editingTimeIndex + '].' + d.editingTimeField]: h + ':' + m,
        showTimePicker: false,
      });
    },

    closeTimePicker: function () {
      this.setData({ showTimePicker: false });
    },
  },
});
