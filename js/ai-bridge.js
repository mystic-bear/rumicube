class AIBridge {
  constructor() {
    this.workerPath = "worker/ai-worker.js";
    this.worker = null;
    this.pending = new Map();
    this.ready = false;
    this.available = false;
    this.lastError = null;
    this.requestTimeoutMs = {
      chooseMove: 5000,
      getHint: 5000
    };
    this._initWorker();
  }

  _teardownWorker() {
    if (!this.worker) return;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.worker = null;
  }

  _markUnavailable(error) {
    this.ready = false;
    this.available = false;
    this.lastError = error instanceof Error ? error : new Error(String(error || "Worker unavailable"));
  }

  _clearPendingEntry(id) {
    const pending = this.pending.get(id);
    if (!pending) return null;
    if (pending.timeoutHandle) clearTimeout(pending.timeoutHandle);
    this.pending.delete(id);
    return pending;
  }

  _rejectAllPending(error) {
    const workerError = error instanceof Error ? error : new Error(String(error || "Worker unavailable"));
    this.pending.forEach((pending, id) => {
      const entry = this._clearPendingEntry(id);
      if (!entry) return;
      entry.reject(workerError);
    });
  }

  _restartWorker(error) {
    const workerError = error instanceof Error ? error : new Error(String(error || "Worker unavailable"));
    this._rejectAllPending(workerError);
    this._teardownWorker();
    this._markUnavailable(workerError);
    this._initWorker();
  }

  _getRequestTimeoutMs(type) {
    return this.requestTimeoutMs[type] || 5000;
  }

  _startRequestTimeout(id, type) {
    return setTimeout(() => {
      if (!this.pending.has(id)) return;
      const label = type === "chooseMove" ? "AI move" : "Hint";
      const error = new Error(`${label} request timed out`);
      console.error(error.message);
      this._restartWorker(error);
    }, this._getRequestTimeoutMs(type));
  }

  _initWorker() {
    this._teardownWorker();

    try {
      this.worker = new Worker(this.workerPath);
    } catch (error) {
      console.error("AI Worker unavailable:", error);
      this._markUnavailable(error);
      return false;
    }

    this.ready = false;
    this.available = true;
    this.lastError = null;

    this.worker.onmessage = (event) => {
      const { type, id, stateVersion, move, hint, message } = event.data;

      if (type === "ready") {
        this.ready = true;
        return;
      }

      const pending = this._clearPendingEntry(id);
      if (!pending) return;

      if (type === "error") {
        pending.reject(new Error(message));
        return;
      }

      if (type === "moveResult") {
        pending.resolve({ move, stateVersion });
        return;
      }

      if (type === "hintResult") {
        pending.resolve({ hint, stateVersion });
      }
    };

    this.worker.onerror = (event) => {
      console.error("AI Worker crashed:", event);
      this._restartWorker(new Error("Worker crashed"));
    };

    return true;
  }

  _ensureWorker() {
    if (this.worker && this.available) return true;
    return this._initWorker();
  }

  _getWorkerError(defaultMessage = "Worker unavailable") {
    if (this.lastError instanceof Error) return this.lastError;
    return new Error(defaultMessage);
  }

  _createRequestId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  chooseMove(gameState, aiLevel, stateVersion) {
    const id = this._createRequestId("move");
    return new Promise((resolve, reject) => {
      if (!this._ensureWorker()) {
        reject(this._getWorkerError("Worker unavailable"));
        return;
      }

      this.pending.set(id, {
        resolve,
        reject,
        timeoutHandle: this._startRequestTimeout(id, "chooseMove")
      });
      try {
        this.worker.postMessage({ type: "chooseMove", id, stateVersion, gameState, aiLevel });
      } catch (error) {
        this._restartWorker(error);
      }
    });
  }

  getHint(gameState, stateVersion) {
    const id = this._createRequestId("hint");
    return new Promise((resolve, reject) => {
      if (!this._ensureWorker()) {
        reject(this._getWorkerError("Worker unavailable"));
        return;
      }

      this.pending.set(id, {
        resolve,
        reject,
        timeoutHandle: this._startRequestTimeout(id, "getHint")
      });
      try {
        this.worker.postMessage({ type: "getHint", id, stateVersion, gameState });
      } catch (error) {
        this._restartWorker(error);
      }
    });
  }

  cancelPending() {
    this._rejectAllPending(new Error("Cancelled"));
    this._initWorker();
  }
}

function createUnavailableAIBridge(error) {
  const lastError = error instanceof Error ? error : new Error(String(error || "Worker unavailable"));

  return {
    worker: null,
    pending: new Map(),
    ready: false,
    available: false,
    lastError,
    chooseMove() {
      return Promise.reject(this.lastError);
    },
    getHint() {
      return Promise.reject(this.lastError);
    },
    cancelPending() {}
  };
}
