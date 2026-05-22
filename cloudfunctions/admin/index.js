// cloudfunctions/admin/index.js - 管理功能云函数
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    // 先获取用户信息（所有操作都需要）
    const userInfo = await getUserInfo(openid);
    
    // 权限检查：只有管理员可以访问管理功能
    if (!userInfo || userInfo.role !== 'admin') {
      return { code: 403, message: '无管理员权限，当前角色：' + (userInfo && userInfo.role || '未知') };
    }

    switch (event.action) {
      case 'getPermissionGroups':
        return await getPermissionGroups();
      case 'createPermissionGroup':
        return await createPermissionGroup(event.data);
      case 'updatePermissionGroup':
        return await updatePermissionGroup(event.id, event.data);
      case 'deletePermissionGroup':
        return await deletePermissionGroup(event.id);
      case 'getDepartments':
        return await getDepartments();
      case 'createDepartment':
        return await createDepartment(event.data);
      case 'updateDepartment':
        return await updateDepartment(event.id, event.data);
      case 'deleteDepartment':
        return await deleteDepartment(event.id);
      case 'getUsers':
        return await getUsers();
      case 'updateUser':
        return await updateUser(event.id, event.data);
      default:
        return { code: -1, message: '未知操作' };
    }
  } catch (e) {
    console.error('[admin] error', e);
    return { code: -1, message: e.message || '服务异常' };
  }
};

/* ========== 权限组管理 ========== */
async function getPermissionGroups() {
  const res = await db.collection('permission_groups').get();
  return { code: 0, data: res.data, message: 'success' };
}

async function createPermissionGroup(data) {
  const now = new Date();
  const doc = { ...data, createdAt: now, updatedAt: now };
  const res = await db.collection('permission_groups').add(doc);
  return { code: 0, data: { id: res._id }, message: '创建成功' };
}

async function updatePermissionGroup(id, data) {
  await db.collection('permission_groups').doc(id).update({
    data: {
      ...data,
      updatedAt: new Date(),
    }
  });
  return { code: 0, message: '更新成功' };
}

async function deletePermissionGroup(id) {
  await db.collection('permission_groups').doc(id).remove();
  return { code: 0, message: '删除成功' };
}

/* ========== 部门管理 ========== */
async function getDepartments() {
  const res = await db.collection('departments').get();
  return { code: 0, data: res.data, message: 'success' };
}

async function createDepartment(data) {
  const now = new Date();
  const doc = { ...data, createdAt: now, updatedAt: now };
  const res = await db.collection('departments').add(doc);
  return { code: 0, data: { id: res._id }, message: '创建成功' };
}

async function updateDepartment(id, data) {
  await db.collection('departments').doc(id).update({
    data: {
      ...data,
      updatedAt: new Date(),
    }
  });
  return { code: 0, message: '更新成功' };
}

async function deleteDepartment(id) {
  await db.collection('departments').doc(id).remove();
  return { code: 0, message: '删除成功' };
}

/* ========== 用户管理 ========== */
async function getUsers() {
  const res = await db.collection('users').get();
  return { code: 0, data: res.data, message: 'success' };
}

async function updateUser(id, data) {
  await db.collection('users').doc(id).update({
    data: {
      ...data,
      updatedAt: new Date(),
    }
  });
  return { code: 0, message: '更新成功' };
}

/* ========== 工具函数 ========== */
async function getUserInfo(openid) {
  const res = await db.collection('users').where({ openid }).get();
  return res.data[0] || { role: 'user', name: '未知用户' };
}
