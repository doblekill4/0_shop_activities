// pages/activity-edit/activity-edit.js
const { getActivityDetail, updateActivity } = require('../../services/activity');
const { getUsers } = require('../../services/admin');
const { formatDate } = require('../../utils/format');
const { getCurrentUser, isAdmin, hasPermission } = require('../../utils/auth');
const { VENUE_LIST } = require('../../utils/constants');

const formBase = require('../../behaviors/formBase');
const stepEditor = require('../../behaviors/stepEditor');

Page({
  behaviors: [formBase, stepEditor],
  data: {
    activityId: null,
    form: {},
    originalForm: {},
    originalStatus: '',
    canAssignOwner: false,
    saving: false,
    submitting: false,
    showSachet: false,
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
