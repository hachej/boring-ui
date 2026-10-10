// Whether a user has live work in the harness: a live task or an unsettled submission of one of their conversations.
// `inspection` is Pi's `harness.inspect()`; `userOf(conversationId)` answers the user a conversation belongs to.
export async function hasLiveWork(inspection, userId, userOf) {
  if (!inspection) return false;
  const ids = new Set([...inspection.tasks.map(task => task.record.conversationId), ...inspection.submissions.map(submission => submission.conversationId)]);
  for (const id of ids) if (await userOf(id) === userId) return true;
  return false;
}
