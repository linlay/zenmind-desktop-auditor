import { problem } from '../frontend/core/contracts.mjs';
export function normalizeBase(value) {
  let url; try { url = new URL(value); } catch { throw problem('invalid_platform_url', '请填写 Platform 的 HTTP(S) 地址。'); }
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw problem('invalid_platform_url', '本机 Platform 可使用 HTTP；其他地址需要 HTTPS，不能包含凭据或查询参数。');
  return url.href.replace(/\/$/, '');
}
export class PlatformBridge {
  constructor({ baseUrl = 'http://127.0.0.1:11949', token = '', fetchImpl = globalThis.fetch } = {}) { this.baseUrl = normalizeBase(baseUrl); this.token = token; this.fetch = fetchImpl; this.agents = []; this.connected = false; }
  async request(endpoint, { body, signal, timeout = 15000 } = {}) {
    const abort = AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]);
    let response;
    try { response = await this.fetch(this.baseUrl + endpoint, { method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: abort, redirect: 'error', credentials: 'omit' }); }
    catch (error) { if (signal?.aborted) throw signal.reason; throw problem(error.name === 'TimeoutError' ? 'platform_timeout' : 'platform_unavailable', '无法连接 Platform，请检查地址、服务状态与网络。', 502); }
    const chunks = []; let size = 0; const reader = response.body?.getReader();
    try { if (!reader) throw Error('no response'); while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2 * 1024 * 1024) throw problem('platform_response_too_large', 'Platform 返回超过 2 MiB。', 502); chunks.push(Buffer.from(value)); } }
    finally { await reader?.cancel().catch(() => {}); }
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw problem('platform_invalid_response', 'Platform 未返回有效 JSON。', 502); }
    if (!response.ok || value.code !== 0) {
      if (response.status === 401) this.connected = false;
      const info = value.data?.error, candidate = info?.code || value.msg;
      const code = response.status === 401 ? 'platform_auth_required' : /^[a-z][a-z0-9_]{0,79}$/.test(candidate) ? candidate : response.status === 403 ? 'platform_forbidden' : 'platform_request_failed';
      const message = response.status === 401 ? 'Platform 凭据缺失或已过期，请重新连接。' : info?.message || value.msg || 'Platform 请求失败。';
      throw problem(code, String(message).split(this.token || '\0').join('[已隐藏]').replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').slice(0,1000), response.status >= 400 ? response.status : 502);
    }
    return value.data;
  }
  async listAgents() {
    const data = await this.request('/api/agents?scope=invoke');
    if (!Array.isArray(data) || data.some(item => !item || typeof item.key !== 'string' || !item.key)) throw problem('platform_invalid_response', 'Platform Agent 目录格式不正确。', 502);
    this.agents = data.filter(item => item.engine !== 'acp' && !['PROXY', 'CHANNEL'].includes(item.mode)).map(({ key, name, mode, engine }) => ({ key, name: name || key, mode, engine })); this.connected = true; return this.agents;
  }
  async execute(args, options) { return this.request('/api/execute', { body: args, signal: options?.signal, timeout: 615000 }); }
  async getChat(chatId) {
    const data = await this.request('/api/chat?chatId=' + encodeURIComponent(chatId));
    if (data?.chatId !== chatId || !Array.isArray(data.events)) throw problem('platform_invalid_response', 'Platform 对话记录与请求不匹配。', 502);
    return { chatId: data.chatId, chatName: data.chatName, agentKey: data.agentKey, events: data.events, runs: data.runs };
  }
}
