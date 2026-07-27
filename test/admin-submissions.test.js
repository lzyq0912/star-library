const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-admin-submissions-'));
process.env.QMREADER_DATA_DIR = testDataDir;
delete process.env.ADMIN_EMAIL;
delete process.env.ADMIN_PASSWORD;
delete process.env.ADMIN_NAME;

const store = require('../lib/store');

after(() => {
  store.closeDatabase();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function entry(id, title) {
  return {
    id,
    sourceId: 'user-submitted',
    title,
    link: `https://example.com/${id}`,
    author: '读者',
    published: new Date().toISOString(),
    publishedTs: Date.now(),
    summary: `${title} summary`,
    content: `<p>${title} content</p>`,
  };
}

function saveSubmission(id, title, user) {
  return store.saveSubmittedEntry(entry(id, title), {
    userId: user.id,
    author: user.displayName,
  });
}

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

/** 遗留 users schema 要求 password；非产品登录 API */
function makeOwner(prefix, extras = {}) {
  return store.createUser({
    email: uniqueEmail(prefix),
    password: 'schema-placeholder-123',
    displayName: prefix,
    ...extras,
  });
}

test('admin page exposes an accessible user submission management workflow', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  for (const id of [
    'admin-submission-search-form',
    'admin-submission-search',
    'admin-submission-users',
    'admin-submission-detail',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /用户投稿管理/);
  assert.match(app, /async function loadAdminSubmissionUsers/);
  assert.match(app, /async function loadAdminUserSubmissions/);
  assert.match(app, /async function deleteAdminUserSubmissions/);
  assert.match(app, /async function deleteAdminUser/);
  assert.match(app, /showConfirmDialog/);
  assert.match(html, /待审核投稿/);
  assert.match(app, /loadAdminSubmissionRequests/);
  assert.match(app, /reviewAdminSubmissionRequest/);
});

test('submission requests stay quarantined until an owner reviews them', () => {
  const reader = makeOwner('queue-reader');
  const owner = makeOwner('queue-owner', { displayName: 'queue owner', role: 'admin' });
  const queued = store.createSubmissionRequest({
    url: 'https://example.com/queued-article',
    userId: reader.id,
    author: reader.displayName,
    note: 'worth reading',
  });
  assert.equal(queued.status, 'pending');
  assert.equal(store.getSubmissionRequests({ status: 'pending' }).length, 1);
  assert.equal(store.getSubmittedEntries().some(item => item.link === queued.url), false);

  const duplicate = store.createSubmissionRequest({
    url: queued.url,
    userId: reader.id,
    author: reader.displayName,
    note: 'duplicate',
  });
  assert.equal(duplicate.id, queued.id);
  assert.equal(store.getSubmissionRequests({ status: 'pending' }).length, 1);

  const rejected = store.reviewSubmissionRequest(queued.id, {
    status: 'rejected',
    reviewedBy: owner.id,
    reason: 'not an article',
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.reviewReason, 'not an article');
  assert.equal(store.getSubmissionRequests({ status: 'pending' }).length, 0);
});

test('submission quarantine enforces a small durable pending quota per account', () => {
  const reader = makeOwner('quota-reader');
  for (let index = 0; index < 3; index += 1) {
    store.createSubmissionRequest({
      url: `https://example.com/quota-${index}`,
      userId: reader.id,
      author: reader.displayName,
    });
  }
  assert.throws(
    () => store.createSubmissionRequest({
      url: 'https://example.com/quota-overflow',
      userId: reader.id,
      author: reader.displayName,
    }),
    error => error.statusCode === 429 && /待审核/.test(error.message)
  );
});

test('submission summaries and batch soft delete are scoped to one exact user', () => {
  const readerC = makeOwner('reader-c', { displayName: 'c' });
  const sameName = makeOwner('reader-c2', { displayName: 'c' });
  const other = makeOwner('reader-d', { displayName: 'd' });
  saveSubmission('c-entry-one', 'C one', readerC);
  saveSubmission('c-entry-two', 'C two', readerC);
  saveSubmission('same-name-entry', 'Same name', sameName);
  saveSubmission('other-entry', 'Other', other);

  const users = store.getAdminSubmissionUsers({ q: 'reader-c', limit: 20 });
  assert.equal(users.length, 2);
  assert.deepEqual(users.map(item => item.userId).sort(), [readerC.id, sameName.id].sort());
  assert.equal(users.find(item => item.userId === readerC.id).activeSubmissionCount, 2);

  const preview = store.getAdminUserSubmissions(readerC.id, { limit: 20 });
  assert.equal(preview.user.displayName, 'c');
  assert.equal(preview.user.email, readerC.email);
  assert.equal(preview.activeSubmissionCount, 2);
  assert.deepEqual(preview.submissions.map(item => item.entryId).sort(), ['c-entry-one', 'c-entry-two']);

  const result = store.softDeleteUserSubmissions(readerC.id, {
    deletedBy: 'owner-user-id',
    reason: '所有者批量删除用户投稿',
  });
  assert.equal(result.deletedCount, 2);
  assert.deepEqual(result.entryIds.sort(), ['c-entry-one', 'c-entry-two']);
  assert.equal(store.getEntry('c-entry-one'), null);
  assert.equal(store.getEntry('c-entry-two'), null);
  assert.ok(store.getEntry('same-name-entry'));
  assert.ok(store.getEntry('other-entry'));

  const afterDelete = store.getAdminUserSubmissions(readerC.id, { limit: 20 });
  assert.equal(afterDelete.activeSubmissionCount, 0);
  assert.equal(afterDelete.deletedSubmissionCount, 2);
  assert.ok(afterDelete.submissions.every(item => item.deletedAt));

  const idempotent = store.softDeleteUserSubmissions(readerC.id, {
    deletedBy: 'owner-user-id',
    reason: 'repeat',
  });
  assert.equal(idempotent.deletedCount, 0);
  assert.deepEqual(idempotent.entryIds, []);
  assert.throws(
    () => store.softDeleteUserSubmissions('missing-user', { deletedBy: 'owner-user-id' }),
    error => error.statusCode === 404
  );
});

/**
 * 遗留 schema 数据层：disable/restore、session 吊销、authenticateUser。
 * 非产品登录/多用户鉴权意图——个人模式永不提供 /api/auth/login。
 */
test('moderation disables a non-owner user, revokes sessions, deletes submissions, and can be restored', () => {
  const owner = makeOwner('moderator', { displayName: 'moderator', role: 'admin' });
  const offender = makeOwner('offender', { displayName: '违规用户' });
  saveSubmission('offender-entry-one', 'Offender one', offender);
  saveSubmission('offender-entry-two', 'Offender two', offender);
  const session = store.createSession(offender.id);
  const pending = store.createSubmissionRequest({
    url: 'https://example.com/offender-pending',
    userId: offender.id,
    author: offender.displayName,
  });
  assert.equal(store.getUserBySessionToken(session.token).id, offender.id);

  const moderated = store.disableUserForModeration(offender.id, {
    adminUserId: owner.id,
    reason: '批量发布违规链接',
  });
  assert.equal(moderated.user.disabled, true);
  assert.equal(moderated.deletedSubmissionCount, 2);
  assert.equal(moderated.revokedSessionCount, 1);
  assert.equal(store.getUserBySessionToken(session.token), null);
  assert.equal(store.getEntry('offender-entry-one'), null);
  assert.equal(store.getSubmissionRequest(pending.id).status, 'rejected');
  assert.throws(
    () => store.authenticateUser(offender.email, 'schema-placeholder-123'),
    error => error.statusCode === 403
  );
  assert.throws(
    () => store.disableUserForModeration(owner.id, { adminUserId: owner.id, reason: 'invalid' }),
    error => error.statusCode === 403
  );

  const restored = store.restoreModeratedUser(offender.id, { adminUserId: owner.id });
  assert.equal(restored.disabled, false);
  assert.equal(store.authenticateUser(offender.email, 'schema-placeholder-123').id, offender.id);
  assert.equal(store.getEntry('offender-entry-one'), null);
});
