// subpackages/admin/pages/export/export.js
const { getActivityList, exportActivities } = require('../../../../services/activity');
const { formatDate } = require('../../../../utils/format');

// 文字模板（与附件1格式对应）
const buildTextTemplate = (a) => {
  const steps = (a.steps || []).map((s, i) =>
    `${i+1}.${s.startTime}-${s.endTime} ${s.stepName}${s.venue ? ' 地点:' + s.venue : ''}${s.ownerName && s.ownerName !== '待分配' ? ' 负责人:' + s.ownerName : ''}`
  ).join('\n');

  return `时间：${a.activityDate}${a.arrivalTime ? ' ' + a.arrivalTime : ''}
活动单位：${a.activityUnit}
活动地点：${a.venue}
活动人数：${a.peopleCount}人
业务体现：${a.businessType || ''}
场地使用：${a.venueUsage || ''}
活动流程：
${steps}
结算方式：${a.settlementMethod || ''}
费用合计：${a.totalCost || ''}
活动对接人：${a.contactPerson || ''}
活动预订人：${a.bookingPerson || ''}
客户民族及宗教信仰：${(a.clientInfo||{}).ethnicity || ''}
年龄：${(a.clientInfo||{}).age || ''}
食物禁忌：${(a.clientInfo||{}).dietaryRestrictions || ''}
重要客人接待需求：${(a.clientInfo||{}).specialRequirements || ''}
场地需求：
1.是否需要搭建：${(a.venueNeeds||{}).build ? '是' : '否'}
2.是否需要预演：${(a.venueNeeds||{}).rehearsal ? '是' : '否'}
3.是否需要接电：${(a.venueNeeds||{}).power ? '是' : '否'}
4.是否有主视觉展示：${(a.venueNeeds||{}).mainVisual ? '是' : '否'}
5.是否有现场拍摄/直播：${(a.venueNeeds||{}).filming ? '是' : '否'}
发票特殊需求：${a.invoiceNeeds || ''}
香囊账户：${a.sachetAccount === 'clinic' ? '医馆账户' : a.sachetAccount === 'shop' ? '零号店账户' : '未确认'}`;
};

Page({
  data: {
    activities: [],
    selectedFormat: 'text',
    selectAll: false,
    selectedCount: 0,
    exporting: false,
    previewText: '',
    filterDate: '',
  },

  async onLoad(options) {
    wx.setNavigationBarTitle({ title: '数据导出' });
    // 默认筛选今天
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    this.setData({ filterDate: todayStr });
    await this.loadActivities(options.ids);
  },

  onDateChange(e) {
    this.setData({ filterDate: e.detail.value });
    this.loadActivities();
  },

  clearDate() {
    this.setData({ filterDate: '' });
    this.loadActivities();
  },

  async loadActivities(preSelectedIds) {
    wx.showLoading({ title: '加载中...' });
    try {
      const params = { pageSize: 200 };
      if (this.data.filterDate) {
        params.filterDate = this.data.filterDate;
        params.filterDateMode = 'specific';
      }
      const res = await getActivityList(params);
      let list;
      if (Array.isArray(res)) { list = res; }
      else if (res && Array.isArray(res.list)) { list = res.list; }
      else if (res && Array.isArray(res.data)) { list = res.data; }
      else { list = []; }
      const preIds = preSelectedIds ? preSelectedIds.split(',') : [];
      const activities = list.map(a => ({
        ...a,
        id: a._id || a.id,
        activityDate: formatDate(a.activityDate),
        selected: preIds.includes(a._id || a.id),
      }));
      const selectedCount = activities.filter(a => a.selected).length;
      this.setData({ activities, selectedCount });
      if (activities.length === 1) this.updatePreview();
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    wx.hideLoading();
  },

  selectFormat(e) {
    this.setData({ selectedFormat: e.currentTarget.dataset.format });
    if (e.currentTarget.dataset.format === 'text') this.updatePreview();
  },

  toggleSelect(e) {
    const id = e.currentTarget.dataset.id;
    const activities = this.data.activities.map(a =>
      a.id === id ? { ...a, selected: !a.selected } : a
    );
    const selectedCount = activities.filter(a => a.selected).length;
    this.setData({ activities, selectedCount, selectAll: selectedCount === activities.length });
    this.updatePreview();
  },

  toggleSelectAll(e) {
    const checked = e.detail.value;
    const activities = this.data.activities.map(a => ({ ...a, selected: checked }));
    this.setData({
      activities,
      selectAll: checked,
      selectedCount: checked ? activities.length : 0,
    });
  },

  updatePreview() {
    if (this.data.selectedFormat !== 'text') return;
    const first = this.data.activities.find(a => a.selected);
    this.setData({ previewText: first ? buildTextTemplate(first) : '' });
  },

  async doExport() {
    const ids = this.data.activities.filter(a => a.selected).map(a => a.id);
    if (!ids.length) {
      wx.showToast({ title: '请选择至少一个活动', icon: 'none' });
      return;
    }
    this.setData({ exporting: true });
    try {
      const activities = await exportActivities(this.data.selectedFormat, ids);
      // activities 是活动数组（mock 模式直接返回数组；云函数模式 callCloudFunc 已剥掉包装）
      if (this.data.selectedFormat === 'text') {
        const text = (activities || []).map(a => buildTextTemplate(a)).join('\n---\n');
        wx.setClipboardData({
          data: text,
          success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' }),
        });
      } else {
        // Excel：云函数需返回 downloadUrl；mock 模式暂不支持
        const data = activities[0] || {};
        if (data.downloadUrl) {
          wx.downloadFile({
            url: data.downloadUrl,
            success: (f) => wx.openDocument({ filePath: f.tempFilePath }),
          });
        } else {
          wx.showToast({ title: 'Excel 导出暂未实现', icon: 'none' });
        }
      }
    } catch (e) {
      wx.showToast({ title: '导出失败', icon: 'none' });
    }
    this.setData({ exporting: false });
  },
});
