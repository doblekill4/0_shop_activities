// cloudfunctions/auth/index.js - 登录认证云函数
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 审核模式：仅体验版/开发版生效，正式版不受影响
const REVIEW_MODE_ENABLED = process.env.REVIEW_MODE === 'true';
function isReviewMode(event) {
  if (!REVIEW_MODE_ENABLED) return false;
  const env = (event || {}).miniprogramEnv || '';
  return env === 'trial' || env === 'develop';
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action } = event;

  console.log('[auth] 收到请求', { action, openid });

  try {
    switch (action) {
      case 'autoLogin':
        return await autoLogin(openid, event);
      case 'checkReviewMode':
        return { code: 0, data: { reviewMode: isReviewMode(event) }, message: 'ok' };
      case 'reviewLogin':
        return await reviewLogin();
      case 'login':
        return await login(event, openid);
      case 'listDepartments':
        return await listDepartments();
      case 'getPublicUserList':
        return await getPublicUserList();
      case 'activateStoreGroup':
        return await activateStoreGroup(openid);
      case 'resetStoreGroup':
        return await resetStoreGroup(openid);
      case 'setNotifyEnabled':
        return await setNotifyEnabled(openid, event.enabled);
      case 'resetNotifyCount':
        return await resetNotifyCount(openid, event.version);
      case 'listUsers':
        return await listUsers();
      case 'setUserStatus':
        return await setUserStatus(event, openid);
      default:
        return { code: -1, message: '未知操作' };
    }
  } catch (e) {
    console.error('[auth] 执行出错', e);
    return { code: -1, message: e.message || '登录失败' };
  }
};

/* ========== 审核专用登录（合成 openid，不占用真实用户 openid） ========== */
async function reviewLogin() {
  const SYNTHETIC_ID = '_review_admin';
  try {
    const res = await db.collection('users').where({ openid: SYNTHETIC_ID }).get();
    let user;
    if (res.data && res.data.length > 0) {
      user = res.data[0];
      await db.collection('users').doc(user._id).update({
        data: { lastLoginAt: db.serverDate() },
      });
    } else {
      const addRes = await db.collection('users').add({
        data: {
          openid: SYNTHETIC_ID,
          name: '审核测试',
          nickname: '审核测试',
          department: '管理部',
          role: 'admin',
          permissions: [
            'create_activity', 'edit_activity', 'delete_activity',
            'upload_voucher', 'manage_users', 'manage_departments',
            'view_all_revisions', 'export_data',
            'send_notification', 'assign_process_owner', 'set_capacity_limit',
          ],
          notifyEnabled: true,
          createdAt: db.serverDate(),
          lastLoginAt: db.serverDate(),
        },
      });
      user = { _id: addRes._id, openid: SYNTHETIC_ID, name: '审核测试', nickname: '审核测试', department: '管理部', role: 'admin', permissions: [], notifyEnabled: true };
      user.permissions = [
        'create_activity', 'edit_activity', 'delete_activity',
        'upload_voucher', 'manage_users', 'manage_departments',
        'view_all_revisions', 'export_data',
        'send_notification', 'assign_process_owner', 'set_capacity_limit',
      ];
    }
    return { code: 0, data: { userInfo: user }, message: 'success' };
  } catch (e) {
    return { code: -1, message: '审核登录失败：' + (e.message || '') };
  }
}

/* ========== 权限合并（管理员补全 + 部门权限组） ========== */
async function mergePermissions(user) {
  let perms = [...(user.permissions || [])];
  // 管理员自动补全权限
  if (user.role === 'admin') {
    const adminPerms = [
      'create_activity', 'edit_activity', 'delete_activity',
      'upload_voucher', 'manage_users', 'manage_departments',
      'view_all_revisions', 'export_data',
      'send_notification', 'assign_process_owner', 'set_capacity_limit',
    ];
    const missing = adminPerms.filter(p => !perms.includes(p));
    if (missing.length > 0) {
      perms = [...perms, ...missing];
      await db.collection('users').doc(user._id).update({ data: { permissions: perms } }).catch(() => {});
    }
  }
  // 合并部门权限组
  if (user.department) {
    try {
      const deptRes = await db.collection('departments')
        .where({ name: user.department }).get();
      if (deptRes.data && deptRes.data.length > 0 && deptRes.data[0].permissionGroupId) {
        const pgRes = await db.collection('permission_groups')
          .doc(deptRes.data[0].permissionGroupId).get();
        if (pgRes.data && Array.isArray(pgRes.data.permissions)) {
          perms = [...new Set([...perms, ...pgRes.data.permissions])];
        }
      }
    } catch (e) {
      console.warn('[mergePermissions] 部门权限合并失败', e.message);
    }
  }
  return perms;
}

