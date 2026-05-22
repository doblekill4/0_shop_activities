// utils/request.js - 云开发版：统一云函数调用层
// =====================================================
// 开关：设为 false 可切换为纯本地 mock 模式（不依赖云函数）
// 用于云函数未全部部署时，完整跑通所有页面功能
// =====================================================
const USE_CLOUD = true;

// =====================================================
// 本地 mock 数据存储（持久化到 wx.storage）
// =====================================================
const _getMockDB = () => {
  let db = wx.getStorageSync('_mock_db');
  // 首次使用，或 activities 为空时，自动填入示例数据（方便开发调试）
  if (!db || !db.activities || db.activities.length === 0) {
    db = {
      activities: _buildSampleActivities(),
      users: _buildSampleUsers(),
      permissionGroups: _buildSamplePermissionGroups(),
      departments: _buildSampleDepartments(),
    };
    wx.setStorageSync('_mock_db', db);
  }
  // 兼容旧版 storage：缺少新字段时补全
  if (!db.permissionGroups) db.permissionGroups = _buildSamplePermissionGroups();
  if (!db.departments) db.departments = _buildSampleDepartments();
  return db;
};
const _saveMockDB = (db) => {
  wx.setStorageSync('_mock_db', db);
};

// 生成示例活动数据（含正确的 startTime，让甘特图能正确渲染）
const _buildSampleActivities = () => {
  const today = new Date();
  const d = (offset) => {
    const t = new Date(today);
    t.setDate(t.getDate() + offset);
    return t.toISOString().slice(0, 10);
  };
  return [
    {
      _id: 'mock_001',
      title: 'A公司团建活动',
      creatorId: 'user_001',
      participants: ['user_002'],
      activityUnit: 'A公司',
      activityDate: d(0),
      venue: '知嘛健康零号店',
      businessType: '团建',
      peopleCount: 30,
      bookingPerson: '张三',
      contactPerson: '李四',
      status: 'confirmed',
      steps: [
        { id: 's1', stepName: '场地布置', startTime: '08:00', endTime: '09:30', completedAt: null },
        { id: 's2', stepName: '接待签到', startTime: '09:30', endTime: '10:00', completedAt: null },
        { id: 's3', stepName: '活动开场', startTime: '10:00', endTime: '10:30', completedAt: '2026-05-11T10:25:00.000Z' },
        { id: 's4', stepName: '主题环节', startTime: '10:30', endTime: '12:00', completedAt: null },
        { id: 's5', stepName: '午餐', startTime: '12:00', endTime: '13:30', completedAt: null },
      ],
      vouchers: [{ type: 'deposit', fileID: 'mock_voucher_001', uploadedAt: new Date().toISOString() }],
      revisions: [],
      createdAt: new Date().toISOString(),
    },
    {
      _id: 'mock_002',
      title: 'B机构健康讲座',
      creatorId: 'user_002',
      participants: ['user_001'],
      activityUnit: 'B机构',
      activityDate: d(0),
      venue: '知嘛健康零号店',
      businessType: '讲座',
      peopleCount: 50,
      bookingPerson: '王五',
      contactPerson: '赵六',
      status: 'pending',
      steps: [
        { id: 's1', stepName: '设备调试', startTime: '14:00', endTime: '14:30', completedAt: null },
        { id: 's2', stepName: '签到入场', startTime: '14:30', endTime: '15:00', completedAt: null },
        { id: 's3', stepName: '讲座进行', startTime: '15:00', endTime: '16:30', completedAt: null },
      ],
      vouchers: [],
      revisions: [],
      createdAt: new Date().toISOString(),
    },
    {
      _id: 'mock_003',
      title: 'C社区义工活动',
      creatorId: 'user_003',
      participants: ['user_001', 'user_004'],
      activityUnit: 'C社区',
      activityDate: d(1),
      venue: '户外',
      businessType: '公益',
      peopleCount: 20,
      bookingPerson: '孙七',
      contactPerson: '周八',
      status: 'confirmed',
      steps: [
        { id: 's1', stepName: '集合出发', startTime: '07:00', endTime: '08:00', completedAt: null },
        { id: 's2', stepName: '现场布置', startTime: '08:00', endTime: '09:00', completedAt: null },
        { id: 's3', stepName: '活动执行', startTime: '09:00', endTime: '11:00', completedAt: null },
      ],
      vouchers: [{ type: 'deposit', fileID: 'mock_voucher_003', uploadedAt: new Date().toISOString() }],
      revisions: [],
      createdAt: new Date().toISOString(),
    },
  ];
};

