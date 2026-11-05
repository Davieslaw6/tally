import type { AppConfig } from './config';
import { createLogger, type Logger } from './logger';
import { createDatabase } from './db';
import type { SqlClient } from './db/sql';
import { OwnerService } from './services/owner-service';
import { AccountService, CategoryService } from './services/account-service';
import { TransactionService } from './services/transaction-service';
import { CashFlowService } from './services/cash-flow-service';
import { SettingsService } from './services/settings-service';
import { BudgetService, GoalService } from './services/planning-service';
import { ReportService } from './services/report-service';

export interface AppServices {
  config: AppConfig;
  logger: Logger;
  client: SqlClient;
  databaseKind: 'postgres' | 'pglite';
  owner: OwnerService;
  accounts: AccountService;
  categories: CategoryService;
  transactions: TransactionService;
  cashFlow: CashFlowService;
  settings: SettingsService;
  budgets: BudgetService;
  goals: GoalService;
  reports: ReportService;
  close: () => Promise<void>;
}

export async function createServices(config: AppConfig): Promise<AppServices> {
  const { logger } = createLogger(config);
  const database = await createDatabase(config, { info: (message) => logger.info(message) });
  const client = database.client;

  const owner = new OwnerService(config, client, logger);
  const accounts = new AccountService(client);
  const categories = new CategoryService(client);
  const transactions = new TransactionService(config, client, logger);
  const cashFlow = new CashFlowService(client);
  const settings = new SettingsService(client);
  const budgets = new BudgetService(client);
  const goals = new GoalService(client);
  const reports = new ReportService(client, cashFlow);

  return {
    config,
    logger,
    client,
    databaseKind: database.kind,
    owner,
    accounts,
    categories,
    transactions,
    cashFlow,
    settings,
    budgets,
    goals,
    reports,
    close: () => database.close(),
  };
}
