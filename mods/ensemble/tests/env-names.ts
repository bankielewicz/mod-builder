// Literal lists, not derived from BLANKED_ENV, so a name added or deleted there is caught.
// Shared by the ensemble-logic, routing and config tests: a name is changed here once.

/** The names duet blanked before issue #2. */
export const ORIGINAL_ENV = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_PROJECT_ID',
  'ANTHROPIC_VERTEX_BASE_URL', 'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_FOUNDRY_BASE_URL', 'ANTHROPIC_FOUNDRY_RESOURCE', 'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_SESSION_ACCESS_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
]

/** The names issue #2 adds, by provider. */
export const CLOUD_ENV = {
  aws: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONTAINER_AUTHORIZATION_TOKEN'],
  claudePlatformOnAws: ['CLAUDE_CODE_USE_ANTHROPIC_AWS', 'ANTHROPIC_AWS_WORKSPACE_ID', 'ANTHROPIC_AWS_BASE_URL', 'ANTHROPIC_AWS_API_KEY'],
  bedrockMantle: ['CLAUDE_CODE_USE_MANTLE', 'ANTHROPIC_BEDROCK_MANTLE_BASE_URL'],
  claudeCode: ['CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_MESSAGING_SOCKET'],
  workloadIdentity: ['ANTHROPIC_IDENTITY_TOKEN'],
  foundry: ['ANTHROPIC_FOUNDRY_AUTH_TOKEN'],
  azureSdk: ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_CLIENT_CERTIFICATE_PASSWORD', 'AZURE_PASSWORD'],
  azureManagedIdentity: ['IDENTITY_HEADER'],
}

/**
 * The API provider keys duet stores (0.3.0). Never blanked for Codex (the owner's decision at review): a key duet keeps
 * lives in its file, which blanking a variable does nothing about, and one set in the shell is the person's own
 * credential for Codex too. OPENAI_API_KEY and ANTHROPIC_API_KEY are not here: Codex's own, and Claude Code's own.
 */
export const PROVIDER_KEYS = [
  'GEMINI_API_KEY', 'XAI_API_KEY', 'MISTRAL_API_KEY', 'DEEPSEEK_API_KEY', 'GROQ_API_KEY', 'TOGETHER_API_KEY', 'FIREWORKS_API_KEY',
  'OPENROUTER_API_KEY', 'PERPLEXITY_API_KEY', 'CEREBRAS_API_KEY', 'DUET_CUSTOM_API_KEY',
]

/** Every name Codex's env blanks, exactly. */
export const BLANKED: readonly string[] = [...ORIGINAL_ENV, ...Object.values(CLOUD_ENV).flat()]

/** Codex itself needs these, so they must reach it. */
export const CODEX_NEEDS = ['OPENAI_API_KEY', 'CODEX_HOME', 'PATH', 'HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy']

/** Not secrets: paths, profile names, endpoints and IDs. '' isn't unset, and an empty path changes what a tool does, so they pass through. */
export const NOT_SECRETS = [
  'CLAUDE_CONFIG_DIR', 'ANTHROPIC_PROFILE', 'AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE',
  'GOOGLE_APPLICATION_CREDENTIALS', 'AZURE_CLIENT_CERTIFICATE_PATH', 'AZURE_FEDERATED_TOKEN_FILE',
  'ANTHROPIC_IDENTITY_TOKEN_FILE', 'ANTHROPIC_CONFIG_DIR', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_SERVICE_ACCOUNT_ID', 'ANTHROPIC_WORKSPACE_ID',
  'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE', 'AWS_ROLE_ARN', 'AWS_ROLE_SESSION_NAME',
  'AZURE_USERNAME', 'IDENTITY_ENDPOINT',
]

/** Every name that must reach Codex unchanged. */
export const PASSED_THROUGH: readonly string[] = [...CODEX_NEEDS, ...NOT_SECRETS, ...PROVIDER_KEYS]
