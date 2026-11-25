function createBroadcaster(logger) {
  const clients = new Set();

  const heartbeat = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(": ping\n\n");
      } catch {
        clients.delete(res);
      }
    }
  }, 25000);
  heartbeat.unref?.();

  return {
    add(res) {
      clients.add(res);
    },
    remove(res) {
      clients.delete(res);
    },
    broadcast(event) {
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      for (const res of clients) {
        try {
          res.write(payload);
        } catch (error) {
          clients.delete(res);
          logger?.warn("SSE 客户端写入失败", error.message);
        }
      }
    },
    close() {
      clearInterval(heartbeat);
      for (const res of clients) {
        try {
          res.end();
        } catch {}
      }
      clients.clear();
    },
    get size() {
      return clients.size;
    }
  };
}

module.exports = { createBroadcaster };
