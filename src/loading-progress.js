const listeners = new Set();
let activeRequests = 0;
let progress = 0;
let visible = false;
let progressTimer = null;
let hideTimer = null;
let installed = false;

function snapshot() {
  return { activeRequests, progress, visible };
}

function publish() {
  const current = snapshot();
  listeners.forEach((listener) => listener(current));
}

function stopProgressTimer() {
  if (progressTimer) window.clearInterval(progressTimer);
  progressTimer = null;
}

function beginRequest() {
  activeRequests += 1;
  if (activeRequests === 1) {
    if (hideTimer) window.clearTimeout(hideTimer);
    visible = true;
    progress = 8;
    stopProgressTimer();
    progressTimer = window.setInterval(() => {
      const increment = Math.max(1, Math.ceil((90 - progress) * 0.08));
      progress = Math.min(90, progress + increment);
      publish();
    }, 350);
  }
  publish();
}

function finishRequest() {
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests > 0) {
    publish();
    return;
  }
  stopProgressTimer();
  progress = 100;
  publish();
  hideTimer = window.setTimeout(() => {
    visible = false;
    progress = 0;
    publish();
  }, 450);
}

function isApiRequest(input) {
  const url = typeof input === 'string' ? input : input?.url;
  return typeof url === 'string' && /(^|\/)api\//.test(url);
}

export function installGlobalFetchProgress() {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    if (!isApiRequest(args[0])) return originalFetch(...args);
    beginRequest();
    try {
      return await originalFetch(...args);
    } finally {
      finishRequest();
    }
  };
}

export function subscribeLoadingProgress(listener) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function getLoadingProgress() {
  return snapshot();
}

