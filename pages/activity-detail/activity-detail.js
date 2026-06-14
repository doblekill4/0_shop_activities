// pages/activity-detail/activity-detail.js
const { getActivityDetail, getRevisionLog, uploadVoucher, deleteVoucher: svcDeleteVoucher, deleteActivity, getFileTempURL } = require('../../services/activity');
const { confirmStepDone, undoStepDone } = require('../../services/process');
const { hasPermission, isAdmin, getCurrentUser } = require('../../utils/auth');
const { formatDate, getStatusLabel } = require('../../utils/format');

// 字段名 → 中文标签（与 format.js 的 FIELD_LABEL_MAP 保持一致）
const FIELD_LABEL_MAP = {
  activityDate:    '活动日期',
  arrivalTime:     '到店时间',
  activityUnit:    '活动单位',
  venue:           '活动地点',
  peopleCount:     '活动人数',
  businessType:    '业务体现',
  venueUsage:      '场地使用',
  settlementMethod:'结算方式',
  totalCost:       '费用合计',
  contactPerson:   '活动对接人',
  bookingPerson:   '活动预订人',
  invoiceNeeds:    '发票需求',
  sachetAccount:  '香囊账户',
  clientInfo:      '客户信息',
  venueNeeds:      '场地需求',
  steps:           '活动流程环节',
  status:          '活动状态',
};

