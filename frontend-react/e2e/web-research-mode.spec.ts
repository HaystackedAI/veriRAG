import { expect, test } from '@playwright/test';

test('selects web research and sends its explicit skill activation', async ({ page }) => {
  const threadId = 'thread-web-research';
  const runId = 'run-web-research';
  let runRequest: Record<string, unknown> | null = null;
  const unauthorizedUrls: string[] = [];

  page.on('response', (response) => {
    if (response.status() === 401) unauthorizedUrls.push(response.url());
  });

  await page.route('**/auth/refresh', async (route) => {
    await route.fulfill({
      json: { access_token: 'web-research-token', username: 'research-user', role: 'user' },
    });
  });
  await page.route('**/v1/capabilities', async (route) => {
    await route.fulfill({
      json: {
        schema_version: 1,
        catalog_hash: 'a'.repeat(64),
        skills: [
          {
            name: 'web-research',
            version: '1.0.0',
            description: 'Research current public information.',
            activation: '/web-research',
            available: true,
            availability_reason: null,
            required_roles: [],
            tool_names: ['web_search', 'web_fetch'],
            approval_tools: [],
            network_policies: ['restricted'],
            resource_scopes: ['public-web'],
          },
        ],
        tools: [],
      },
    });
  });
  await page.route('**/v1/threads', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        json: {
          thread_id: threadId,
          title: '新对话',
          message_count: 0,
          version: 0,
          thread_status: 'active',
          active_run_id: null,
          active_run_status: null,
          created_at: '2026-11-19T00:00:00Z',
          updated_at: '2026-11-19T00:00:00Z',
        },
      });
      return;
    }
    await route.fulfill({ json: { threads: [] } });
  });
  await page.route('**/v1/threads/*/runs', async (route) => {
    runRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: {
        run: {
          id: runId,
          thread_id: threadId,
          status: 'succeeded',
          idempotency_key: 'web-research-key',
          user_message_id: 1,
          assistant_message_id: 2,
          on_disconnect: 'continue',
        },
        created: true,
        thread_version: 1,
      },
    });
  });
  await page.route(`**/v1/threads/${threadId}/messages**`, async (route) => {
    await route.fulfill({
      json: {
        messages: [
          {
            id: 2,
            run_id: runId,
            sequence: 2,
            status: 'completed',
            role: 'assistant',
            content: '已基于公开来源完成调研。',
            timestamp: '2026-11-19T00:00:01Z',
            rag_trace: null,
          },
        ],
        previous_cursor: null,
      },
    });
  });

  await page.goto('/');
  await expect(page.getByPlaceholder(/和喵喵说点什么/)).toBeVisible();
  const webResearch = page.getByRole('button', { name: /网络研究/ });
  await expect(webResearch).toBeEnabled();
  await webResearch.click();

  await expect(page.getByText('网络研究 · 查询公开来源')).toBeVisible();
  const input = page.getByPlaceholder('描述要调研的公开问题…');
  await input.fill('核验某公开信息');
  await page.getByRole('button', { name: '发送消息' }).click();

  await expect.poll(() => runRequest).not.toBeNull();
  expect(runRequest).toMatchObject({ message: '/web-research\n核验某公开信息' });
  expect(unauthorizedUrls, 'unexpected unauthorized response URLs').toEqual([]);
  await expect(page.getByText('已基于公开来源完成调研。')).toBeVisible();
});

test('admin can enable web research from the capability control page', async ({ page }) => {
  let enabled = false;
  let updatePayload: Record<string, unknown> | null = null;
  const controlPlane = () => ({
    schema_version: 1,
    web_research: {
      enabled,
      provider: 'tavily-keyless',
      api_key_required: false,
    },
    sql_assistant: {},
    skills: [],
    custom_tools: [],
    builtin_tools: [],
  });

  await page.route('**/auth/refresh', async (route) => {
    await route.fulfill({
      json: { access_token: 'admin-token', username: 'admin-user', role: 'admin' },
    });
  });
  await page.route('**/v1/threads', async (route) => {
    await route.fulfill({ json: { threads: [] } });
  });
  await page.route('**/v1/capabilities', async (route) => {
    await route.fulfill({
      json: {
        schema_version: 1,
        catalog_hash: 'b'.repeat(64),
        skills: [
          {
            name: 'web-research',
            version: '1.0.0',
            description: 'Research current public information.',
            activation: '/web-research',
            available: enabled,
            availability_reason: enabled ? null : 'not_configured',
            required_roles: [],
            tool_names: ['web_search', 'web_fetch'],
            approval_tools: [],
            network_policies: ['restricted'],
            resource_scopes: ['public-web'],
          },
        ],
        tools: [],
      },
    });
  });
  await page.route('**/v1/capabilities/control-plane', async (route) => {
    await route.fulfill({ json: controlPlane() });
  });
  await page.route('**/v1/capabilities/web-research', async (route) => {
    updatePayload = route.request().postDataJSON();
    enabled = updatePayload.enabled === true;
    await route.fulfill({ json: controlPlane() });
  });

  await page.goto('/');
  await expect(page.getByText('admin-user')).toBeVisible();
  await page.getByRole('button', { name: 'Skill / Tool' }).click();

  await expect(page.getByRole('heading', { name: 'Tavily Keyless' })).toBeVisible();
  await expect(page.getByText(/不需要 API Key/)).toBeVisible();
  await page.getByRole('button', { name: '启用网络研究' }).click();

  await expect(page.getByText('网络研究已启用。')).toBeVisible();
  expect(updatePayload).toEqual({ enabled: true });

  await page.getByRole('button', { name: '智能对话' }).click();
  await expect(page.getByRole('button', { name: /网络研究/ })).toBeEnabled();
});
