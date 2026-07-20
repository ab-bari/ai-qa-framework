/**
 * Crawler orchestrator (plan §6.1). Priority-queue BFS over a site: optional
 * smart auth first, then a single reused page drives navigate → analyze →
 * discover-links, with sitemap backfill and clean-context auth probing. Ports
 * the Python `src/crawler/crawler.py` control flow. Produces a SiteModel; the
 * `crawl` command writes the artifact.
 */

import type { BrowserContext, Page } from "playwright";

import { performSmartAuth } from "../core/auth/authenticator.js";
import { createStealthContext } from "../core/browser/context-factory.js";
import { launchStealthBrowser } from "../core/browser/launch-stealth-browser.js";
import { normalizeUrl, pageIdFromUrl } from "../core/ids.js";
import type { RunContext } from "../core/run-context.js";
import type { SiteModel, PageModel, AuthFlow } from "../schemas/site-model.js";
import { probeAuthRequirements } from "./auth-probe.js";
import { CrawlPriority, Frontier } from "./frontier.js";
import { discoverLinks, detectSpaType, fetchSitemapUrls, isValidPageUrl } from "./link-discovery.js";
import { NetworkCapture } from "./network-capture.js";
import { processPage } from "./page-analyzer.js";

export interface CrawlOptions {
  /** Overrides `config.crawl.max_pages` when set. */
  maxPages?: number | undefined;
  /** Run Chromium headed (default headless). */
  headless?: boolean | undefined;
}

class Crawler {
  private readonly frontier: Frontier;
  private readonly network = new NetworkCapture();
  private readonly pages: PageModel[] = [];
  private readonly navGraph: Record<string, string[]> = {};
  private isSpa = false;

  private readonly targetUrl: string;
  private readonly maxPages: number;
  private readonly maxDepth: number;
  private readonly includePatterns: RegExp[];
  private readonly excludePatterns: RegExp[];

  constructor(
    private readonly ctx: RunContext,
    private readonly options: CrawlOptions,
  ) {
    const crawl = ctx.config.crawl;
    this.targetUrl = crawl.target_url !== "" ? crawl.target_url : ctx.config.target_url;
    this.maxPages = options.maxPages ?? crawl.max_pages;
    this.maxDepth = crawl.max_depth;
    this.includePatterns = crawl.include_patterns.map((p) => new RegExp(p));
    this.excludePatterns = crawl.exclude_patterns.map((p) => new RegExp(p));
    this.frontier = new Frontier(normalizeUrl);
  }

  private isSameOrigin(candidate: string): boolean {
    try {
      return new URL(this.targetUrl).host === new URL(candidate).host;
    } catch {
      return false;
    }
  }

  private urlInScope(url: string): boolean {
    if (!this.isSameOrigin(url)) {
      return false;
    }
    if (this.excludePatterns.some((re) => re.test(url))) {
      return false;
    }
    if (this.includePatterns.length > 0 && !this.includePatterns.some((re) => re.test(url))) {
      return false;
    }
    return true;
  }

  async run(): Promise<SiteModel> {
    const { logger } = this.ctx;
    const start = Date.now();
    logger.info(`Starting crawl of ${this.targetUrl}`);

    const browser = await launchStealthBrowser(this.options.headless !== true);
    let authFlow: AuthFlow | null = null;
    try {
      const context = await createStealthContext(browser, {
        viewport: this.ctx.config.crawl.viewport,
        userAgent: this.ctx.config.crawl.user_agent,
        storageStatePath: this.ctx.workspace.storageStatePath,
      });

      let postLoginUrl: string | null = null;
      if (this.ctx.config.auth !== null) {
        logger.info("Authenticating before crawl...");
        const result = await performSmartAuth(context, this.ctx.config.auth, {
          llm: this.ctx.llm,
          logger,
          screenshotDir: this.ctx.workspace.ensureDir("debug", "auth"),
        });
        if (result.success) {
          authFlow = result.authFlow ?? null;
          postLoginUrl = result.postLoginUrl ?? null;
          await context.storageState({ path: this.ctx.workspace.storageStatePath });
          logger.info("Authentication successful");
        } else {
          logger.error(`Authentication failed: ${result.error ?? "unknown"}`);
        }
      }

      await this.priorityCrawl(context, postLoginUrl);

      if (this.ctx.config.auth !== null && authFlow !== null) {
        await probeAuthRequirements(
          browser,
          this.pages,
          {
            viewport: this.ctx.config.crawl.viewport,
            userAgent: this.ctx.config.crawl.user_agent,
            loginUrl: this.ctx.config.auth.login_url,
          },
          logger,
        );
      } else {
        for (const page of this.pages) {
          page.auth_required = false;
        }
      }
    } finally {
      await browser.close();
    }

    const durationSeconds = (Date.now() - start) / 1000;
    logger.info(
      `Crawl complete: ${String(this.pages.length)} pages discovered in ${durationSeconds.toFixed(1)}s`,
    );

    return {
      base_url: this.targetUrl,
      pages: this.pages,
      navigation_graph: this.navGraph,
      api_endpoints: this.network.apiEndpoints(),
      auth_flow: authFlow,
      crawl_metadata: {
        timestamp: new Date().toISOString(),
        duration_seconds: Math.round(durationSeconds * 100) / 100,
        pages_found: this.pages.length,
        is_spa: this.isSpa,
        urls_seen: this.frontier.seenCount,
      },
    };
  }

