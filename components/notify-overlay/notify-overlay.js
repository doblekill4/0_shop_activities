Component({
  data: {
    visible: false,
  },

  lifetimes: {
    attached() {
      this._check();
    },
  },

  pageLifetimes: {
    show() {
      this._check();
    },
  },

  methods: {
    _check() {
      const app = getApp();
      const user = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
      // 显式关闭 → 不显示
      if (user.notifyEnabled === false) { this.setData({ visible: false }); return; }
      // 版本不匹配 → 显示
      if (user.notifyAuthVersion && user.notifyAuthVersion !== app.globalData.appVersion) {
        this.setData({ visible: true }); return;
      }
      // 从未授权 → 显示
      this.setData({ visible: !user.notifyAuthAt });
    },

    onTap() {
      const app = getApp();
      const user = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
      const tmplIds = [
        'XrO2RLN7upLsLT513Bwv3Pz3YCCkERUuHSFNwphej70',
        'vRCdbLk5V3L1OpnyPm7M5oOUWIBJIZh7jnNi6SFRfwA',
      ];
      if (user.department === '保洁') {
        tmplIds.push('gw8f84WumXoZkBDaMErZ7YVDTna9P8jwosJf0bURSSg');
      }
      wx.requestSubscribeMessage({
        tmplIds,
        success: (res) => {
          if (tmplIds.some(id => res[id] === 'accept')) {
            // 更新 globalData
            if (app.globalData.userInfo) {
              app.globalData.userInfo.notifyAuthAt = new Date().toISOString();
              app.globalData.userInfo.notifyAuthVersion = app.globalData.appVersion;
              app.globalData.userInfo.notifyEnabled = true;
            }
            wx.cloud.callFunction({
              name: 'auth',
              data: { action: 'setNotifyEnabled', enabled: true },
            }).catch(() => {});
            wx.cloud.callFunction({
              name: 'auth',
              data: { action: 'resetNotifyCount', version: app.globalData.appVersion },
            }).catch(() => {});
            this.setData({ visible: false });
          }
        },
        fail: () => {},
      });
    },

    noop() {},
  },
});