Page({
  data: {
    activityId: null,
    activity: {},
    revisions: [],
    voucherTypes: [
      { type: 'deposit',    label: '订金凭证', vouchers: [], maxCount: 1 },
      { type: 'bill',       label: '活动账单', vouchers: [], maxCount: 1 },
      { type: 'settlement', label: '结算凭证', vouchers: [], maxCount: 5 },
    ],
    doneSteps: 0,
    totalSteps: 0,
    progressPct: 0,
    canEdit: false,
    canDelete: false,
    canExport: false,
    canManageVoucher: false,  // 只有创建人可以上传/删除凭证
    isAdmin: false,
    loading: true,
  },

  onLoad(options) {
    const id = options.id;
    this._firstShow = true;  // 标记首次，避免 onShow 重复加载
    this.setData({ activityId: id, isAdmin: isAdmin() });
    wx.setNavigationBarTitle({ title: '活动详情' });
    this.loadDetail(id);
  },

  // 从其他页面返回时自动刷新（如编辑页保存后返回）
  onShow() {
    if (this._firstShow) {
      this._firstShow = false;
      return;  // 跳过 onLoad 后的首次 onShow
    }
    const id = this.data.activityId;
    if (id) {
      this.loadDetail(id);
    }
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
      // 体验版非开发者无法直接用 cloud:// URL 显示缩略图，预取临时链接
      this._resolveVoucherThumbnails();
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  // 预取凭证缩略图的临时链接（免费环境云存储权限锁定，所有版本均需代理）
  async _resolveVoucherThumbnails() {
    const voucherTypes = this.data.voucherTypes;
    // 收集所有 cloud:// 格式的 fileID
    const cloudFileIDs = [];
    voucherTypes.forEach(vt => {
      vt.vouchers.forEach(v => {
        if (v.fileID && v.fileID.startsWith('cloud://')) {
          cloudFileIDs.push(v.fileID);
        }
      });
    });
    if (cloudFileIDs.length === 0) return;
    try {
      const tempUrls = await getFileTempURL(cloudFileIDs);
      const fileList = Array.isArray(tempUrls) ? tempUrls : (tempUrls && tempUrls.data);
      if (!fileList || !fileList.length) return;
      // 构建 fileID → tempFileURL 映射
      const urlMap = {};
      fileList.forEach(item => {
        if (item.tempFileURL && item.status === 0) {
          urlMap[item.fileID] = item.tempFileURL;
        }
      });
      // 替换 voucherTypes 中对应凭证的 fileID 为临时链接（用于缩略图展示）
      // 保留 origFileID 用于全屏预览（避免临时链接过期）
      const updatedTypes = voucherTypes.map(vt => ({
        ...vt,
        vouchers: vt.vouchers.map(v => ({
          ...v,
          origFileID: v.fileID,
          fileID: urlMap[v.fileID] || v.fileID,
        })),
      }));
      this.setData({ voucherTypes: updatedTypes });
    } catch (e) {
      // 预取失败不影响页面展示，缩略图保持原 fileID
      console.warn('[_resolveVoucherThumbnails] 预取临时链接失败:', e);
    }
  },

  _applyDetail(a) {
    const currentUser = getCurrentUser();
    // 是否是本活动预定人（姓名匹配 或 openid/creatorId 匹配）
    const isOwner = currentUser && (
      (currentUser.name && currentUser.name === a.bookingPerson) ||
      (currentUser.openid && currentUser.openid === a.creatorId)
    );
    // 权限 = 权限组赋予 || 是活动预定人
    const canEdit = hasPermission('edit_activity') || isOwner;
    const canDelete = hasPermission('delete_activity') || isOwner;
    const canExport = hasPermission('export_data') || isOwner;
    const canUploadVchr = hasPermission('upload_voucher') || isOwner;
    const canManageVchr = isOwner || isAdmin();

    const statusMap = { confirmed: 'tag-active', completed: 'tag-completed', pending: 'tag-pending', settled: 'tag-settled' };

    // 处理环节（统一 id 标识：优先 _id，兼容旧数据）
    const steps = (a.steps || []).map(s => ({
      ...s,
      id: s._id || s.id || s.tempId || ('step_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8)),
      completedAtStr: s.completedAt ? formatDate(s.completedAt, true) : '',
      isCurrentUserOwner: currentUser && s.ownerId === currentUser._id,
    }));

    const doneSteps  = steps.filter(s => s.completedAt).length;
    const totalSteps = steps.length;

    // 凭证（支持每种类型多张）
    const voucherTypes = this.data.voucherTypes.map(vt => {
      const vouchers = (a.vouchers || [])
        .filter(v => v.type === vt.type)
        .map(v => ({
          voucherId: v._id,
          fileID: v.fileID,
          url: v.fileID,
          uploadTime: formatDate(v.uploadedAt, true),
        }));
      return { ...vt, vouchers };
    });

    // 香囊账户是否显示（与创建/编辑页逻辑一致）
    const showSachet = (() => {
      const bizText = (a.businessType || '') + (a.venueUsage || '');
      const stepsText = (a.steps || []).map(s => (s.stepName || '')).join(' ');
      return (bizText + ' ' + stepsText).indexOf('香囊') !== -1;
    })();

    this.setData({
      showSachet,
      activity: {
        ...a,
        activityDate: formatDate(a.activityDate),
        arrivalTime: a.arrivalTime || '',
        statusLabel: getStatusLabel(a.status),
        statusClass: statusMap[a.status] || 'tag-pending',
        steps,
        clientInfo: a.clientInfo || {},
        venueNeeds: a.venueNeeds || {},
      },
      voucherTypes,
      doneSteps,
      totalSteps,
      canEdit, canDelete, canExport, canUploadVoucher: canUploadVchr,
      progressPct: totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0,
      canManageVoucher: canManageVchr,
    });
  },

  _applyRevisions(revLog) {
    const revisions = (revLog || []).map(r => {
      const timeStr = formatDate(r.updatedAt || r.createdAt, true);
      const operator = r.updatedByName || '系统';

      // 流程环节操作（process 云函数生成的 revision，有 action 字段）
      if (r.action) {
        const detail = r.detail || {};
        let summary = '';
        switch (r.action) {
          case 'confirmStep':
            summary = `完成了环节「${detail.stepName || ''}」`;
            break;
          case 'undoConfirmStep':
            summary = `撤销了环节「${detail.stepName || ''}」的完成状态`;
            break;
          case 'addStep':
            summary = `添加了环节「${detail.stepName || ''}」`;
            break;
          case 'deleteStep':
            summary = `删除了环节「${detail.stepName || ''}」`;
            break;
          case 'updateStep':
            summary = `修改了环节「${detail.stepName || ''}」`;
            break;
          case 'assignOwner':
            summary = `将环节「${detail.stepName || ''}」指派给 ${detail.ownerName || ''}`;
            break;
          case 'uploadVoucher': {
            const vlUp = { deposit: '订金凭证', bill: '活动账单', settlement: '结算凭证' };
            summary = `上传了${vlUp[detail.voucherType] || detail.voucherType || '凭证'}`;
            break;
          }
          case 'deleteVoucher': {
            const vlDel = { deposit: '订金凭证', bill: '活动账单', settlement: '结算凭证' };
            summary = `删除了${vlDel[detail.voucherType] || detail.voucherType || '凭证'}`;
            break;
          }
          default:
            summary = `执行了操作 ${r.action}`;
        }
        return { _key: r.updatedAt + '_' + Math.random(), isProcessAction: true, operator, time: timeStr, summary };
      }

      // 活动编辑操作（activities 云函数生成的 revision，有 changes 数组）
      const lines = [];
      (r.changes || []).forEach(c => {
        const label = FIELD_LABEL_MAP[c.field] || c.field;
        const oldVal = c.old !== undefined && c.old !== null && String(c.old) !== '[object]'
          ? String(c.old) : '';
        const newVal = c.new !== undefined && c.new !== null && String(c.new) !== '[object]'
          ? String(c.new) : '';

        if (oldVal && newVal) {
          lines.push(`「${label}」从 ${oldVal} 改为 ${newVal}`);
        } else if (newVal) {
          lines.push(`设置了「${label}」为 ${newVal}`);
        } else if (oldVal) {
          lines.push(`清空了「${label}」（原值：${oldVal}）`);
        }
      });

      return {
        _key: r.updatedAt + '_' + Math.random(),
        isProcessAction: false,
        operator,
        time: timeStr,
        summary: lines.join('；') || '修改了活动信息',
      };
    });
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

  // 撤销完成
  undoStepDone(e) {
    const stepId = e.currentTarget.dataset.stepId;
    wx.showModal({
      title: '撤销完成',
      content: '将该环节恢复为未完成状态？撤销操作也会记录到修订日志。',
      success: (res) => {
        if (!res.confirm) return;
        this._doUndoStepDone(stepId);
      },
    });
  },

  async _doUndoStepDone(stepId) {
    if (this._loading) return;
    this._loading = true;
    wx.showLoading({ title: '撤销中...' });
    try {
      await undoStepDone(this.data.activityId, stepId);
      wx.hideLoading();
      wx.showToast({ title: '已撤销完成', icon: 'success' });
      this.loadDetail(this.data.activityId);
    } catch (e) {
      console.error('[doUndoStepDone] 失败:', e);
      wx.hideLoading();
      wx.showToast({ title: '操作失败：' + (e.message || e.errMsg || '未知错误'), icon: 'none', duration: 2500 });
    }
    this._loading = false;
  },

  // 上传凭证
  uploadVoucher(e) {
    const voucherType = e.currentTarget.dataset.voucherType;
    const vt = this.data.voucherTypes.find(v => v.type === voucherType);
    if (vt && vt.vouchers.length >= (vt.maxCount || 1)) {
      wx.showToast({ title: `最多上传 ${vt.maxCount} 张`, icon: 'none' });
      return;
    }
    const remaining = (vt ? vt.maxCount : 1) - (vt ? vt.vouchers.length : 0);
    wx.chooseMedia({
      count: Math.min(remaining, 5),
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        // 依次上传选中的图片
        const files = res.tempFiles;
        this._uploadBatch(voucherType, files, 0);
      },
    });
  },

  _uploadBatch(voucherType, files, index) {
    if (index >= files.length) {
      this.loadDetail(this.data.activityId);
      return;
    }
    this._doUploadVoucher(voucherType, files[index].tempFilePath, () => {
      this._uploadBatch(voucherType, files, index + 1);
    });
  },

  // 执行上传（单独提取，避免 async 回调问题）
  async _doUploadVoucher(voucherType, filePath, callback) {
    if (this._loading && !callback) return;
    if (!callback) this._loading = true;
    wx.showLoading({ title: '压缩上传中...' });
    try {
      // 压缩图片（>500KB 才压，凭证清晰度足够即可）
      let uploadPath = filePath;
      try {
        const info = await this._getFileInfo(filePath);
        if (info && info.size > 500 * 1024) {
          uploadPath = await this._compressImage(filePath);
        }
      } catch (e) { /* 压缩失败用原图 */ }
      await uploadVoucher(this.data.activityId, voucherType, uploadPath);
      wx.hideLoading();
      if (callback) { callback(); return; }
      wx.showToast({ title: '上传成功', icon: 'success' });
      this.loadDetail(this.data.activityId);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '上传失败', icon: 'none' });
      if (callback) { this.loadDetail(this.data.activityId); return; }
    }
    if (!callback) this._loading = false;
  },

  // 获取文件信息
  _getFileInfo(filePath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().getFileInfo({ filePath, success: resolve, fail: reject });
    });
  },

  // 压缩图片
  _compressImage(filePath) {
    return new Promise((resolve, reject) => {
      wx.compressImage({
        src: filePath,
        quality: 80,
        success: (res) => resolve(res.tempFilePath),
        fail: () => resolve(filePath), // 压缩失败用原图
      });
    });
  },

  // 预览凭证（通过云函数管理员权限获取临时链接，解决体验版非开发者无法预览的问题）
  previewVoucher(e) {
    const fileID = e.currentTarget.dataset.fileId;
    if (!fileID) return;
    // 非云存储路径直接预览
    if (!fileID.startsWith('cloud://')) {
      wx.previewImage({ current: fileID, urls: [fileID] });
      return;
    }
    wx.showLoading({ title: '加载图片...' });
    // 通过云函数（管理员权限）获取临时链接
    getFileTempURL([fileID])
      .then(res => {
        wx.hideLoading();
        // callCloudFunc 在成功时已剥掉 {code, data} 外层，res 直接是 data（数组）
        const fileList = Array.isArray(res) ? res : (res && res.data);
        const item = (fileList && fileList[0]);
        if (item && item.tempFileURL && item.status === 0) {
          wx.previewImage({ current: item.tempFileURL, urls: [item.tempFileURL] });
        } else {
          // 云函数兜底失败，再用客户端 SDK 尝试
          wx.cloud.downloadFile({
            fileID: fileID,
            success: (downloadRes) => {
              wx.hideLoading();
              if (downloadRes.tempFilePath) {
                wx.previewImage({ current: downloadRes.tempFilePath, urls: [downloadRes.tempFilePath] });
              } else {
                wx.showToast({ title: '预览失败，请重试', icon: 'none' });
              }
            },
            fail: () => {
              wx.hideLoading();
              wx.showToast({ title: '预览失败，请重试', icon: 'none' });
            },
          });
        }
      })
      .catch(() => {
        // 云函数不可用，降级使用客户端 SDK
        wx.cloud.downloadFile({
          fileID: fileID,
          success: (downloadRes) => {
            wx.hideLoading();
            if (downloadRes.tempFilePath) {
              wx.previewImage({ current: downloadRes.tempFilePath, urls: [downloadRes.tempFilePath] });
            } else {
              wx.showToast({ title: '预览失败，请重试', icon: 'none' });
            }
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '预览失败，请重试', icon: 'none' });
          },
        });
      });
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
    if (this._loading) return;
    this._loading = true;
    wx.showLoading({ title: '删除中...' });
    try {
      await deleteActivity(this.data.activityId);
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1200);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
    this._loading = false;
  },
});
