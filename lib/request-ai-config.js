const SERVER_DEEPSEEK_MODEL = 'deepseek-v4-flash';
const store = require('./store');

function header(req, name) {
  return String(req.get(name) || '').trim();
}

function requestAiConfig(req) {
  const profileId = header(req, 'x-ai-profile-id');
  if (!profileId) {
    return {
      profileId: '',
      apiKey: '',
      provider: 'deepseek',
      providerName: 'DeepSeek',
      providerType: 'openai_compatible',
      baseUrl: '',
      model: SERVER_DEEPSEEK_MODEL,
      temperature: '',
      maxTokens: '',
    };
  }
  const profile = store.getAiProfileConfig(profileId);
  if (!profile) {
    const error = new Error('AI 配置不存在或已删除');
    error.statusCode = 404;
    throw error;
  }
  return profile;
}

module.exports = {
  SERVER_DEEPSEEK_MODEL,
  requestAiConfig,
};
