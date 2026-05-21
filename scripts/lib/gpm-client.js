export class GpmClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async request(pathname) {
    const response = await fetch(`${this.baseUrl}${pathname}`);
    const payload = await response.json();
    if (!response.ok || payload.success === false) {
      throw new Error(payload.message || `GPM request failed: ${pathname}`);
    }
    return payload;
  }

  async listProfiles(params = {}) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.set(key, String(value));
      }
    }
    const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
    return this.request(`/api/v3/profiles${suffix}`);
  }

  async getProfile(profileId) {
    return this.request(`/api/v3/profiles/${profileId}`);
  }

  async startProfile(profileId, params = {}) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.set(key, String(value));
      }
    }
    const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
    return this.request(`/api/v3/profiles/start/${profileId}${suffix}`);
  }

  async closeProfile(profileId) {
    return this.request(`/api/v3/profiles/close/${profileId}`);
  }

  async waitForCdpReady(debuggingAddress, { timeoutMs = 30000, intervalMs = 2000 } = {}) {
    const start = Date.now();
    const url = `http://${debuggingAddress}/json/version`;
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const body = await res.json();
          if (body.Browser) return true;
        }
      } catch {
        // CDP not ready yet, retry
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(`CDP endpoint not ready after ${timeoutMs / 1000}s at ${debuggingAddress}`);
  }
}