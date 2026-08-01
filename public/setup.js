const startStep = document.querySelector("#setup-start-step");
const authenticatorStep = document.querySelector("#setup-authenticator-step");
const startForm = document.querySelector("#setup-start-form");
const startError = document.querySelector("#setup-start-error");
const startButton = document.querySelector("#setup-start-button");
const startLabel = document.querySelector("#setup-start-label");
const confirmForm = document.querySelector("#setup-confirm-form");
const codeInput = document.querySelector("#setup-code");
const confirmError = document.querySelector("#setup-confirm-error");
const confirmButton = document.querySelector("#setup-confirm-button");
const confirmLabel = document.querySelector("#setup-confirm-label");
const qrCode = document.querySelector("#mfa-qr-code");
const secret = document.querySelector("#mfa-secret");
const copySecret = document.querySelector("#copy-mfa-secret");

let setupToken = "";

function totpDigits(value) {
  return String(value).replace(/\D/g, "").slice(0, 6);
}

async function request(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "Request tidak dapat diproses.");
  }
  return response.json();
}

startForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  startButton.disabled = true;
  startLabel.textContent = "Menyiapkan…";
  startError.hidden = true;

  try {
    const result = await request("/setup/start", {});
    setupToken = result.setupToken;
    qrCode.src = result.qrCode;
    secret.textContent = result.secret.replace(/(.{4})/g, "$1 ").trim();
    startStep.hidden = true;
    authenticatorStep.hidden = false;
    codeInput.focus();
  } catch (error) {
    startError.textContent = error.message;
    startError.hidden = false;
  } finally {
    startButton.disabled = false;
    startLabel.textContent = "Tampilkan QR";
  }
});

confirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  confirmButton.disabled = true;
  confirmLabel.textContent = "Memverifikasi…";
  confirmError.hidden = true;

  try {
    await request("/setup/confirm", {
      setupToken,
      code: totpDigits(codeInput.value),
    });
    window.location.replace("/");
  } catch (error) {
    confirmError.textContent = error.message;
    confirmError.hidden = false;
    codeInput.select();
  } finally {
    confirmButton.disabled = false;
    confirmLabel.textContent = "Aktifkan TOTP";
  }
});

codeInput.addEventListener("input", () => {
  codeInput.value = totpDigits(codeInput.value);
});

codeInput.addEventListener("paste", (event) => {
  const pastedCode = totpDigits(event.clipboardData?.getData("text") ?? "");
  if (!pastedCode) {
    return;
  }
  event.preventDefault();
  codeInput.value = pastedCode;
  codeInput.setSelectionRange(codeInput.value.length, codeInput.value.length);
});

copySecret.addEventListener("click", async () => {
  const value = secret.textContent.replace(/\s/g, "");
  await navigator.clipboard.writeText(value);
  copySecret.textContent = "Tersalin";
  window.setTimeout(() => {
    copySecret.textContent = "Salin";
  }, 1800);
});
