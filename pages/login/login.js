// pages/login/login.js（云开发版）
const { login, autoLogin } = require('../../utils/auth');

Page({
  data: {
    loading: false,
    needsRegister: false,      // 是否需要注册（新用户）
    name: '',
    department: '',
  },

  onLoad() {
    // 登录页不再自动登录，等用户点击按钮
    // autoLogin 只在 app.js 的 onLaunch 中执行
  },

  // 点击"微信一键登录"按钮
  async handleLogin() {
    if (this.data.loading) return;

    // 如果已经在注册模式，验证表单
    if (this.data.needsRegister) {
      if (!this.data.name.trim()) {
        wx.showToast({ title: '请输入姓名', icon: 'none' });
        return;
      }
      if (!this.data.department.trim()) {
        wx.showToast({ title: '请输入部门', icon: 'none' });
        return;
      }
    }

    this.setData({ loading: true });
    try {
      // needsRegister=true 时带 name+department 调用，否则不带（让云端判断是否需要注册）
      const data = this.data.needsRegister
        ? { name: this.data.name, department: this.data.department }
        : {};
      const user = await login(data);
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/activity-list/activity-list' });
      }, 1000);
    } catch (e) {
      // 如果是需要注册，显示注册表单
      if (e === '需要注册' || (typeof e === 'string' && e.includes('注册'))) {
        this.setData({ needsRegister: true });
        wx.showToast({ title: '请先完善信息', icon: 'none' });
      } else {
        wx.showToast({ title: '登录失败，请重试', icon: 'none' });
      }
    } finally {
      this.setData({ loading: false });
    }
  },

  // 输入框变更
  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },
  onDeptInput(e) {
    this.setData({ department: e.detail.value });
  },
});
