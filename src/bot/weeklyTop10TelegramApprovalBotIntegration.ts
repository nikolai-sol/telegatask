import type {
  WeeklyTop10TelegramApprovalDevBotLike,
  WeeklyTop10TelegramApprovalDevCallbackContext,
  WeeklyTop10TelegramApprovalDevMessageContext,
  WeeklyTop10TelegramApprovalDevRegistrationDependencies,
  WeeklyTop10TelegramApprovalDevRegistrationResult,
} from "../features/seoAgent/weeklyTop10TelegramApprovalDevRegistration";

export const SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER_FLAG =
  "SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER";

export type WeeklyTop10TelegramApprovalStartupLogger = {
  error(message?: unknown, ...optionalParams: unknown[]): void;
};

export type WeeklyTop10TelegramApprovalStartupRegistrar = (
  bot: WeeklyTop10TelegramApprovalDevBotLike,
  deps: WeeklyTop10TelegramApprovalDevRegistrationDependencies
) => WeeklyTop10TelegramApprovalDevRegistrationResult;

export type WeeklyTop10TelegramApprovalStartupIntegrationDependencies =
  WeeklyTop10TelegramApprovalDevRegistrationDependencies & {
    registrar?: WeeklyTop10TelegramApprovalStartupRegistrar;
    logger?: WeeklyTop10TelegramApprovalStartupLogger;
  };

export type WeeklyTop10TelegramApprovalStartupIntegrationResult = {
  registered: boolean;
  reason:
    | "enabled"
    | "feature_flag_disabled"
    | "already_registered"
    | "registration_failed";
  error: string | null;
};

type DevRegistrationModule = {
  registerWeeklyTop10TelegramApprovalDevHandler: WeeklyTop10TelegramApprovalStartupRegistrar;
};

function enabled(env: Record<string, string | undefined> | undefined): boolean {
  return env?.[SEO_WEEKLY_TOP10_TELEGRAM_APPROVAL_DEV_HANDLER_FLAG] === "1";
}

function callbackDataFromContext(ctx: WeeklyTop10TelegramApprovalDevCallbackContext): string {
  const value = ctx.callbackQuery?.data;
  return typeof value === "string" ? value.trim() : "";
}

function defaultRegistrar(): WeeklyTop10TelegramApprovalStartupRegistrar {
  const mod = require("../features/seoAgent/weeklyTop10TelegramApprovalDevRegistration") as DevRegistrationModule;
  return mod.registerWeeklyTop10TelegramApprovalDevHandler;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWeeklyTop10TelegramApprovalStartupIntegration() {
  let registered = false;
  let handler: ((ctx: WeeklyTop10TelegramApprovalDevCallbackContext) => Promise<void>) | null = null;
  let messageHandler: ((ctx: WeeklyTop10TelegramApprovalDevMessageContext) => Promise<boolean>) | null = null;

  return {
    register(deps: WeeklyTop10TelegramApprovalStartupIntegrationDependencies): WeeklyTop10TelegramApprovalStartupIntegrationResult {
      const env = deps.env || process.env;
      if (!enabled(env)) {
        return {
          registered: false,
          reason: "feature_flag_disabled",
          error: null,
        };
      }
      if (registered) {
        return {
          registered: false,
          reason: "already_registered",
          error: null,
        };
      }

      try {
        const bridgeBot: WeeklyTop10TelegramApprovalDevBotLike = {
          on: (event, nextHandler) => {
            if (event === "callback_query") {
              handler = nextHandler as (ctx: WeeklyTop10TelegramApprovalDevCallbackContext) => Promise<void>;
              return;
            }
            messageHandler = nextHandler as (ctx: WeeklyTop10TelegramApprovalDevMessageContext) => Promise<boolean>;
          },
        };
        const result = (deps.registrar || defaultRegistrar())(bridgeBot, {
          ...deps,
          env,
        });
        registered = result.registered;
        return {
          registered: result.registered,
          reason: result.reason,
          error: null,
        };
      } catch (error) {
        const message = failureMessage(error);
        (deps.logger || console).error("[seo-weekly-top10] dev registration failed", error);
        return {
          registered: false,
          reason: "registration_failed",
          error: message,
        };
      }
    },

    async handleCallback(ctx: WeeklyTop10TelegramApprovalDevCallbackContext): Promise<boolean> {
      if (!handler) return false;
      if (!callbackDataFromContext(ctx).startsWith("seo10:")) return false;
      await handler(ctx);
      return true;
    },

    async handleMessage(ctx: WeeklyTop10TelegramApprovalDevMessageContext): Promise<boolean> {
      if (!messageHandler) return false;
      return messageHandler(ctx);
    },
  };
}

const weeklyTop10TelegramApprovalStartupIntegration =
  createWeeklyTop10TelegramApprovalStartupIntegration();

export function registerWeeklyTop10TelegramApprovalDevStartup(
  deps: WeeklyTop10TelegramApprovalStartupIntegrationDependencies
): WeeklyTop10TelegramApprovalStartupIntegrationResult {
  return weeklyTop10TelegramApprovalStartupIntegration.register(deps);
}

export async function handleWeeklyTop10TelegramApprovalDevStartupCallback(
  ctx: WeeklyTop10TelegramApprovalDevCallbackContext
): Promise<boolean> {
  return weeklyTop10TelegramApprovalStartupIntegration.handleCallback(ctx);
}

export async function handleWeeklyTop10TelegramApprovalDevStartupMessage(
  ctx: WeeklyTop10TelegramApprovalDevMessageContext
): Promise<boolean> {
  return weeklyTop10TelegramApprovalStartupIntegration.handleMessage(ctx);
}
