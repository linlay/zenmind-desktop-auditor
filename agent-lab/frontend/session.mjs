export function createSession() {
  return { chatId: '', runId: '', cursor: 0, uploads: [], agentKey: undefined };
}
export function acceptQuery(state, result) {
  if (typeof result?.chatId !== 'string' || !result.chatId) throw Error('缺少 canonical chatId');
  state.chatId = result.chatId; state.runId = result.runId || ''; state.cursor = 0;
  state.uploads = [];
}
export function uploadRequest(state, file, agentKey) {
  return { file, ...(state.chatId ? { chatId: state.chatId } : {}), ...(agentKey ? { agentKey } : {}) };
}
export function queryRequest(state, message, agentKey, background) {
  return { message, background, ...(agentKey ? { agentKey } : {}), ...(state.chatId ? { chatId: state.chatId } : {}), ...(state.uploads.length ? { uploadIds: [...state.uploads] } : {}) };
}
