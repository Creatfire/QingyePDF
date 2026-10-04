const test = require('node:test');
const assert = require('node:assert/strict');

test('user errors remove transport wrappers without discarding useful messages', async () => {
  const { userError } = await import('../ui/errors.mjs');
  assert.equal(userError(new Error("Error invoking remote method 'tools-job': Error: 至少保留一页。")), '至少保留一页。');
  assert.equal(userError('Error: Error invoking remote method "save": TypeError: 原文件已被其他程序修改。'), '原文件已被其他程序修改。');
  assert.equal(userError(new Error('请先选择文件。')), '请先选择文件。');
  assert.equal(userError('无法读取 E:\\测试目录\\example.pdf'), '无法读取 E:\\测试目录\\example.pdf');
  assert.equal(userError('Error: '), '操作未完成，请重试。');
  assert.equal(userError(null), '操作未完成，请重试。');
});