const _buildSampleUsers = () => [
    { _id: 'user_001', name: '张三', role: 'admin', department: '运营部', permissionGroupId: 'pg_001' },
    { _id: 'user_002', name: '李四', role: 'user', department: '销售部', permissionGroupId: 'pg_002' },
    { _id: 'user_003', name: '王五', role: 'user', department: '销售部', permissionGroupId: 'pg_002' },
    { _id: 'user_004', name: '王万全', role: 'admin', department: '管理部', permissionGroupId: 'pg_001' },
];

// 生成示例权限组数据
const _buildSamplePermissionGroups = () => [
  {
    _id: 'pg_001',
    name: '管理员',
    permissions: [
      'create_activity', 'edit_activity', 'delete_activity',
      'upload_voucher', 'manage_users', 'manage_departments',
      'view_all_revisions', 'export_data', 'send_notification',
      'assign_process_owner',
    ],
  },
  {
    _id: 'pg_002',
    name: '销售部',
    permissions: [
      'create_activity', 'edit_activity', 'upload_voucher',
      'export_data',
    ],
  },
];

// 生成示例部门数据
const _buildSampleDepartments = () => [
  {
    _id: 'dept_001',
    name: '运营部',
    members: [
      { userId: 'user_001', name: '张三' },
    ],
  },
  {
    _id: 'dept_002',
    name: '销售部',
    members: [
      { userId: 'user_002', name: '李四' },
    ],
  },
];

/**
 * 本地 mock 数据：根据云函数名 + action 返回模拟数据
 * 返回格式与真实云函数一致：{ code: 0, data: ... }
 * 支持完整的增删改查，数据存在本地 storage 里
 */