/* ========== 自动登录（检查是否已注册） ========== */
async function autoLogin(openid, event = {}) {
  try {
    // 已注册用户从群入口打开时，尝试设定/刷新白名单
    const storeGroupExists = await checkStoreGroupExists();
    if (!storeGroupExists && event.groupEncryptedData && event.groupIv) {
      console.log('[autoLogin] 白名单未设定，尝试从群入口登记');
      await verifyStoreGroup(event.groupEncryptedData, event.groupIv, openid, '');
    }

    const res = await db.collection('users').where({ openid }).get();
    if (res.data && res.data.length > 0) {
      const user = res.data[0];
      // 拦截已离职员工
      if (user.status === 'inactive') {
        console.log('[autoLogin] 用户已离职，拒绝登录:', user.name);
        return { code: 403, message: '账号已停用，请联系管理员' };
      }
      // 审核模式关闭后，清退审核测试账号
      if (!isReviewMode(event) && user.name === '审核测试') {
        console.log('[autoLogin] 审核模式已关闭，拒绝审核测试账号');
        return { code: 401, message: '审核已结束，不再允许测试登录' };
      }
      // 合并权限（管理员补全 + 部门权限组）
      const permissions = await mergePermissions(user);
      return {
        code: 0,
        data: {
          reviewMode: isReviewMode(event),
          userInfo: {
            _id: user._id,
            openid: user.openid || openid,
            name: user.name || '未知用户',
            nickname: user.nickname || '',
            department: user.department || '未分配',
            avatarUrl: user.avatarUrl || '',
            employeeId: user.employeeId || '',
            permissions,
            role: user.role || 'user',
            notifyEnabled: user.notifyEnabled !== false,
            notifyAuthVersion: user.notifyAuthVersion || '',
            notifyAuthAt: user.notifyAuthAt || '',
            notifySentCount: user.notifySentCount || 0,
            notifyLastError: user.notifyLastError || '',
          },
        },
        message: 'success',
      };
    }
    return { code: 401, message: '未登录', data: { reviewMode: isReviewMode(event) } };
  } catch (e) {
    console.error('[auth.autoLogin] 数据库错误', e);
    return { code: 401, message: '未登录（数据库异常：' + e.message + '）' };
  }
}

