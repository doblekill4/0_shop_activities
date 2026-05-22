const { login } = require('../../utils/auth');

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    }
  },

  data: {
    name: '',
    department: '',
    loading: false
  },

  methods: {
    onNameInput(e) {
      this.setData({ name: e.detail.value });
    },

    onDeptInput(e) {
      this.setData({ department: e.detail.value });
    },

    async handleRegister() {
      if (this.data.loading) return;
      const { name, department } = this.data;
      
      if (!name.trim()) {
        wx.showToast({ title: '请输入姓名', icon: 'none' });
        return;
      }
      if (!department.trim()) {
        wx.showToast({ title: '请输入部门', icon: 'none' });
        return;
      }

      this.setData({ loading: true });
      try {
        const user = await login({ name, department });
        wx.showToast({ title: '注册成功', icon: 'success' });
        this.triggerEvent('success', { user });
      } catch (e) {
        // 显示云端返回的真实错误信息
        const msg = typeof e === 'string' ? e : (e.message || '注册失败');
        wx.showToast({ title: msg, icon: 'none', duration: 2500 });
      }
      this.setData({ loading: false });
    }
  }
});