const getMockData = (funcName, data) => {
  const { action } = data;
  console.log(`[mock] ${funcName}.${action}`, data);

  if (funcName === 'activities') {
    // ---- 获取数据库 ----
    const db = _getMockDB();
    if (!db.activities) db.activities = [];

    // ---- list：活动列表 ----
    if (action === 'list') {
      const keyword = (data.keyword || '').toLowerCase();
      let list = db.activities;
      if (keyword) {
        list = list.filter(a =>
          (a.title && a.title.toLowerCase().includes(keyword)) ||
          (a.activityUnit && a.activityUnit.toLowerCase().includes(keyword))
        );
      }
      // 按日期正序，并补全列表页需要的字段
      list = list.slice().sort((a, b) => new Date(a.activityDate) - new Date(b.activityDate));
      const formatted = list.map(a => {
        const date = new Date(a.activityDate);
        const pad = n => String(n).padStart(2, '0');
        const depositVoucher = (a.vouchers || []).some(v => v.type === 'deposit');
        const settlementVoucher = (a.vouchers || []).some(v => v.type === 'settlement');
        const billVoucher = (a.vouchers || []).some(v => v.type === 'bill');
        return {
          ...a,
          activityMonth: `${date.getMonth() + 1}月`,
          activityDay: `${date.getDate()}日`,
          activityDate: `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`,
          firstStepTime: (a.steps && a.steps[0]) ? a.steps[0].startTime : '',
          statusLabel: a.status === 'confirmed' ? '正式活动' : a.status === 'completed' ? '已结束' : '待确认',
          statusClass: a.status === 'confirmed' ? 'tag-active' : a.status === 'completed' ? 'tag-completed' : 'tag-pending',
          steps: (a.steps || []).map(s => ({
            id: s.id,
            status: s.completedAt ? 'done' : 'doing',
          })),
          activityUnit: a.activityUnit || '—',
          venue: a.venue || '—',
          businessType: a.businessType || '—',
          peopleCount: a.peopleCount || 0,
          bookingPerson: a.bookingPerson || '—',
          contactPerson: a.contactPerson || '—',
          depositVoucher,
          settlementVoucher,
          billVoucher,
        };
      });
      // ---- 权限过滤：非管理员仅看自己创建/参与的活动，以及已上传订金凭证的已确认活动 ----
      const currentUser = wx.getStorageSync('userInfo') || {};
      const role = currentUser.role || '';
      const isAdmin = role === 'admin' || role === 'manager';
      if (!isAdmin) {
        formatted = formatted.filter(a => {
          // 自己是创建者或参与者
          if (a.creatorId === currentUser._id) return true;
          if ((a.participants || []).includes(currentUser._id)) return true;
          // 已确认且已上传订金凭证（未上传的仅管理员可见）
          if (a.status === 'confirmed' && a.depositVoucher) return true;
          return false;
        });
      }

      return { code: 0, data: formatted, total: formatted.length };
    }

    // ---- detail：活动详情 ----
    if (action === 'detail') {
      const activity = db.activities.find(a => a._id === data.id);
      if (activity) return { code: 0, data: activity };
      return { code: 404, message: '活动不存在' };
    }

    // ---- revisions：修订日志 ----
    if (action === 'revisions') {
      const activity = db.activities.find(a => a._id === data.activityId);
      const revisions = (activity && activity.revisions) || [];
      return { code: 0, data: revisions };
    }

    // ---- create：新建活动 ----
    if (action === 'create') {
      const newActivity = {
        ...data.data,
        _id: 'mock_' + Date.now(),
        status: 'pending',
        vouchers: [],
        revisions: [],
        createdAt: new Date(),
      };
      db.activities.unshift(newActivity);
      _saveMockDB(db);
      return { code: 0, data: { _id: newActivity._id } };
    }

    // ---- update：更新活动（自动生成修订日志）----
    if (action === 'update') {
      const idx = db.activities.findIndex(a => a._id === data.id);
      if (idx !== -1) {
        const oldActivity = db.activities[idx];
        const newData = data.data || {};
        // 对比新旧值，生成 changes 数组
        const changes = [];
        Object.keys(newData).forEach(key => {
          if (key === 'revisions') return; // 不追踪 revisions 字段本身
          const oldVal = oldActivity[key];
          const newVal = newData[key];
          // 简单判断值是否变化（排除 undefined/null 等边界情况）
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            changes.push({
              field: key,
              oldVal: oldVal || '—',
              newVal: newVal || '—',
            });
          }
        });
        // 有变更才写修订日志
        if (changes.length > 0) {
          if (!db.activities[idx].revisions) db.activities[idx].revisions = [];
          const currentUser = wx.getStorageSync('userInfo') || {};
          db.activities[idx].revisions.unshift({
            id: 'rev_' + Date.now(),
            type: 'update',
            operatorId: currentUser._id || 'mock_user',
            operatorName: currentUser.name || '当前用户',
            createdAt: new Date().toISOString(),
            changes,
          });
        }
        // 更新活动数据
        db.activities[idx] = { ...oldActivity, ...newData };
        _saveMockDB(db);
      }
      return { code: 0, data: true };
    }

    // ---- delete：删除活动 ----
    if (action === 'delete') {
      db.activities = db.activities.filter(a => a._id !== data.id);
      _saveMockDB(db);
      return { code: 0, data: true };
    }

    // ---- deleteVoucher：删除凭证 ----
    if (action === 'deleteVoucher') {
      const activity = db.activities.find(a => a._id === data.activityId);
      if (activity && activity.vouchers) {
        activity.vouchers = activity.vouchers.filter(v => v.fileID !== data.fileID);
        _saveMockDB(db);
      }
      return { code: 0, data: true };
    }

    // ---- addVoucher：上传凭证 ----
    if (action === 'addVoucher') {
      const activity = db.activities.find(a => a._id === data.activityId);
      if (activity) {
        if (!activity.vouchers) activity.vouchers = [];
        // 去重同类型
        activity.vouchers = activity.vouchers.filter(v => v.type !== data.type);
        activity.vouchers.push({
          type: data.type,
          fileID: data.fileID,
          url: data.filePath || data.fileID,  // 使用 filePath 作为预览路径
          uploadedAt: new Date().toISOString(),
        });
        // 上传订金凭证后自动变为 confirmed
        if (data.type === 'deposit' && activity.status === 'pending') {
          activity.status = 'confirmed';
        }
        _saveMockDB(db);
      }
      return { code: 0, data: true };
    }

    // ---- gantt：甘特图数据 ----
    if (action === 'gantt') {
      const activities = (db.activities || []).filter(a => {
        if (!a.activityDate) return false;
        const d = new Date(a.activityDate);
        const actDateStr = d.toISOString().slice(0, 10);
        if (actDateStr < data.startDate || actDateStr > data.endDate) return false;
        // 默认只包含正式活动；勾选后才包含待确认
        if (!data.includePending && a.status !== 'confirmed') return false;
        return true;
      });
      return { code: 0, data: activities };
    }
  }

  if (funcName === 'admin') {
    if (action === 'getUsers') {
      const db = _getMockDB();
      return { code: 0, data: db.users || [] };
    }

    // ---- 权限组 ----
    if (action === 'getPermissionGroups') {
      const db = _getMockDB();
      return { code: 0, data: db.permissionGroups || [] };
    }
    if (action === 'createPermissionGroup') {
      const db = _getMockDB();
      const newGroup = {
        _id: 'pg_' + Date.now(),
        name: (data.data && data.data.name) || '新权限组',
        permissions: (data.data && data.data.permissions) || [],
      };
      db.permissionGroups.unshift(newGroup);
      _saveMockDB(db);
      return { code: 0, data: newGroup };
    }
    if (action === 'updatePermissionGroup') {
      const db = _getMockDB();
      const idx = db.permissionGroups.findIndex(g => g._id === data.id);
      if (idx !== -1) {
        const newPerms = (data.data && data.data.permissions) || db.permissionGroups[idx].permissions;
        db.permissionGroups[idx] = {
          ...db.permissionGroups[idx],
          name: (data.data && data.data.name) || db.permissionGroups[idx].name,
          permissions: newPerms,
        };
        _saveMockDB(db);
      }
      return { code: 0, data: true };
    }
    if (action === 'deletePermissionGroup') {
      const db = _getMockDB();
      db.permissionGroups = db.permissionGroups.filter(g => g._id !== data.id);
      _saveMockDB(db);
      return { code: 0, data: true };
    }

    // ---- 部门群组 ----
    if (action === 'getDepartments') {
      const db = _getMockDB();
      return { code: 0, data: db.departments || [] };
    }
    if (action === 'createDepartment') {
      const db = _getMockDB();
      const newDept = {
        _id: 'dept_' + Date.now(),
        name: (data.data && data.data.name) || '新部门',
        members: (data.data && data.data.members) || [],
      };
      db.departments.unshift(newDept);
      _saveMockDB(db);
      return { code: 0, data: newDept };
    }
    if (action === 'updateDepartment') {
      const db = _getMockDB();
      const idx = db.departments.findIndex(d => d._id === data.id);
      if (idx !== -1) {
        db.departments[idx] = {
          ...db.departments[idx],
          name: (data.data && data.data.name) || db.departments[idx].name,
          members: (data.data && data.data.members) || db.departments[idx].members,
        };
        _saveMockDB(db);
      }
      return { code: 0, data: true };
    }
    if (action === 'deleteDepartment') {
      const db = _getMockDB();
      db.departments = db.departments.filter(d => d._id !== data.id);
      _saveMockDB(db);
      return { code: 0, data: true };
    }
  }

  // ---- process 云函数 mock ----
  if (funcName === 'process') {
    const db = _getMockDB();
    if (!db.activities) db.activities = [];

    // confirmStep：环节确认完成
    if (action === 'confirmStep') {
      const activity = db.activities.find(a => a._id === data.activityId);
      if (activity && activity.steps) {
        const step = activity.steps.find(s => s.id === data.stepId);
        if (step) {
          step.completedAt = new Date().toISOString();
          step.ownerId = data.ownerId;
          // 记录到修订日志
          if (!activity.revisions) activity.revisions = [];
          activity.revisions.unshift({
            id: 'rev_' + Date.now(),
            type: 'step_confirm',
            stepName: step.stepName || step.title || '未知环节',
            operatorId: data.operatorId || 'mock_user',
            operatorName: data.operatorName || '当前用户',
            createdAt: new Date().toISOString(),
          });
          _saveMockDB(db);
        }
      }
      return { code: 0, data: true };
    }

    // assignOwner：指派负责人
    if (action === 'assignOwner') {
      const activity = db.activities.find(a => a._id === data.activityId);
      if (activity && activity.steps) {
        const step = activity.steps.find(s => s.id === data.stepId);
        if (step) {
          step.ownerId = data.userId;
          step.ownerName = data.userName || '未知用户';
          _saveMockDB(db);
        }
      }
      return { code: 0, data: true };
    }
  }

  // 默认返回空数据
  return { code: 0, data: [], total: 0 };
};

