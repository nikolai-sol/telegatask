let toastTimer = null;
let actionHandler = null;

export function showToast(message, opts = null) {
  const toast = document.getElementById("toast");
  if (!(toast instanceof HTMLElement)) return;

  const durationMs = opts?.durationMs ?? 2400;
  const actionLabel = opts?.actionLabel ?? null;
  const onAction = typeof opts?.onAction === "function" ? opts.onAction : null;

  toast.innerHTML = "";

  if (actionLabel) {
    const msg = document.createElement("div");
    msg.className = "toast__text";
    msg.textContent = String(message || "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast__btn";
    btn.textContent = String(actionLabel);
    toast.appendChild(msg);
    toast.appendChild(btn);

    actionHandler = () => {
      try {
        onAction && onAction();
      } finally {
        hideToast();
      }
    };

    btn.onclick = actionHandler;
  } else {
    toast.textContent = String(message || "");
    actionHandler = null;
  }

  toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    hideToast();
  }, durationMs);
}

export function hideToast() {
  const toast = document.getElementById("toast");
  if (!(toast instanceof HTMLElement)) return;
  toast.hidden = true;
  if (actionHandler) {
    // best-effort detach
    const btn = toast.querySelector(".toast__btn");
    if (btn instanceof HTMLElement) btn.onclick = null;
  }
  actionHandler = null;
}
