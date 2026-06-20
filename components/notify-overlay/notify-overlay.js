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
      if (user.notifyEnabled === false) { this.setData({ visible: false, reason: '' }); return; }
      // 仅版本不匹配时显示（不判断未授权，避免干扰手动关闭的用户）
      if (user.notifyAuthVersion && user.notifyAuthVersion !== app.globalData.appVersion) {
        this.setData({ visible: true, reason: '版本已更新' }); return;
      }
      this.setData({ visible: false, reason: '' });
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
            // 更新 globalData + Storage
            if (app.globalData.userInfo) {
              app.globalData.userInfo.notifyAuthAt = new Date().toISOString();
              app.globalData.userInfo.notifyAuthVersion = app.globalData.appVersion;
              app.globalData.userInfo.notifyEnabled = true;
            }
            const cached = wx.getStorageSync('userInfo');
            if (cached) {
              cached.notifyAuthAt = new Date().toISOString();
              cached.notifyAuthVersion = app.globalData.appVersion;
              cached.notifyEnabled = true;
              wx.setStorageSync('userInfo', cached);
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