/**
 * 核心：封装 wx.cloud.callFunction，自动附带上登录态
 * @param {string} funcName  云函数名，如 'activities'
 * @param {object} data      传递给云函数的 data（会包含 action）
 * @returns {Promise<any>}
 */
const callCloudFunc = (funcName, data = {}) => {
  // ---- 本地 mock 模式 ----
  if (!USE_CLOUD) {
    return new Promise((resolve) => {
      // 模拟网络延迟（100-300ms）
      setTimeout(() => {
        const result = getMockData(funcName, data);
        // 与云函数行为一致：剥掉外层包装，只返回 data
        resolve(result.data);
      }, 100 + Math.random() * 200);
    });
  }

  // ---- 云函数模式 ----
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: funcName,
      data,
      success: (res) => {
        const result = res.result;
        if (result && result.code === 0) {
          resolve(result.data);
        } else {
          const msg = (result && result.message) || '服务异常，请稍后重试';
          wx.showToast({ title: msg, icon: 'none', duration: 2500 });
          reject({ code: (result && result.code) || -1, message: msg, detail: result });
        }
      },
      fail: (err) => {
        console.error(`[cloud.${funcName}] fail`, err);
        const isTimeout = err.errMsg && err.errMsg.includes('timeout');
        const msg = isTimeout
          ? `云函数 ${funcName} 调用超时，请检查云函数是否已部署`
          : '网络连接失败，请检查网络';
        wx.showToast({ title: msg, icon: 'none', duration: 2500 });
        reject({ code: -1, message: msg, detail: err });
      },
    });
  });
};

