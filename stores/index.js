// stores/index.js - 全局状态管理（轻量级响应式 store）

const store = {
  // 活动列表缓存（已加载的正式活动）
  activities: [],
  // 甘特图视口状态
  ganttViewDate: null,
  // 通知偏好
  notificationPrefs: {},
};

const listeners = {};

const subscribe = (key, fn) => {
  if (!listeners[key]) listeners[key] = [];
  listeners[key].push(fn);
};

const notify = (key) => {
  (listeners[key] || []).forEach(fn => fn(store[key]));
};

const setState = (key, value) => {
  store[key] = value;
  notify(key);
};

const getState = (key) => store[key];

const initStore = () => {
  // 从本地缓存恢复部分状态
  const prefs = wx.getStorageSync('notification_prefs');
  if (prefs) store.notificationPrefs = prefs;
};

module.exports = { initStore, setState, getState, subscribe };
