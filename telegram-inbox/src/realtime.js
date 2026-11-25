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
    add(res, user = null) {
      res.__user = user;
      clients.add(res);
    },
    remove(res) {
      clients.delete(res);
    },
    broadcast(event, targetUserId = null) {
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      for (const res of clients) {
        const user = res.__user;
        if (targetUserId !== null && user?.id !== targetUserId) continue;
        if (targetUserId === null && user && user.role !== "admin") {
          const assigneeId = event.conversation
            ? event.conversation.assigneeId
            : event.assigneeId;
          if (assigneeId !== user.id) continue;
        }
        try {
          res.write(payload);
        } catch (error) {
          clients.delete(res);
          logger?.warn("SSE 客户端写入失败", error.message);
        }
      }
    },
    broadcastToAgents(event, exceptUserId = null) {
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      for (const res of clients) {
        const user = res.__user;
        if (user?.role !== "agent" || user.id === exceptUserId) continue;
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
