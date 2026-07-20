/**
 * Network capture (plan §6.1). Listens to responses on the crawl page,
 * records every request as a NetworkRequest, and dedupes XHR/fetch traffic into
 * APIEndpoint entries keyed by `METHOD:path`. Ported from the Python
 * `_attach_network_listener`.
 */

import type { Page, Response } from "playwright";

import type { APIEndpoint, NetworkRequest } from "../schemas/site-model.js";

export class NetworkCapture {
  private readonly endpoints = new Map<string, APIEndpoint>();

  /**
   * Attach a response listener to `page`. Returns a mutable buffer that is
   * appended to as responses arrive; the caller clears it (length = 0) between
   * page navigations to scope requests to each page.
   */
  attach(page: Page): NetworkRequest[] {
    const buffer: NetworkRequest[] = [];
    page.on("response", (response: Response) => {
      try {
        const request = response.request();
        const headers = response.headers();
        const contentType = headers["content-type"] ?? null;
        buffer.push({
          url: request.url(),
          method: request.method(),
          resource_type: request.resourceType(),
          status: response.status(),
          content_type: contentType,
        });
        this.recordEndpoint(request.method(), request.url(), request.resourceType(), response.status(), contentType);
      } catch {
        // Response teardown races are expected during navigation; ignore.
      }
    });
    return buffer;
  }

  private recordEndpoint(
    method: string,
    url: string,
    resourceType: string,
    status: number,
    contentType: string | null,
  ): void {
    if (resourceType !== "xhr" && resourceType !== "fetch") {
      return;
    }
    let pathname = url;
    try {
      pathname = new URL(url).pathname;
    } catch {
      // Keep the raw URL as the key fragment if it does not parse.
    }
    const key = `${method}:${pathname}`;
    const existing = this.endpoints.get(key);
    if (existing === undefined) {
      this.endpoints.set(key, {
        url,
        method,
        request_content_type: null,
        response_content_type: contentType,
        status_codes_seen: [status],
      });
    } else if (!existing.status_codes_seen.includes(status)) {
      existing.status_codes_seen.push(status);
    }
  }

  apiEndpoints(): APIEndpoint[] {
    return Array.from(this.endpoints.values());
  }
}
