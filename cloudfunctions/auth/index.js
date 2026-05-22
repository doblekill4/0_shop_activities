// cloudfunctions/auth/index.js - 登录认证云函数
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action } = event;

  console.log('[auth] 收到请求', { action, openid });

  try {
    switch (action) {
      case 'autoLogin':
        return await autoLogin(openid);
      case 'login':
        return await login(event, openid);
      default:
        return { code: -1, message: '未知操作' };
    }
  } catch (e) {
    console.error('[auth] 执行出错', e);
    return { code: -1, message: e.message || '登录失败' };
  }
};

/* ========== 自动登录（检查是否已注册） ========== */
async function autoLogin(openid) {
  try {
    const res = await db.collection('users').where({ openid }).get();
    if (res.data && res.data.length > 0) {
      const user = res.data[0];
      return {
        code: 0,
        data: {
          userInfo: {
            _id: user._id,
            name: user.name || '未知用户',
            department: user.department || '未分配',
            permissions: user.permissions || [],
            role: user.role || 'user',
          },
        },
        message: 'success',
      };
    }
    return { code: 401, message: '未登录' };
  } catch (e) {
    console.error('[auth.autoLogin] 数据库错误', e);
    return { code: 401, message: '未登录（数据库异常：' + e.message + '）' };
  }
}

/* ========== 登录（注册或更新） ========== */
async function login(event, openid) {
  const { name, department } = event;

  try {
    // 先检查用户是否已存在
    const existRes = await db.collection('users').where({ openid }).get();

    if (existRes.data && existRes.data.length > 0) {
      // 已存在：更新登录信息
      const user = existRes.data[0];

      // 只有王万全可以自动升级为管理员
      let needUpgrade = false;
      if (user.name === '王万全' && user.role !== 'admin') {
        try {
          const countRes = await db.collection('users').count();
          if (countRes.total <= 1) {
            needUpgrade = true;
          }
        } catch (e) {
          console.log('[auth.login] count 失败，跳过升级检查', e);
        }
      }

      const updateData = {
        lastLoginAt: db.serverDate(),
        ...(needUpgrade ? {
          role: 'admin',
          permissions: [
            'create_activity', 'edit_activity', 'delete_activity',
            'upload_voucher', 'manage_users', 'manage_departments',
            'view_all_revisions', 'export_data',
            'send_notification', 'assign_process_owner',
          ],
        } : {}),
      };
      if (name) updateData.name = name;
      if (department) updateData.department = department;

      await db.collection('users').doc(user._id).update({ data: updateData });

      // 重新获取最新数据
      const updated = await db.collection('users').doc(user._id).get();
      return {
        code: 0,
        data: {
          userInfo: {
            _id: updated.data._id,
            name: updated.data.name,
            department: updated.data.department,
            permissions: updated.data.permissions || [],
            role: updated.data.role || 'user',
          },
        },
        message: needUpgrade ? '已自动升级为管理员' : '登录成功',
      };
    } else {
      // 新用户：如果没有提供 name，返回 402 让前端弹注册表单
      if (!name || !department) {
        return { code: 402, message: '请先完善信息完成注册' };
      }

      // 只有"王万全"首次注册时才是管理员
      const isAdmin = name === '王万全';

      const newUser = {
        openid: openid,
        name: name,
        department: department,
        permissions: isAdmin
          ? [
              'create_activity', 'edit_activity', 'delete_activity',
              'upload_voucher', 'manage_users', 'manage_departments',
              'view_all_revisions', 'export_data',
              'send_notification', 'assign_process_owner',
            ]
          : ['create_activity', 'edit_activity', 'upload_voucher'],
        role: isAdmin ? 'admin' : 'user',
        createdAt: db.serverDate(),
        lastLoginAt: db.serverDate(),
      };

      const addRes = await db.collection('users').add({ data: newUser });
      console.log('[auth.login] 新用户创建成功', addRes._id);

      return {
        code: 0,
        data: {
          userInfo: {
            _id: addRes._id,
            name: newUser.name,
            department: newUser.department,
            permissions: newUser.permissions,
            role: newUser.role,
          },
        },
        message: isAdmin ? '注册成功！您已是管理员' : '注册成功',
      };
    }
  } catch (e) {
    console.error('[auth.login] 执行出错', e);
    return {
      code: -1,
      message: '注册失败：' + (e.message || '未知错误'),
      errDetail: {
        name: e.name,
        code: e.errCode || e.code,
      },
    };
  }
}