/**
 * 文件上传到云存储（替代 HTTP 上传）
 * @param {string} filePath  本地临时文件路径
 * @param {string} cloudPath 云存储路径，如 'vouchers/2026/05/abc.png'
 * @returns {Promise<{fileID: string}>}
 */
const uploadFile = (filePath, cloudPath) => {
  // ---- 本地 mock 模式 ----
  if (!USE_CLOUD) {
    return new Promise((resolve) => {
      setTimeout(() => {
        // 返回真实临时文件路径，让图片组件能显示预览
        resolve({ fileID: filePath || 'mock_file_' + Date.now() });
      }, 200);
    });
  }
  return wx.cloud.uploadFile({
    cloudPath,
    filePath,
  });
};

/**
 * 获取云文件临时 URL（用于展示）
 * @param {string[]} fileIDs 云文件 ID 数组
 * @returns {Promise<Array<{fileID:string, tempFileURL:string}>>}
 */
const getTempFileURL = (fileIDs) => {
  // ---- 本地 mock 模式 ----
  if (!USE_CLOUD) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(fileIDs.map(id => ({
          fileID: id,
          tempFileURL: 'https://mock-url.example.com/' + id,
        })));
      }, 100);
    });
  }
  return wx.cloud.getTempFileURL({
    fileList: fileIDs,
  }).then(res => res.fileList);
};

module.exports = {
  callCloudFunc,
  uploadFile,
  getTempFileURL,
};