  private async priorityCrawl(context: BrowserContext, postLoginUrl: string | null): Promise<void> {
    const { logger } = this.ctx;
    this.frontier.enqueue(this.targetUrl, 0, CrawlPriority.START);
    if (postLoginUrl !== null && normalizeUrl(postLoginUrl) !== normalizeUrl(this.targetUrl)) {
      logger.info(`Seeding post-login URL into crawl queue: ${postLoginUrl}`);
      this.frontier.enqueue(postLoginUrl, 0, CrawlPriority.START);
    }

    const page = await context.newPage();
    const networkBuffer = this.network.attach(page);
    let sitemapLoaded = false;

    while (this.frontier.size > 0 && this.frontier.visitedCount < this.maxPages) {
      const entry = this.frontier.pop();
      if (entry === undefined) {
        break;
      }
      if (this.frontier.isVisited(entry.url) || entry.depth > this.maxDepth) {
        continue;
      }
      if (!this.urlInScope(entry.url)) {
        continue;
      }

      this.frontier.markVisited(entry.url);
      logger.info(
        `Crawling [${String(this.frontier.visitedCount)}/${String(this.maxPages)}] depth=${String(entry.depth)} prio=${String(entry.priority)}: ${entry.url}`,
      );

      networkBuffer.length = 0;
      if (this.frontier.visitedCount > 1) {
        await page.waitForTimeout(300 + Math.floor(Math.random() * 900));
      }

      try {
        if (!(await this.navigateWithRetry(page, entry.url))) {
          logger.warn(`Failed to load: ${entry.url}`);
          continue;
        }

        if (this.frontier.visitedCount === 1) {
          this.isSpa = (await detectSpaType(page)) !== "traditional";
          if (this.isSpa) {
            logger.info("SPA detected");
          }
        }

        const pageId = pageIdFromUrl(entry.url);
        const pageModel = await processPage(
          page,
          entry.url,
          pageId,
          networkBuffer,
          this.ctx.workspace,
          logger,
        );
        this.pages.push(pageModel);

        const discovered = await discoverLinks(page, entry.url, this.isSpa, logger);
        this.navGraph[pageId] = [];
        let organic = 0;
        for (const link of discovered) {
          if (!isValidPageUrl(link) || !this.isSameOrigin(link)) {
            continue;
          }
          this.navGraph[pageId].push(pageIdFromUrl(link));
          if (this.frontier.enqueue(link, entry.depth + 1, CrawlPriority.ORGANIC)) {
            organic++;
          }
        }
        logger.info(
          `Page '${pageModel.title || entry.url}' — ${String(discovered.size)} links found, ${String(organic)} new queued`,
        );

        if (!sitemapLoaded) {
          sitemapLoaded = true;
          const sitemapUrls = await fetchSitemapUrls(context, this.targetUrl);
          let queued = 0;
          for (const loc of sitemapUrls) {
            if (this.frontier.enqueue(loc, 1, CrawlPriority.SITEMAP)) {
              queued++;
            }
          }
          if (queued > 0) {
            logger.info(`Sitemap backfill: ${String(queued)} URLs queued`);
          }
        }
      } catch (error) {
        logger.error(`Error crawling ${entry.url}: ${String(error)}`);
      }
    }

    await page.close();
    logger.info(
      `Crawl finished: ${String(this.frontier.visitedCount)} pages visited, ${String(this.frontier.seenCount)} total URLs seen`,
    );
  }

  private async navigateWithRetry(page: Page, url: string, retries = 2): Promise<boolean> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (resp !== null && resp.status() >= 400 && resp.status() !== 404) {
          this.ctx.logger.warn(`HTTP ${String(resp.status())} for ${url}`);
        }
        if (this.ctx.config.crawl.wait_for_idle) {
          try {
            await page.waitForLoadState("networkidle", { timeout: 10_000 });
          } catch {
            await page.waitForTimeout(2000);
          }
        }
        return true;
      } catch (error) {
        if (attempt < retries) {
          this.ctx.logger.debug(`Retry ${String(attempt + 1)} for ${url}: ${String(error)}`);
          await page.waitForTimeout(1000);
        } else {
          this.ctx.logger.warn(`Navigation failed after ${String(retries)} retries: ${url}`);
          return false;
        }
      }
    }
    return false;
  }
}

/** Crawl the configured target site into a SiteModel (plan §6.1). */
export function runCrawl(ctx: RunContext, options: CrawlOptions = {}): Promise<SiteModel> {
  return new Crawler(ctx, options).run();
}
