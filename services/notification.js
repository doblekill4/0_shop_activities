// services/notification.js - 通知服务层（云开发版）
const { callCloudFunc } = require('../utils/request');

/**
 * 发送部门群组变更通知
 * @param {string}   activityId  - 活动 ID
 * @param {string[]} groupIds    - 目标部门群组 ID
 * @param {string}   message     - 通知内容
 */
const sendChangeNotification = (activityId, groupIds, message) => {
  return callCloudFunc('notifications', { action: 'sendChange', activityId, groupIds, message });
};

/**
 * 配置活动定时提醒
 * @param {string}   activityId
 * @param {object[]} rules - [{ type:'before'|'after', minutes:30, targetType:'user'|'group', targetIds:[] }]
 */
const configureReminders = (activityId, rules) => {
  return callCloudFunc('notifications', { action: 'configureReminders', activityId, rules });
};

/**
 * 请求订阅消息授权（微信订阅消息）
 * @param {string[]} tmplIds - 订阅消息模板 ID 列表
 */
const requestSubscription = (tmplIds) => {
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds,
      success: (res) => {
        const accepted = tmplIds.filter(id => res[id] === 'accept');
        resolve({ accepted });
      },
      fail: () => resolve({ accepted: [] }),
    });
  });
};

/**
 * 获取通知历史记录
 */
const getNotificationHistory = (activityId) => {
  return callCloudFunc('notifications', { action: 'getHistory', activityId });
};

module.exports = {
  sendChangeNotification,
  configureReminders,
  requestSubscription,
  getNotificationHistory,
};
