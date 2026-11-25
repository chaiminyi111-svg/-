const UPSTREAM = "https://cloudchat.flat-water-8982.workers.dev";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);

    // 上游 Worker 会校验 Origin，这里统一改写成上游源
    headers.set("Origin", UPSTREAM);
    headers.set("Referer", UPSTREAM + "/");
    headers.delete("Host");
    headers.delete("CF-Ray");
    headers.delete("CF-Worker");

    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    return fetch(new Request(UPSTREAM + url.pathname + url.search, init));
  }
};
