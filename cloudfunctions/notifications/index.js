// cloudfunctions/notifications/index.js - 通知功能云函数
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    switch (event.action) {
      case 'sendChange':
        return await sendChangeNotification(event, openid);
      case 'configureReminders':
        return await configureReminders(event, openid);
      case 'getHistory':
        return await getNotificationHistory(event, openid);
      default:
        return { code: -1, message: '未知操作' };
    }
  } catch (e) {
    console.error('[notifications] error', e);
    return { code: -1, message: e.message || '服务异常' };
  }
};

/* ========== 发送变更通知 ========== */
async function sendChangeNotification(event, openid) {
  const { activityId, groupIds, message } = event;

  // 获取活动信息
  const actRes = await db.collection('activities').doc(activityId).get();
  if (!actRes.data) return { code: 404, message: '活动不存在' };

  // 获取目标用户
  const usersRes = await db.collection('users')
    .where({ department: _.in(groupIds) })
    .get();

  const notifications = usersRes.data.map(user => ({
    userId: user._id,
    openid: user.openid,
    activityId,
    activityName: actRes.data.name,
    message,
    isRead: false,
    createdAt: new Date(),
  }));

  // 批量插入通知记录
  if (notifications.length > 0) {
    await db.collection('notifications').add(notifications);
  }

  return { code: 0, data: { sentCount: notifications.length }, message: '通知已发送' };
}

/* ========== 配置提醒规则 ========== */
async function configureReminders(event, openid) {
  const { activityId, rules } = event;

  await db.collection('activities').doc(activityId).update({
    data: {
      reminderRules: rules,
      updatedAt: new Date(),
    }
  });

  return { code: 0, message: '提醒规则已更新' };
}

/* ========== 获取通知历史 ========== */
async function getNotificationHistory(event, openid) {
  const { activityId } = event;

  const res = await db.collection('notifications')
    .where({ activityId })
    .orderBy('createdAt', 'desc')
    .get();

  return { code: 0, data: res.data, message: 'success' };
}