/* ========== 登录（注册或更新） ========== */
async function login(event, openid) {
  const { name, department, nickname, avatarUrl, employeeId, role, fromGroup, groupEncryptedData, groupIv, scene } = event;
  // 体验版 getGroupEnterInfo 可能无加密数据，用 scene 兜底
  const fromGroupScene = !fromGroup && scene === 1044;
  const effectiveFromGroup = fromGroup || fromGroupScene;

  try {
    // 先检查用户是否已存在
    const existRes = await db.collection('users').where({ openid }).get();

    if (existRes.data && existRes.data.length > 0) {
      // 已存在：更新登录信息
      const user = existRes.data[0];

      // 拦截已离职员工
      if (user.status === 'inactive') {
        console.log('[auth.login] 用户已离职，拒绝登录:', user.name);
        return { code: 403, message: '账号已停用，请联系管理员' };
      }

      // 审核测试号（合成 openid 用户）不允许正常入口登录
      if (user.name === '审核测试') {
        console.log('[auth.login] 审核测试号拒绝正常入口登录');
        return { code: 402, message: '请使用审核快捷通道登录' };
      }

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
            'send_notification', 'assign_process_owner', 'set_capacity_limit',
          ],
        } : {}),
      };
      // 已存在用户：仅首次注册时设置，登录时跳过（防审核快捷入口覆盖）
      if (!user.lastLoginAt) {
        if (name) updateData.name = name;
        if (department) updateData.department = department;
        if (nickname) updateData.nickname = nickname;
        if (avatarUrl) updateData.avatarUrl = avatarUrl;
        if (employeeId) updateData.employeeId = employeeId;
      }

      await db.collection('users').doc(user._id).update({ data: updateData });

      // 重新获取最新数据
      const updated = await db.collection('users').doc(user._id).get();
      return {
        code: 0,
        data: {
          userInfo: {
            _id: updated.data._id,
            openid: updated.data.openid || openid,
            name: updated.data.name,
            nickname: updated.data.nickname || '',
            department: updated.data.department,
            avatarUrl: updated.data.avatarUrl || '',
            employeeId: updated.data.employeeId || '',
            permissions: await mergePermissions(updated.data),
            role: updated.data.role || 'user',
            notifyEnabled: updated.data.notifyEnabled !== false,
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

      // 验证群入口：解密获取 openGId，与已存储的门店群ID比对
      let verifiedStoreGroup = false;
      if (groupEncryptedData && groupIv) {
        verifiedStoreGroup = await verifyStoreGroup(groupEncryptedData, groupIv, openid, name);
        console.log('[auth.login] 群验证结果:', verifiedStoreGroup);
      } else if (effectiveFromGroup && !groupEncryptedData) {
        // 体验版 fallback：scene 确认从群进但无加密数据 → 不能验证具体群，只能确认来自群
        console.log('[auth.login] 体验版群入口（无加密数据），scene=' + scene);
      }

      // 门店群白名单拦截：审核模式下跳过
      if (!isReviewMode(event)) {
        const storeGroupExists = await checkStoreGroupExists();
        if (storeGroupExists && !effectiveFromGroup) {
          console.log('[auth.login] 门店群已登记，非群入口注册被拒');
          return { code: 403, message: '仅限门店群成员注册，请从群聊中打开小程序' };
        }
      }

      // 最终角色：admin > 门店群验证通过 > user
      const finalRole = isAdmin ? 'admin'
        : verifiedStoreGroup ? 'employee'
        : 'user';

      console.log('[auth.login] 新用户角色:', finalRole,
        'fromGroup:', !!fromGroup, 'verified:', verifiedStoreGroup);

      // 员工权限比普通用户多
      const employeePermissions = [
        'create_activity', 'edit_activity', 'upload_voucher',
        'confirm_step', 'send_notification',
      ];

      const newUser = {
        openid: openid,
        name: name,
        nickname: nickname || name,
        department: department,
        avatarUrl: avatarUrl || '',
        employeeId: employeeId || '',
        permissions: isAdmin
          ? [
              'create_activity', 'edit_activity', 'delete_activity',
              'upload_voucher', 'manage_users', 'manage_departments',
              'view_all_revisions', 'export_data',
              'send_notification', 'assign_process_owner', 'set_capacity_limit',
            ]
          : (finalRole === 'employee') ? employeePermissions
          : ['create_activity'],
        role: finalRole,
        createdAt: db.serverDate(),
        lastLoginAt: db.serverDate(),
      };

      const addRes = await db.collection('users').add({ data: newUser });
      console.log('[auth.login] 新用户创建成功', addRes._id,
        'role:', finalRole);

      return {
        code: 0,
        data: {
          userInfo: {
            _id: addRes._id,
            openid: openid,
            name: newUser.name,
            nickname: newUser.nickname || '',
            department: newUser.department,
            avatarUrl: newUser.avatarUrl || '',
            employeeId: newUser.employeeId || '',
            permissions: await mergePermissions(newUser),
            role: newUser.role,
            notifyEnabled: true,
          },
        },
        message: finalRole === 'admin' ? '注册成功！您已是管理员'
          : finalRole === 'employee' ? '注册成功！已识别为门店员工'
          : '注册成功',
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

/* ========== 公开用户列表（仅 _id + name，无权限要求） ========== */
async function getPublicUserList() {
  try {
    const res = await db.collection('users')
      .field({ name: true, department: true })
      .limit(200)
      .get();
    return { code: 0, data: res.data || [], message: 'success' };
  } catch (e) {
    console.error('[getPublicUserList] 失败', e);
    return { code: -1, message: '获取失败' };
  }
}

/* ========== 手动激活门店群白名单（体验版/环境受限时兜底） ========== */
async function activateStoreGroup(openid) {
  try {
    const userRes = await db.collection('users').where({ openid }).get();
    const user = userRes.data && userRes.data[0];
    if (!user || user.name !== '王万全') {
      return { code: 403, message: '仅王万全可操作' };
    }
    let exist = { data: [] };
    try {
      exist = await db.collection('settings').where({ key: 'store_group_id' }).get();
    } catch (e) {
      if (!String(e.message || '').includes('not exists')) throw e;
    }
    if (exist.data && exist.data.length > 0) {
      return { code: 0, message: '白名单已存在，无需重复激活' };
    }
    await db.collection('settings').add({
      data: {
        key: 'store_group_id',
        value: 'manual_activated',
        createdBy: openid,
        createdAt: db.serverDate(),
      },
    });
    console.log('[activateStoreGroup] 手动激活白名单（value=manual_activated）');
    return { code: 0, message: '已激活，群密码比对降级为放行' };
  } catch (e) {
    return { code: -1, message: '激活失败：' + (e.message || '') };
  }
}

/* ========== 重置门店群白名单（管理员操作） ========== */
async function resetStoreGroup(openid) {
  try {
    console.log('[resetStoreGroup] 操作者 openid:', openid);
    // 仅王万全可操作
    const userRes = await db.collection('users').where({ openid }).get();
    const user = userRes.data && userRes.data[0];
    console.log('[resetStoreGroup] 查询到用户:', user ? user.name : '无', 'role:', user ? user.role : '');
    if (!user || user.name !== '王万全') {
      return { code: 403, message: '仅王万全可重置门店群（当前：' + (user ? user.name : '未识别') + '）' };
    }

    // 删除已有的白名单记录
    let res;
    try {
      res = await db.collection('settings')
        .where({ key: 'store_group_id' }).get();
    } catch (e) {
      // settings 集合可能尚未创建
      console.log('[resetStoreGroup] settings 集合查询失败（可能未创建）:', e.message);
      return { code: 0, message: '当前无门店群白名单（settings集合未初始化），无需重置' };
    }

    if (res.data && res.data.length > 0) {
      await db.collection('settings').doc(res.data[0]._id).remove();
      console.log('[resetStoreGroup] 已清除门店群白名单');
      return { code: 0, message: '已重置，下次从群进入时将重新登记' };
    }

    return { code: 0, message: '当前无门店群白名单，无需重置' };
  } catch (e) {
    console.error('[resetStoreGroup] 失败:', e.message, e.stack);
    return { code: -1, message: '操作失败：' + (e.message || '未知') };
  }
}

/* ========== 获取部门列表（公开接口，无需登录） ========== */
async function listDepartments() {
  try {
    const res = await db.collection('departments').get();
    return {
      code: 0,
      data: res.data || [],
      message: 'success',
    };
  } catch (e) {
    console.error('[auth.listDepartments] 失败', e);
    return { code: -1, message: '获取部门列表失败' };
  }
}

/* ========== 设置通知开关（写入用户文档） ========== */
async function setNotifyEnabled(openid, enabled) {
  try {
    await db.collection('users').where({ openid }).update({
      data: { notifyEnabled: !!enabled }
    });
    return { code: 0, message: '已更新' };
  } catch (e) {
    console.error('[setNotifyEnabled] 失败', e);
    return { code: -1, message: '更新失败' };
  }
}

/* ========== 重置通知计数（授权成功后调用） ========== */
async function resetNotifyCount(openid, version) {
  try {
    await db.collection('users').where({ openid }).update({
      data: {
        notifyAuthAt: new Date(),
        notifyAuthVersion: version || '',
        notifySentCount: 0,
        notifyLastError: '',
      }
    });
    return { code: 0, message: '已重置' };
  } catch (e) {
    console.error('[resetNotifyCount] 失败', e);
    return { code: -1, message: '重置失败' };
  }
}

/* ========== 检查门店群是否已登记 ========== */
async function checkStoreGroupExists() {
  try {
    const res = await db.collection('settings')
      .where({ key: 'store_group_id' }).get();
    return res.data && res.data.length > 0;
  } catch (e) {
    return false;
  }
}

/* ========== 验证门店群（解密 + 白名单比对） ========== */
async function verifyStoreGroup(encryptedData, iv, openid, userName) {
  try {
    // 使用 cloud.openData 解密群入口信息（利用云函数上下文中的 session key）
    const openResult = await cloud.openData({
      list: [{ encryptedData, iv }],
    });

    if (!openResult || !openResult.list || !openResult.list[0]) {
      console.warn('[verifyStoreGroup] 解密无返回数据');
      return false;
    }

    const decrypted = openResult.list[0];
    const openGId = decrypted.openGId || (decrypted.data && decrypted.data.openGId) || '';
    if (!openGId) {
      console.warn('[verifyStoreGroup] 解密结果中无 openGId');
      return false;
    }
    console.log('[verifyStoreGroup] 解密成功, openGId:', openGId);

    // 查询已存储的门店群ID
    let settingsRes;
    try {
      settingsRes = await db.collection('settings')
        .where({ key: 'store_group_id' }).get();
    } catch (e) {
      settingsRes = { data: [] };
    }

    if (!settingsRes.data || settingsRes.data.length === 0) {
      // 白名单未设定 → 仅王万全从群入口可激活，之后持久化，直到手动重置
      if (userName === '王万全') {
        try {
          await db.collection('settings').add({
            data: {
              key: 'store_group_id',
              value: openGId,
              createdBy: openid,
              createdAt: db.serverDate(),
            },
          });
          console.log('[verifyStoreGroup] ✅ 王万全激活门店群白名单');
          return true;
        } catch (e) {
          console.error('[verifyStoreGroup] 存储白名单失败:', e.message);
        }
      } else {
        console.log('[verifyStoreGroup] ⚠ 白名单未设定，仅王万全从群入口可激活');
      }
      return false;
    }

    // 比对
    const stored = settingsRes.data[0].value;
    // 手动激活模式：不比对群ID，直接放行（体验版/环境受限兜底）
    if (stored === 'manual_activated') {
      console.log('[verifyStoreGroup] 手动激活模式，跳过群ID比对');
      return true;
    }
    const match = stored === openGId;
    console.log('[verifyStoreGroup] 比对:', match ? '✅ 匹配' : '❌ 不匹配',
      ', 期望:', stored, ', 实际:', openGId);
    return match;

  } catch (e) {
    console.error('[verifyStoreGroup] 解密验证失败:', e.message || e);
    return false;
  }
}

/* ========== 用户列表（含状态字段，仅admin可用） ========== */
async function listUsers() {
  try {
    const res = await db.collection('users')
      .field({ openid: false })
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    return { code: 0, data: res.data || [], message: 'success' };
  } catch (e) {
    return { code: -1, message: '获取失败' };
  }
}

/* ========== 设置用户状态 ========== */
async function setUserStatus(event, operatorOpenid) {
  const { userId, status } = event;
  if (!userId || !status) return { code: -1, message: '参数不全' };
  // 仅 admin 可操作
  const opRes = await db.collection('users').where({ openid: operatorOpenid }).get();
  const op = opRes.data && opRes.data[0];
  if (!op || op.role !== 'admin') return { code: 403, message: '仅管理员可操作' };

  await db.collection('users').doc(userId).update({
    data: { status, updatedAt: new Date() }
  });
  return { code: 0, message: status === 'inactive' ? '已标记为离职' : '已恢复' };
}
