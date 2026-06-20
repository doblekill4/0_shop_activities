// pages/activity-detail/notification-sheet.js
// 通知弹窗：发送活动通知 + 订阅消息授权
const { getActivityDetail } = require('../../services/activity');
const { getUsers } = require('../../services/admin');
const { sendChangeNotification } = require('../../services/notification');

// 订阅消息模板ID
const SUBSCRIBE_TMPL_IDS = [
  'XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70',            // 定时提醒
  'gw8f84WumXoZkBDaMErZ7YVDTna9P8jwosJf0bURSSg',            // 清洁任务提醒
  'vRCdbLk5V3L1OpnyPm7M5oOUWIBJIZh7jnNi6SFRfwA',            // 活动状态变更通知
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
    // 不再自动弹授权，改为发送前弹
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

  // 请求订阅消息授权（必须由用户点击触发）
  requestSub() {
    if (!SUBSCRIBE_TMPL_IDS[0]) return;
    wx.requestSubscribeMessage({
      tmplIds: SUBSCRIBE_TMPL_IDS,
      success: (res) => {
        const accepted = SUBSCRIBE_TMPL_IDS.filter(id => res[id] === 'accept');
        if (accepted.length > 0) {
          this.setData({ subscribed: true });
          wx.showToast({ title: '已授权订阅消息', icon: 'success' });
        } else {
          wx.showToast({ title: '需要授权后才能收到通知', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '授权失败，请稍后重试', icon: 'none' });
      },
    });
  },

  // 发送活动变更通知
  async sendNotification() {
    if (this.data.sending) return;

    // 未授权 → 先弹出授权弹窗
    if (!this.data.subscribed) {
      wx.requestSubscribeMessage({
        tmplIds: SUBSCRIBE_TMPL_IDS,
        success: (res) => {
          const accepted = SUBSCRIBE_TMPL_IDS.filter(id => res[id] === 'accept');
          if (accepted.length > 0) {
            this.setData({ subscribed: true });
            this._doSend();
          } else {
            wx.showToast({ title: '需要授权后才能发送通知', icon: 'none' });
          }
        },
        fail: () => {
          wx.showToast({ title: '授权失败，请稍后重试', icon: 'none' });
        },
      });
      return;
    }

    this._doSend();
  },

  async _doSend() {
    this.setData({ sending: true });
    try {
      const { activityId, activity } = this.data;
      const owners = activity.stepOwners || [];
      if (owners.length === 0) {
        wx.showToast({ title: '该活动暂无负责人', icon: 'none' });
        this.setData({ sending: false });
        return;
      }

      const ownerNames = owners.map(o => o.name);
      const dateStr = activity.activityDate ? activity.activityDate.slice(5).replace('-','月') + '日' : '今日';
      const message = `${dateStr}「${activity.activityUnit || ''}」有您负责的环节，请留意`;

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
