// pages/activity-detail/activity-detail.js
const { getActivityDetail, getRevisionLog, uploadVoucher, deleteVoucher: svcDeleteVoucher, deleteActivity } = require('../../services/activity');
const { confirmStepDone } = require('../../services/process');
const { hasPermission, isAdmin, getCurrentUser } = require('../../utils/auth');
const { formatDate, getStatusLabel } = require('../../utils/format');

Page({
  data: {
    activityId: null,
    activity: {},
    revisions: [],
    voucherTypes: [
      { type: 'deposit',    label: '订金凭证', uploaded: false, url: '', uploadTime: '', fileID: '' },
      { type: 'bill',       label: '活动账单', uploaded: false, url: '', uploadTime: '', fileID: '' },
      { type: 'settlement', label: '结算凭证', uploaded: false, url: '', uploadTime: '', fileID: '' },
    ],
    doneSteps: 0,
    totalSteps: 0,
    progressPct: 0,
    canEdit: false,
    canDelete: false,
    canExport: false,
    canUploadVoucher: false,
    isAdmin: false,
    loading: true,
  },

  onLoad(options) {
    const id = options.id;
    this.setData({
      activityId: id,
      canEdit: hasPermission('edit_activity'),
      canDelete: hasPermission('delete_activity'),
      canExport: hasPermission('export_data'),
      canUploadVoucher: hasPermission('upload_voucher'),
      isAdmin: isAdmin(),
    });
    wx.setNavigationBarTitle({ title: '活动详情' });
    this.loadDetail(id);
  },

  async loadDetail(id) {
    this.setData({ loading: true });
    try {
      const [detail, revLog] = await Promise.all([
        getActivityDetail(id),
        getRevisionLog(id),
      ]);
      this._applyDetail(detail);
      this._applyRevisions(revLog);
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  _applyDetail(a) {
    const currentUser = getCurrentUser();
    const statusMap = { confirmed: 'tag-active', completed: 'tag-completed', pending: 'tag-pending' };

    // 处理环节
    const steps = (a.steps || []).map(s => ({
      ...s,
      completedAtStr: s.completedAt ? formatDate(s.completedAt, true) : '',
      isCurrentUserOwner: currentUser && s.ownerId === currentUser._id,
    }));

    const doneSteps  = steps.filter(s => s.completedAt).length;
    const totalSteps = steps.length;

    // 凭证
    const voucherMap = {};
    (a.vouchers || []).forEach(v => { voucherMap[v.type] = v; });
    const voucherTypes = this.data.voucherTypes.map(vt => {
      const v = voucherMap[vt.type];
      return v
        ? { ...vt, uploaded: true, voucherId: v._id, fileID: v.fileID, url: v.fileID, uploadTime: formatDate(v.uploadedAt, true) }
        : { ...vt, uploaded: false };
    });

    this.setData({
      activity: {
        ...a,
        activityDate: formatDate(a.activityDate, true),
        statusLabel: getStatusLabel(a.status),
        statusClass: statusMap[a.status] || 'tag-pending',
        steps,
        clientInfo: a.clientInfo || {},
        venueNeeds: a.venueNeeds || {},
      },
      voucherTypes,
      doneSteps,
      totalSteps,
      progressPct: totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0,
    });
  },

  _applyRevisions(revLog) {
    // revLog 已经是数组（callCloudFunc 在 mock 模式下已剥掉外层包装）
    const revisions = (revLog || []).map(r => ({
      ...r,
      createdAtStr: formatDate(r.createdAt, true),
    }));
    this.setData({ revisions });
  },

  // 环节负责人确认完成
  confirmStepDone(e) {
    const stepId = e.currentTarget.dataset.stepId;
    wx.showModal({
      title: '确认完成',
      content: '确认该环节已完成？此操作不可撤销，将自动写入修订日志。',
      success: (res) => {
        if (!res.confirm) return;
        this._doConfirmStepDone(stepId);
      },
    });
  },

  // 执行确认完成（单独方法，避免 async success 回调问题）
  async _doConfirmStepDone(stepId) {
    if (this._loading) return;
    this._loading = true;
    wx.showLoading({ title: '提交中...' });
    try {
      await confirmStepDone(this.data.activityId, stepId);
      wx.hideLoading();
      wx.showToast({ title: '已确认完成', icon: 'success' });
      this.loadDetail(this.data.activityId);
    } catch (e) {
      console.error('[doConfirmStepDone] 失败:', e);
      wx.hideLoading();
      wx.showToast({ title: '操作失败：' + (e.message || e.errMsg || '未知错误'), icon: 'none', duration: 2500 });
    }
    this._loading = false;
  },

  // 上传凭证
  uploadVoucher(e) {
    const voucherType = e.currentTarget.dataset.voucherType;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const filePath = res.tempFiles[0].tempFilePath;
        this._doUploadVoucher(voucherType, filePath);
      },
      fail: () => {
        // 用户取消选择，不需要处理
      },
    });
  },

  // 执行上传（单独提取，避免 async 回调问题）
  async _doUploadVoucher(voucherType, filePath) {
    if (this._loading) return;
    this._loading = true;
    wx.showLoading({ title: '上传中...' });
    try {
      console.log('[doUploadVoucher] 开始上传:', voucherType);
      await uploadVoucher(this.data.activityId, voucherType, filePath);
      wx.hideLoading();
      console.log('[doUploadVoucher] 上传成功');
      wx.showToast({ title: '上传成功', icon: 'success' });
      this.loadDetail(this.data.activityId);
    } catch (e) {
      console.error('[doUploadVoucher] 上传失败:', e);
      wx.hideLoading();
      wx.showToast({ title: '上传失败：' + (e.message || e.errMsg || '未知错误'), icon: 'none', duration: 2500 });
    }
    this._loading = false;
  },

  // 预览凭证
  previewVoucher(e) {
    const fileID = e.currentTarget.dataset.fileId;
    if (!fileID) return;
    // 微信基础库 2.0+ 支持直接用 cloud:// 路径预览
    wx.previewImage({ current: fileID, urls: [fileID] });
  },

  // 删除凭证
  deleteVoucher(e) {
    const { voucherId } = e.currentTarget.dataset;
    if (!voucherId) {
      wx.showToast({ title: '删除失败：无效的凭证ID', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该凭证吗？删除后不可恢复。',
      confirmColor: '#D32F2F',
      success: (res) => {
        if (!res.confirm) return;
        this._doDeleteVoucher(voucherId);
      },
    });
  },

  // 执行删除（单独提取，避免 async 回调问题）
  async _doDeleteVoucher(fileId) {
    if (this._loading) return;
    this._loading = true;
    wx.showLoading({ title: '删除中...' });
    try {
      console.log('[doDeleteVoucher] 开始删除:', fileId);
      await svcDeleteVoucher(this.data.activityId, fileId);
      wx.hideLoading();
      console.log('[doDeleteVoucher] 删除成功');
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadDetail(this.data.activityId);
    } catch (e) {
      console.error('[doDeleteVoucher] 删除失败:', e);
      wx.hideLoading();
      wx.showToast({ title: '删除失败：' + (e.message || e.errMsg || '未知错误'), icon: 'none', duration: 2500 });
    }
    this._loading = false;
  },

  // 通知弹窗
  showNotification() {
    wx.navigateTo({
      url: `/pages/activity-detail/notification-sheet?id=${this.data.activityId}`,
    });
  },

  // 导出
  goExport() {
    wx.navigateTo({
      url: `/subpackages/admin/pages/export/export?ids=${this.data.activityId}`,
    });
  },

  // 编辑
  goEdit() {
    wx.navigateTo({
      url: `/pages/activity-edit/activity-edit?id=${this.data.activityId}`,
    });
  },

  // 删除确认
  confirmDelete() {
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复，确认删除该活动？',
      confirmColor: '#D32F2F',
      success: (res) => {
        if (!res.confirm) return;
        this._doDeleteActivity();
      },
    });
  },

  // 执行删除（单独方法，避免 async success 回调问题）
  async _doDeleteActivity() {
    try {
      await deleteActivity(this.data.activityId);
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1200);
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },
});
