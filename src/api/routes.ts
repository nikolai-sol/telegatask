import express from 'express';
import crypto from 'crypto';
import {
  getCompaniesByType,
  getInboxTasks,
  getFireAgencyTasks,
  getTasksByCompany,
  convertTenderToCampaign,
  updateCompanyStatus,
  createCompany,
  createAgencyTask,
} from '../services/firestore.service';
import { runAgent } from '../services/ai.service';

const router = express.Router();

// ============================================================
// Middleware: верификация Telegram initData
// ============================================================

function verifyTelegramAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const initData = req.headers['x-telegram-init-data'] as string | undefined;

  if (!initData || process.env.NODE_ENV === 'development') {
    next();
    return;
  }

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  if (!hash) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  urlParams.delete('hash');

  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(process.env.TELEGRAM_BOT_TOKEN!)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

router.use(verifyTelegramAuth);

// ============================================================
// GET /agency/home — данные для главного экрана Mini App
// ============================================================

router.get('/home', async (_req, res) => {
  try {
    const [tenders, campaigns, inboxTasks, focusTasks] = await Promise.all([
      getCompaniesByType('tender'),
      getCompaniesByType('campaign'),
      getInboxTasks(),
      getFireAgencyTasks(),
    ]);

    const activeTenders = tenders.filter(c => !['won', 'lost'].includes(c.status));
    const activeCampaigns = campaigns.filter(c => c.status !== 'completed');

    res.json({ focusTasks, tenders: activeTenders, campaigns: activeCampaigns, inboxTasks });
  } catch (err) {
    console.error('[agency/home]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ============================================================
// Companies
// ============================================================

// GET /agency/companies/:id/tasks
router.get('/companies/:id/tasks', async (req, res) => {
  try {
    const tasks = await getTasksByCompany(req.params.id);
    res.json(tasks);
  } catch (err) {
    console.error('[agency/companies/:id/tasks]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// POST /agency/companies — создать компанию/тендер/кампанию
router.post('/companies', async (req, res) => {
  try {
    const { name, type, status, clientName, description } = req.body as {
      name: string;
      type: 'tender' | 'campaign' | 'internal';
      status?: string;
      clientName?: string;
      description?: string;
    };

    if (!name || !type) {
      res.status(400).json({ error: 'name and type are required' });
      return;
    }

    const defaultStatus = type === 'tender' ? 'incoming' : 'active';
    const telegramUser = parseTelegramUser(req);

    const company = await createCompany({
      name,
      type,
      status: (status as any) || defaultStatus,
      clientName,
      description,
      isFire: false,
      createdBy: telegramUser,
      members: telegramUser ? [telegramUser] : [],
      metadata: {},
    });

    res.status(201).json(company);
  } catch (err) {
    console.error('[agency/companies POST]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// POST /agency/companies/:id/convert — Tender → Campaign
router.post('/companies/:id/convert', async (req, res) => {
  try {
    const { copyTasks = false } = req.body as { copyTasks?: boolean };
    const campaign = await convertTenderToCampaign(req.params.id, copyTasks);
    res.json(campaign);
  } catch (err: any) {
    console.error('[agency/companies/:id/convert]', err);
    const status = err?.message === 'Not a tender' ? 400 : 500;
    res.status(status).json({ error: err?.message || 'Internal error' });
  }
});

// PATCH /agency/companies/:id/status
router.patch('/companies/:id/status', async (req, res) => {
  try {
    const { status } = req.body as { status: string };
    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }
    await updateCompanyStatus(req.params.id, status);
    res.json({ ok: true });
  } catch (err) {
    console.error('[agency/companies/:id/status]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ============================================================
// Agency Tasks
// ============================================================

// POST /agency/tasks — создать задачу в Inbox
router.post('/tasks', async (req, res) => {
  try {
    const { title, companyId, description, priority } = req.body as {
      title: string;
      companyId?: string;
      description?: string;
      priority?: 'low' | 'normal' | 'high' | 'fire';
    };

    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const telegramUser = parseTelegramUser(req);
    const task = await createAgencyTask({
      title,
      companyId: companyId || undefined,
      description,
      status: 'todo',
      priority: priority || 'normal',
      isFire: priority === 'fire',
      createdBy: telegramUser,
    });

    res.status(201).json(task);
  } catch (err) {
    console.error('[agency/tasks POST]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ============================================================
// AI Agent
// ============================================================

// POST /agency/ai/message — отправка сообщения AI агенту
// POST /agency/ai/analyze — алиас (совместимость с CLAUDE_CODE_SPEC v1.0)
// Тело: { mode, companyId, message, companyContext? }
//       или { mode, context, prompt } (формат v1.0)
async function handleAIRequest(req: express.Request, res: express.Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;

    // Поддержка обоих форматов:
    // v2.0: { mode, companyId, message }
    // v1.0: { mode, context: { companyId, ... }, prompt }
    const mode = (body.mode as string) as 'tender' | 'campaign' | 'ops';
    const companyId = (body.companyId as string)
      || ((body.context as Record<string, unknown>)?.companyId as string)
      || 'ops';
    const message = (body.message as string) || (body.prompt as string) || '';
    const companyContext = (body.companyContext as Record<string, unknown>)
      || (body.context as Record<string, unknown>);

    if (!mode || !message) {
      res.status(400).json({ error: 'mode and message (or prompt) are required' });
      return;
    }

    const response = await runAgent({
      mode,
      companyId,
      userMessage: message,
      companyContext: companyContext as any,
    });

    res.json({ response });
  } catch (err) {
    console.error('[agency/ai]', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

router.post('/ai/message', handleAIRequest);
router.post('/ai/analyze', handleAIRequest);

// ============================================================
// Helper: extract userId from Telegram initData or header
// ============================================================

function parseTelegramUser(req: express.Request): string {
  try {
    const initData = req.headers['x-telegram-init-data'] as string | undefined;
    if (initData) {
      const params = new URLSearchParams(initData);
      const userStr = params.get('user');
      if (userStr) {
        const user = JSON.parse(userStr) as { id?: number };
        if (user.id) return String(user.id);
      }
    }
  } catch {
    // fall through
  }
  return 'unknown';
}

export default router;
