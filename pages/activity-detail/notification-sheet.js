// pages/activity-detail/notification-sheet.js
// 通知弹窗：发送活动通知 + 订阅消息授权
const { getActivityDetail } = require('../../services/activity');
const { getUsers } = require('../../services/admin');
const { sendChangeNotification, requestSubscription, configureReminders } = require('../../services/notification');

// 订阅消息模板ID（需在微信后台配置后替换）
const SUBSCRIBE_TMPL_IDS = [
  'XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70',
];

Page({
  data: {
    activityId: '',
    activity: {},
    sending: false,
    subscribed: false,
  },

  onLoad(options) {
    this.setData({ activityId: options.id || '' });
    this.loadActivity();
    // 打开时自动请求订阅（非阻塞）
    setTimeout(() => this.requestSub(), 500);
  },

  async loadActivity() {
    try {
      const detail = await getActivityDetail(this.data.activityId);
      const stepOwners = (detail.steps || [])
        .filter(s => s.ownerName)
        .map(s => ({ name: s.ownerName, stepName: s.stepName }));
      const userList = await getUsers().catch(() => []);
      this.setData({
        activity: { ...detail, stepOwners, userList: userList.data || userList || [] },
      });
    } catch (e) {
      console.error('[notif-sheet] 加载失败', e);
    }
  },

  // 请求订阅消息授权
  async requestSub() {
    if (!SUBSCRIBE_TMPL_IDS[0] || SUBSCRIBE_TMPL_IDS[0].includes('PLACEHOLDER')) {
      wx.showToast({ title: '请先在代码中配置订阅消息模板ID', icon: 'none', duration: 3000 });
      return;
    }
    try {
      await requestSubscription(SUBSCRIBE_TMPL_IDS);
      this.setData({ subscribed: true });
      wx.showToast({ title: '已授权订阅消息', icon: 'success' });
    } catch (e) {
      console.log('[notif-sheet] 用户取消订阅或授权失败', e);
    }
  },

  // 发送活动变更通知
  async sendNotification() {
    if (this.data.sending) return;
    this.setData({ sending: true });
    try {
      const { activityId, activity } = this.data;
      const owners = activity.stepOwners || [];
      if (owners.length === 0) {
        wx.showToast({ title: '该活动暂无负责人', icon: 'none' });
        this.setData({ sending: false });
        return;
      }

      // 构建通知消息
      const ownerNames = owners.map(o => o.name);
      const message = `活动「${activity.activityUnit || ''}」(${activity.activityDate || ''}) 有更新，请查看`;

      await sendChangeNotification(activityId, ownerNames, message);
      wx.showToast({ title: '通知已发送', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1200);
    } catch (e) {
      console.error('[notif-sheet] 发送失败', e);
      wx.showToast({ title: '发送失败：' + (e.message || '未知错误'), icon: 'none' });
    }
    this.setData({ sending: false });
  },

  close() {
    wx.navigateBack();
  },
});
